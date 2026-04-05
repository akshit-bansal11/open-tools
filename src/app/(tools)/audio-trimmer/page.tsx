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

const tool = getToolBySlug("audio-trimmer");

export default function AudioTrimmerPage() {
  if (!tool) return null;
  return (
    <ToolPageShell title={tool.name} description={tool.description}>
      <AudioTrimmerTool />
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

/** Map each output format to the ffmpeg audio codec to use when re-encoding. */
const CODEC_FOR_FORMAT: Record<string, string> = {
  mp3:  "libmp3lame",
  wav:  "pcm_s16le",
  flac: "flac",
  aac:  "aac",
  opus: "libopus",
};

type TrimStatus = "idle" | "loading" | "ready" | "trimming" | "done" | "error";

// ─── Tool ────────────────────────────────────────────────────────────────────

function AudioTrimmerTool() {
  // File & decode state
  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [status, setStatus] = useState<TrimStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Trim region (seconds)
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  // Playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0); // seconds
  const playStartWallRef = useRef(0); // performance.now() when play started
  const playOffsetRef = useRef(0);   // audioCtx offset when play started
  const rafRef = useRef(0);

  // Output
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputSize, setOutputSize] = useState(0);

  // ── Derived ────────────────────────────────────────────────────────────────
  const duration = audioBuffer?.duration ?? 0;
  const startRatio = duration > 0 ? startTime / duration : 0;
  const endRatio = duration > 0 ? endTime / duration : 1;
  const playheadRatio = duration > 0 ? playhead / duration : 0;

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopPlayback();
      if (outputUrl) URL.revokeObjectURL(outputUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load file ──────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (f: File) => {
    stopPlayback();
    setFile(f);
    setAudioBuffer(null);
    setStatus("loading");
    setError(null);
    setProgress(0);
    setOutputUrl(null);
    setOutputSize(0);

    try {
      const buf = await decodeAudioFile(f);
      setAudioBuffer(buf);
      setStartTime(0);
      setEndTime(buf.duration);
      setPlayhead(0);
      setStatus("ready");
    } catch {
      setError("Failed to decode audio file. Is it corrupted or unsupported?");
      setStatus("error");
    }
  }, []);

  // ── Region change from waveform drag ──────────────────────────────────────
  const handleRegionChange = useCallback(
    (start: number, end: number) => {
      if (!audioBuffer) return;
      setStartTime(parseFloat((start * audioBuffer.duration).toFixed(2)));
      setEndTime(parseFloat((end * audioBuffer.duration).toFixed(2)));
    },
    [audioBuffer],
  );

  // ── Time nudge buttons ─────────────────────────────────────────────────────
  const nudgeStart = useCallback(
    (delta: number) => {
      setStartTime((prev) =>
        parseFloat(Math.max(0, Math.min(endTime - 0.1, prev + delta)).toFixed(2)),
      );
    },
    [endTime],
  );

  const nudgeEnd = useCallback(
    (delta: number) => {
      setEndTime((prev) =>
        parseFloat(
          Math.max(startTime + 0.1, Math.min(duration, prev + delta)).toFixed(2),
        ),
      );
    },
    [startTime, duration],
  );

  // ── Playback ───────────────────────────────────────────────────────────────
  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    try {
      sourceRef.current?.stop();
    } catch {}
    sourceRef.current = null;
    setIsPlaying(false);
  }

  const startPlayback = useCallback(() => {
    if (!audioBuffer) return;
    stopPlayback();

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.onended = () => {
      setIsPlaying(false);
      setPlayhead(startTime);
      cancelAnimationFrame(rafRef.current);
    };

    const offset = startTime;
    const clipDuration = endTime - startTime;
    src.start(0, offset, clipDuration);
    sourceRef.current = src;
    playStartWallRef.current = performance.now();
    playOffsetRef.current = offset;
    setIsPlaying(true);

    const tick = () => {
      const elapsed = (performance.now() - playStartWallRef.current) / 1000;
      const pos = Math.min(playOffsetRef.current + elapsed, endTime);
      setPlayhead(pos);
      if (pos < endTime) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [audioBuffer, startTime, endTime]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [isPlaying, startPlayback]);

  // ── Trim & Export ──────────────────────────────────────────────────────────
  const trimAndExport = useCallback(async () => {
    if (!file || !audioBuffer) return;
    stopPlayback();

    setStatus("trimming");
    setProgress(0);
    setError(null);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);

    const ffmpeg = await getFFmpeg();
    const jobId = uid("trim");
    const srcExt = getFileExtension(file.name) || "mp3";
    const inputName = `${jobId}_in.${srcExt}`;
    const outputName = `${stripExtension(file.name)}_trimmed.${outputFormat}`;

    let targetProgress = 0;
    const onProgress = ({ progress: r }: { progress: number }) => {
      targetProgress = Math.max(8, Math.min(95, Math.round(r * 95)));
    };

    let animRaf = 0;
    const animate = () => {
      setProgress((cur) => {
        const next = cur + Math.max(1, Math.round((targetProgress - cur) * 0.25));
        return Math.min(next, targetProgress);
      });
      animRaf = requestAnimationFrame(animate);
    };

    ffmpeg.on("progress", onProgress);
    animRaf = requestAnimationFrame(animate);

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      await ffmpeg.exec([
        "-i",  inputName,
        "-ss", String(startTime),
        "-to", String(endTime),
        "-c:a", CODEC_FOR_FORMAT[outputFormat] ?? "libmp3lame",
        outputName,
      ]);

      const out = await ffmpeg.readFile(outputName);
      const blob = new Blob([(out as Uint8Array).slice()], {
        type: `audio/${outputFormat}`,
      });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setOutputSize(blob.size);
      setProgress(100);
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Trim failed.";
      setError(msg);
      setStatus("error");
      setProgress(0);
    } finally {
      cancelAnimationFrame(animRaf);
      ffmpeg.off("progress", onProgress);
      if (status !== "done") setStatus("ready");
    }
  }, [file, audioBuffer, startTime, endTime, outputFormat, outputUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadOutput = useCallback(() => {
    if (!outputUrl || !file) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `${stripExtension(file.name)}_trimmed.${outputFormat}`;
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
    setOutputSize(0);
    }, [outputUrl]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
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

      {/* Loading spinner */}
      {status === "loading" && (
        <Card className="flex items-center justify-center gap-3 border-white/10 bg-background/40 py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Decoding audio…</p>
        </Card>
      )}

      {/* Main editor */}
      {audioBuffer && file && (status === "ready" || status === "trimming" || status === "done") && (
        <div className="space-y-4">
          {/* File info row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <AudioWaveform className="size-5 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-medium text-foreground">
                {file.name}
              </p>
              <Badge
                variant="outline"
                className="shrink-0 border-white/15 bg-white/[0.04] text-xs"
              >
                {getFileExtension(file.name).toUpperCase()}
              </Badge>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={reset}
              title="Remove file"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Waveform */}
          <WaveformCanvas
            audioBuffer={audioBuffer}
            startRatio={startRatio}
            endRatio={endRatio}
            playheadRatio={playheadRatio}
            onRegionChange={handleRegionChange}
            height={140}
          />

          {/* Bottom control bar */}
          <Card className="border-white/10 bg-white/[0.02]">
            <div className="flex flex-wrap items-center gap-4 px-4 py-3">

              {/* Play/Pause */}
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 border-white/10 bg-white/[0.04]"
                onClick={togglePlayback}
                disabled={status === "trimming"}
              >
                {isPlaying ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>

              {/* Time display */}
              <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
                {formatDuration(Math.min(playhead, endTime))}
                {" / "}
                {formatDuration(duration)}
              </span>

              <div className="h-4 w-px bg-white/10 hidden sm:block" />

              {/* Start time nudge */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Start</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md text-muted-foreground"
                    onClick={() => nudgeStart(-0.1)}
                    disabled={status === "trimming"}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-16 text-center font-mono text-xs tabular-nums">
                    {formatDuration(startTime)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md text-muted-foreground"
                    onClick={() => nudgeStart(0.1)}
                    disabled={status === "trimming"}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>

              {/* End time nudge */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">End</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md text-muted-foreground"
                    onClick={() => nudgeEnd(-0.1)}
                    disabled={status === "trimming"}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-16 text-center font-mono text-xs tabular-nums">
                    {formatDuration(endTime)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md text-muted-foreground"
                    onClick={() => nudgeEnd(0.1)}
                    disabled={status === "trimming"}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>

              <div className="h-4 w-px bg-white/10 hidden sm:block" />

              {/* Format */}
              <Select
                options={OUTPUT_FORMATS}
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value)}
                disabled={status === "trimming"}
                className="h-8 w-28 border-white/10 bg-white/[0.04] text-xs shadow-none hover:bg-white/[0.07]"
              />

              {/* Actions */}
              <div className="ml-auto flex items-center gap-2">
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
                  disabled={status === "trimming"}
                  onClick={() => void trimAndExport()}
                >
                  {status === "trimming" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  {status === "trimming" ? "Trimming…" : "Trim & Export"}
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            {(status === "trimming" || status === "done") && (
              <div className="border-t border-white/5 px-4 pb-3 pt-2 space-y-1">
                <Progress value={progress} className="h-1.5 bg-white/10" />
                {status === "done" && outputSize > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Output: {formatFileSize(outputSize)} ·{" "}
                    {formatDuration(endTime - startTime)} clip
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-banner">{error}</div>
      )}
    </div>
  );
}
