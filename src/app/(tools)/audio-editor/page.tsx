"use client";

import { getToolBySlug } from "@/config/tools";
import { ToolPageShell } from "@/components/common/ToolPageShell";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { fetchFile } from "@ffmpeg/util";
import {
  AudioWaveform,
  Download,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/feedback/Badge";
import { Progress } from "@/components/ui/feedback/Progress";
import { Select } from "@/components/ui/form/Select";
import { Slider } from "@/components/ui/interaction/Slider";
import { FileDropZoneCard } from "@/components/ui/interaction/FileDropZoneCard";
import { Card } from "@/components/ui/layout/Card";
import {
  formatFileSize,
  getFFmpeg,
  getFileExtension,
  stripExtension,
  uid,
} from "@/lib/ffmpeg/client";
import {
  decodeAudioFile,
  formatDuration,
} from "@/lib/tools/audio-trimmer/utils";
import { WaveformCanvas } from "@/components/tools/audio-trimmer/WaveformCanvas";

// ─── Page shell ──────────────────────────────────────────────────────────────

const tool = getToolBySlug("audio-editor");

export default function AudioEditorPage() {
  if (!tool) return null;
  return (
    <ToolPageShell title={tool.name} description={tool.description}>
      <AudioEditorTool />
    </ToolPageShell>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCEPTED_AUDIO = ".mp3,.wav,.flac,.aac,.m4a,.opus,.ogg";

const OUTPUT_FORMATS = [
  { label: "MP3",  value: "mp3"  },
  { label: "WAV",  value: "wav"  },
  { label: "FLAC", value: "flac" },
  { label: "AAC",  value: "aac"  },
  { label: "OPUS", value: "opus" },
];

const CODEC_FOR_FORMAT: Record<string, string> = {
  mp3:  "libmp3lame",
  wav:  "pcm_s16le",
  flac: "flac",
  aac:  "aac",
  opus: "libopus",
};

type EditorStatus = "idle" | "loading" | "ready" | "exporting" | "done" | "error";

// ─── Filter helpers ───────────────────────────────────────────────────────────

/** Build a chain of atempo filter strings for any speed value.
 *  atempo must be in [0.5, 100], chaining handles extremes safely. */
function buildAtempoChain(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-4) return [];
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2.0 + 1e-5) {
    parts.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-5) {
    parts.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1.0) > 1e-4) {
    parts.push(`atempo=${remaining.toFixed(6)}`);
  }
  return parts;
}

/**
 * Build the complete -filter:a filter chain string.
 * Returns null when no processing is needed (all values at default).
 */
function buildFilterChain(params: {
  speed: number;
  pitchSemitones: number;
  bass: number;
  mid: number;
  treble: number;
  sampleRate: number;
}): string | null {
  const { speed, pitchSemitones, bass, mid, treble, sampleRate } = params;
  const filters: string[] = [];

  const pitchFactor = Math.pow(2, pitchSemitones / 12);
  const needsPitch = Math.abs(pitchSemitones) > 1e-4;
  const needsSpeed = Math.abs(speed - 1) > 1e-4;

  if (needsPitch || needsSpeed) {
    if (needsPitch) {
      // asetrate changes pitch (and tempo as a side-effect)
      // atempo then corrects tempo while keeping pitch at the new frequency
      const newRate = Math.round(sampleRate * pitchFactor);
      filters.push(`asetrate=${newRate}`);
      // After asetrate, audio plays at pitchFactor × speed
      // We want final speed, so effective atempo target = speed / pitchFactor
      const atempoTarget = speed / pitchFactor;
      filters.push(...buildAtempoChain(atempoTarget));
      filters.push(`aresample=${sampleRate}`);
    } else {
      filters.push(...buildAtempoChain(speed));
    }
  }

  if (Math.abs(bass) > 0.1)   filters.push(`bass=g=${bass}:f=100`);
  if (Math.abs(mid) > 0.1)    filters.push(`equalizer=f=1000:t=q:w=2:g=${mid}`);
  if (Math.abs(treble) > 0.1) filters.push(`treble=g=${treble}:f=8000`);

  return filters.length > 0 ? filters.join(",") : null;
}

// ─── SectionLabel helper ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
      {children}
    </p>
  );
}

// ─── SliderRow helper ─────────────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground/80">
          {display}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}

// ─── Tool ────────────────────────────────────────────────────────────────────

function AudioEditorTool() {
  // File state
  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [status, setStatus] = useState<EditorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Trim region (seconds)
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  // Effect params
  const [speed, setSpeed] = useState(1);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);

  // Playback
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bassNodeRef = useRef<BiquadFilterNode | null>(null);
  const midNodeRef = useRef<BiquadFilterNode | null>(null);
  const trebleNodeRef = useRef<BiquadFilterNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const playStartWallRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rafRef = useRef(0);

  // Output
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputSize, setOutputSize] = useState(0);

  // ── Derived ──────────────────────────────────────────────────────────────
  const duration = audioBuffer?.duration ?? 0;
  const startRatio = duration > 0 ? startTime / duration : 0;
  const endRatio = duration > 0 ? endTime / duration : 1;
  const playheadRatio = duration > 0 ? playhead / duration : 0;

  // ── Live EQ node updates ─────────────────────────────────────────────────
  useEffect(() => {
    if (bassNodeRef.current) bassNodeRef.current.gain.value = bass;
  }, [bass]);
  useEffect(() => {
    if (midNodeRef.current) midNodeRef.current.gain.value = mid;
  }, [mid]);
  useEffect(() => {
    if (trebleNodeRef.current) trebleNodeRef.current.gain.value = treble;
  }, [treble]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopPlayback();
      if (outputUrl) URL.revokeObjectURL(outputUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load file ─────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (f: File) => {
    stopPlayback();
    setFile(f);
    setAudioBuffer(null);
    setStatus("loading");
    setError(null);
    setProgress(0);
    setOutputUrl(null);
    setStartTime(0);
    setPlayhead(0);
    // Reset effects
    setSpeed(1);
    setPitchSemitones(0);
    setBass(0);
    setMid(0);
    setTreble(0);

    try {
      const buf = await decodeAudioFile(f);
      setAudioBuffer(buf);
      setEndTime(buf.duration);
      setStatus("ready");
    } catch {
      setError("Failed to decode audio. Is the file corrupted or unsupported?");
      setStatus("error");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trim handles ─────────────────────────────────────────────────────────
  const handleRegionChange = useCallback(
    (start: number, end: number) => {
      if (!audioBuffer) return;
      setStartTime(parseFloat((start * audioBuffer.duration).toFixed(2)));
      setEndTime(parseFloat((end * audioBuffer.duration).toFixed(2)));
    },
    [audioBuffer],
  );

  const nudgeStart = useCallback(
    (delta: number) =>
      setStartTime((p) =>
        parseFloat(Math.max(0, Math.min(endTime - 0.1, p + delta)).toFixed(2)),
      ),
    [endTime],
  );

  const nudgeEnd = useCallback(
    (delta: number) =>
      setEndTime((p) =>
        parseFloat(Math.max(startTime + 0.1, Math.min(duration, p + delta)).toFixed(2)),
      ),
    [startTime, duration],
  );

  // ── Playback ──────────────────────────────────────────────────────────────
  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    bassNodeRef.current = null;
    midNodeRef.current = null;
    trebleNodeRef.current = null;
    setIsPlaying(false);
  }

  const startPlayback = useCallback(() => {
    if (!audioBuffer) return;
    stopPlayback();

    const ctx = new AudioContext();

    // EQ chain
    const bassF = ctx.createBiquadFilter();
    bassF.type = "lowshelf";
    bassF.frequency.value = 100;
    bassF.gain.value = bass;
    bassNodeRef.current = bassF;

    const midF = ctx.createBiquadFilter();
    midF.type = "peaking";
    midF.frequency.value = 1000;
    midF.Q.value = 1.4;
    midF.gain.value = mid;
    midNodeRef.current = midF;

    const trebleF = ctx.createBiquadFilter();
    trebleF.type = "highshelf";
    trebleF.frequency.value = 8000;
    trebleF.gain.value = treble;
    trebleNodeRef.current = trebleF;

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    // Speed + approximate pitch preview via playbackRate
    const pitchFactor = Math.pow(2, pitchSemitones / 12);
    src.playbackRate.value = speed * pitchFactor;
    src.connect(bassF).connect(midF).connect(trebleF).connect(ctx.destination);

    src.onended = () => {
      setIsPlaying(false);
      setPlayhead(startTime);
      cancelAnimationFrame(rafRef.current);
    };

    const clipDuration = endTime - startTime;
    src.start(0, startTime, clipDuration / (speed * pitchFactor));
    sourceRef.current = src;
    playStartWallRef.current = performance.now();
    playOffsetRef.current = startTime;
    setIsPlaying(true);

    const tick = () => {
      const elapsed = (performance.now() - playStartWallRef.current) / 1000 * speed * pitchFactor;
      const pos = Math.min(playOffsetRef.current + elapsed, endTime);
      setPlayhead(pos);
      if (pos < endTime) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [audioBuffer, startTime, endTime, speed, pitchSemitones, bass, mid, treble]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, startPlayback]);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportAudio = useCallback(async () => {
    if (!file || !audioBuffer) return;
    stopPlayback();

    setStatus("exporting");
    setProgress(0);
    setError(null);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);

    const ffmpeg = await getFFmpeg();
    const jobId = uid("edit");
    const srcExt = getFileExtension(file.name) || "mp3";
    const inputName = `${jobId}_in.${srcExt}`;
    const outputName = `${stripExtension(file.name)}_edited.${outputFormat}`;

    const filterChain = buildFilterChain({
      speed,
      pitchSemitones,
      bass,
      mid,
      treble,
      sampleRate: audioBuffer.sampleRate,
    });

    let targetProgress = 0;
    const onProgress = ({ progress: r }: { progress: number }) => {
      targetProgress = Math.max(8, Math.min(95, Math.round(r * 95)));
    };

    let animRaf = 0;
    const animate = () => {
      setProgress((cur) =>
        Math.min(cur + Math.max(1, Math.round((targetProgress - cur) * 0.25)), targetProgress),
      );
      animRaf = requestAnimationFrame(animate);
    };

    ffmpeg.on("progress", onProgress);
    animRaf = requestAnimationFrame(animate);

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const args = ["-i", inputName, "-ss", String(startTime), "-to", String(endTime)];

      if (filterChain) {
        args.push("-filter:a", filterChain);
      }

      args.push("-c:a", CODEC_FOR_FORMAT[outputFormat] ?? "libmp3lame", outputName);

      await ffmpeg.exec(args);

      const out = await ffmpeg.readFile(outputName);
      const blob = new Blob([(out as Uint8Array).slice()], {
        type: `audio/${outputFormat}`,
      });
      setOutputUrl(URL.createObjectURL(blob));
      setOutputSize(blob.size);
      setProgress(100);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
      setStatus("error");
      setProgress(0);
    } finally {
      cancelAnimationFrame(animRaf);
      ffmpeg.off("progress", onProgress);
    }
  }, [file, audioBuffer, startTime, endTime, speed, pitchSemitones, bass, mid, treble, outputFormat, outputUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadOutput = useCallback(() => {
    if (!outputUrl || !file) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `${stripExtension(file.name)}_edited.${outputFormat}`;
    a.click();
  }, [outputUrl, file, outputFormat]);

  const reset = useCallback(() => {
    stopPlayback();
    setFile(null);
    setAudioBuffer(null);
    setStatus("idle");
    setError(null);
    setProgress(0);
    setPlayhead(0);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);
  }, [outputUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = audioBuffer && file &&
    (status === "ready" || status === "exporting" || status === "done");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <FileDropZoneCard
        fileTypeLabel="an audio file"
        supportedFormats="mp3, wav, flac, aac, m4a, opus, ogg"
        accept={ACCEPTED_AUDIO}
        onFilesSelected={(files) => {
          const f = files[0];
          if (f) void loadFile(f);
        }}
      />

      {/* Loading */}
      {status === "loading" && (
        <Card className="flex items-center justify-center gap-3 border-white/10 bg-background/40 py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Decoding audio…</p>
        </Card>
      )}

      {/* Editor */}
      {isActive && (
        <div className="space-y-4">
          {/* File info */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AudioWaveform className="size-5 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-medium">{file!.name}</p>
              <Badge variant="outline" className="shrink-0 border-white/15 bg-white/[0.04] text-xs">
                {getFileExtension(file!.name).toUpperCase()}
              </Badge>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(file!.size)}
              </span>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" onClick={reset}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Waveform */}
          <WaveformCanvas
            audioBuffer={audioBuffer!}
            startRatio={startRatio}
            endRatio={endRatio}
            playheadRatio={playheadRatio}
            onRegionChange={handleRegionChange}
            height={148}
          />

          {/* Controls card */}
          <Card className="divide-y divide-white/[0.06] border-white/10 bg-white/[0.015]">

            {/* ── Playback row ── */}
            <div className="flex flex-wrap items-center gap-4 px-5 py-3">
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 border-white/10 bg-white/[0.04]"
                onClick={togglePlayback}
                disabled={status === "exporting"}
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>

              <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                {formatDuration(Math.min(playhead, endTime))} / {formatDuration(duration)}
              </span>

              <div className="h-4 w-px bg-white/10" />

              {/* Start nudge */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Start</span>
                <Button variant="ghost" size="icon" className="size-6 rounded text-muted-foreground"
                  onClick={() => nudgeStart(-0.1)} disabled={status === "exporting"}>
                  <Minus className="size-3" />
                </Button>
                <span className="w-16 text-center font-mono text-xs tabular-nums">{formatDuration(startTime)}</span>
                <Button variant="ghost" size="icon" className="size-6 rounded text-muted-foreground"
                  onClick={() => nudgeStart(0.1)} disabled={status === "exporting"}>
                  <Plus className="size-3" />
                </Button>
              </div>

              {/* End nudge */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">End</span>
                <Button variant="ghost" size="icon" className="size-6 rounded text-muted-foreground"
                  onClick={() => nudgeEnd(-0.1)} disabled={status === "exporting"}>
                  <Minus className="size-3" />
                </Button>
                <span className="w-16 text-center font-mono text-xs tabular-nums">{formatDuration(endTime)}</span>
                <Button variant="ghost" size="icon" className="size-6 rounded text-muted-foreground"
                  onClick={() => nudgeEnd(0.1)} disabled={status === "exporting"}>
                  <Plus className="size-3" />
                </Button>
              </div>

              <div className="ml-auto">
                <span className="font-mono text-xs tabular-nums text-muted-foreground/60">
                  clip {formatDuration(endTime - startTime)}
                </span>
              </div>
            </div>

            {/* ── Speed & Pitch ── */}
            <div className="px-5 py-4">
              <SectionLabel>Speed &amp; Pitch</SectionLabel>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <SliderRow
                  label="Speed"
                  value={speed}
                  min={0.25}
                  max={4}
                  step={0.05}
                  display={`${speed.toFixed(2)}×`}
                  onChange={setSpeed}
                  disabled={status === "exporting"}
                />
                <SliderRow
                  label="Pitch"
                  value={pitchSemitones}
                  min={-12}
                  max={12}
                  step={0.5}
                  display={pitchSemitones === 0 ? "0 st" : `${pitchSemitones > 0 ? "+" : ""}${pitchSemitones} st`}
                  onChange={setPitchSemitones}
                  disabled={status === "exporting"}
                />
                <div className="col-span-2 flex items-end gap-3 lg:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 border border-white/10 px-2 text-[10px] text-muted-foreground"
                    onClick={() => { setSpeed(0.5); }}
                  >0.5×</Button>
                  {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <Button
                      key={s}
                      variant="ghost"
                      size="sm"
                      className={`h-7 border border-white/10 px-2 text-[10px] ${Math.abs(speed - s) < 0.01 ? "border-white/30 text-foreground" : "text-muted-foreground"}`}
                      onClick={() => setSpeed(s)}
                    >
                      {s}×
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Equalizer ── */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Equalizer</SectionLabel>
                <button
                  className="text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground"
                  onClick={() => { setBass(0); setMid(0); setTreble(0); }}
                >
                  Reset EQ
                </button>
              </div>
              <div className="grid grid-cols-3 gap-6">
                <SliderRow
                  label="Bass (100 Hz)"
                  value={bass}
                  min={-12}
                  max={12}
                  step={0.5}
                  display={bass === 0 ? "0 dB" : `${bass > 0 ? "+" : ""}${bass} dB`}
                  onChange={setBass}
                  disabled={status === "exporting"}
                />
                <SliderRow
                  label="Mid (1 kHz)"
                  value={mid}
                  min={-12}
                  max={12}
                  step={0.5}
                  display={mid === 0 ? "0 dB" : `${mid > 0 ? "+" : ""}${mid} dB`}
                  onChange={setMid}
                  disabled={status === "exporting"}
                />
                <SliderRow
                  label="Treble (8 kHz)"
                  value={treble}
                  min={-12}
                  max={12}
                  step={0.5}
                  display={treble === 0 ? "0 dB" : `${treble > 0 ? "+" : ""}${treble} dB`}
                  onChange={setTreble}
                  disabled={status === "exporting"}
                />
              </div>
            </div>

            {/* ── Export ── */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Select
                options={OUTPUT_FORMATS}
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value)}
                disabled={status === "exporting"}
                className="h-8 w-28 border-white/10 bg-white/[0.04] text-xs shadow-none hover:bg-white/[0.07]"
              />

              {outputUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.04] text-xs"
                  onClick={downloadOutput}
                >
                  <Download className="size-3.5" />
                  Download
                </Button>
              )}

              <Button
                size="sm"
                className="text-xs"
                disabled={status === "exporting"}
                onClick={() => void exportAudio()}
              >
                {status === "exporting"
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <RotateCcw className="size-3.5" />}
                {status === "exporting" ? "Exporting…" : "Export"}
              </Button>

              {status === "done" && outputSize > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatFileSize(outputSize)} · {outputFormat.toUpperCase()}
                </span>
              )}
            </div>

            {/* Progress */}
            {(status === "exporting" || status === "done") && (
              <div className="px-5 pb-4 pt-2">
                <Progress value={progress} className="h-1.5 bg-white/10" />
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
