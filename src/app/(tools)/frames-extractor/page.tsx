"use client";

import { getToolBySlug, getToolAccentColor } from "@/config/tools";
import { ToolPageShell } from "@/components/common/ToolPageShell";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { fetchFile } from "@ffmpeg/util";
import JSZip from "jszip";
import { Download, Film, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/feedback/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/layout/Card";
import { FileDropZoneCard } from "@/components/ui/interaction/FileDropZoneCard";
import { Progress } from "@/components/ui/feedback/Progress";
import {
  formatFileSize,
  getFFmpeg,
  getFileExtension,
  stripExtension,
  uid,
} from "@/lib/ffmpeg/client";

const tool = getToolBySlug("frames-extractor");

export default function FramesExtractorPage() {
  if (!tool) {
    return null;
  }

  return (
    <ToolPageShell title={tool.name} description={tool.description} accentColor={getToolAccentColor("frames-extractor")}>
      <FramesExtractorTool />
    </ToolPageShell>
  );
}


interface ExtractedFrame {
  name: string;
  blob: Blob;
  url: string;
}

interface ExtractionMeta {
  fps: number | null;
  frameCount: number;
}

const ACCEPTED_INPUT = ".mp4,.webm,.mov,.avi,.mkv,.gif";

function FramesExtractorTool() {
  const [file, setFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [meta, setMeta] = useState<ExtractionMeta>({
    fps: null,
    frameCount: 0,
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearFrames = useCallback(() => {
    frames.forEach((frame) => URL.revokeObjectURL(frame.url));
    setFrames([]);
    setMeta({ fps: null, frameCount: 0 });
  }, [frames]);

  useEffect(() => {
    return () => {
      frames.forEach((frame) => URL.revokeObjectURL(frame.url));
    };
  }, [frames]);

  const detectFps = useCallback(
    async (ffmpegInputName: string): Promise<number | null> => {
      const ffmpeg = await getFFmpeg();
      const logs: string[] = [];

      const onLog = ({ message }: { message: string }) => {
        logs.push(message);
      };

      ffmpeg.on("log", onLog);

      try {
        await ffmpeg.exec(["-i", ffmpegInputName]);
      } catch {
        // FFmpeg returns non-zero for probe-only command; logs are still useful.
      } finally {
        ffmpeg.off("log", onLog);
      }

      const combined = logs.join("\n");
      const match = combined.match(/(\d+(?:\.\d+)?)\s+fps/i);
      if (!match) {
        return null;
      }

      const parsed = Number.parseFloat(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    },
    [],
  );

  const extractFrames = useCallback(async () => {
    if (!file) {
      setErrorMessage("Upload a file first.");
      return;
    }

    setIsExtracting(true);
    setErrorMessage(null);
    setProgress(0);
    clearFrames();

    const ffmpeg = await getFFmpeg();
    const jobId = uid("frames");
    const sourceExt = getFileExtension(file.name) || "bin";
    const inputName = `${jobId}_input.${sourceExt}`;
    const framePattern = `${jobId}_frame_%04d.png`;

    let rafId = 0;
    let targetProgress = 0;

    const onProgress = ({ progress: ratio }: { progress: number }) => {
      targetProgress = Math.max(5, Math.min(96, Math.round(ratio * 96)));
    };

    const animate = () => {
      setProgress((current) => {
        if (current >= targetProgress) {
          return current;
        }
        const delta = Math.max(
          1,
          Math.round((targetProgress - current) * 0.25),
        );
        return Math.min(current + delta, targetProgress);
      });
      rafId = requestAnimationFrame(animate);
    };

    ffmpeg.on("progress", onProgress);
    rafId = requestAnimationFrame(animate);

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const fps = await detectFps(inputName);
      await ffmpeg.exec(["-i", inputName, "-vsync", "0", framePattern]);

      const extracted: ExtractedFrame[] = [];

      for (let index = 1; index < 100_000; index += 1) {
        const name = `${jobId}_frame_${String(index).padStart(4, "0")}.png`;
        try {
          const output = await ffmpeg.readFile(name);
          if (output.length === 0) {
            break;
          }

          const blob = new Blob([(output as Uint8Array).slice()], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          extracted.push({
            name: `frame_${String(index).padStart(4, "0")}.png`,
            blob,
            url,
          });
        } catch {
          break;
        }
      }

      setFrames(extracted);
      setMeta({ fps, frameCount: extracted.length });
      setProgress(100);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to extract frames from this media file.";
      setErrorMessage(message);
      setProgress(0);
    } finally {
      cancelAnimationFrame(rafId);
      ffmpeg.off("progress", onProgress);
      setIsExtracting(false);
    }
  }, [clearFrames, detectFps, file]);

  const downloadZip = useCallback(async () => {
    if (frames.length === 0) {
      return;
    }

    setIsDownloadingZip(true);
    setErrorMessage(null);

    try {
      const zip = new JSZip();
      frames.forEach((frame) => {
        zip.file(frame.name, frame.blob);
      });

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${file ? stripExtension(file.name) : "frames"}-frames.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Failed to generate ZIP archive.");
    } finally {
      setIsDownloadingZip(false);
    }
  }, [file, frames]);

  const infoText = useMemo(() => {
    const fpsText = meta.fps ? `${meta.fps.toFixed(2)} fps` : "FPS unavailable";
    return `${meta.frameCount} frames • ${fpsText}`;
  }, [meta]);

  return (
    <div className="space-y-6">
      <Card className="tool-card-inline">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Film className="size-5 text-primary" />
            GIF & video frame extractor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FileDropZoneCard
            fileTypeLabel="a GIF or video file"
            supportedFormats="mp4, webm, mov, avi, mkv, and gif"
            accept={ACCEPTED_INPUT}
            onFilesSelected={(incoming) => {
              const selected = incoming[0] ?? null;
              if (!selected) {
                return;
              }

              const ext = getFileExtension(selected.name);
              const allowed = ["mp4", "webm", "mov", "avi", "mkv", "gif"];
              if (!allowed.includes(ext)) {
                setErrorMessage(
                  "Unsupported file type. Please upload mp4, webm, mov, avi, mkv, or gif.",
                );
                return;
              }

              clearFrames();
              setErrorMessage(null);
              setProgress(0);
              setFile(selected);
            }}
          />

          {file ? (
            <div className="rounded-xl border border-white/10 bg-background/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-white/15 bg-background/70"
                >
                  {getFileExtension(file.name).toUpperCase()}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void extractFrames()}
                  disabled={isExtracting}
                >
                  {isExtracting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Film className="size-4" />
                  )}
                  Extract frames
                </Button>
                <Button
                  variant="outline"
                  disabled={frames.length === 0 || isDownloadingZip}
                  onClick={() => void downloadZip()}
                >
                  {isDownloadingZip ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Download ZIP
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFile(null);
                    setProgress(0);
                    setErrorMessage(null);
                    clearFrames();
                  }}
                  disabled={isExtracting}
                >
                  <X className="size-4" />
                  Reset
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">{infoText}</p>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {frames.length > 0 ? (
        <Card className="tool-card-inline">
          <CardHeader className="border-b border-white/10">
            <CardTitle className="text-lg">
              Extracted frame thumbnails
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {frames.map((frame, index) => (
                <div
                  key={frame.name}
                  className="group relative overflow-hidden rounded-lg border border-white/10 bg-background/30"
                >
                  <Image
                    src={frame.url}
                    alt={frame.name}
                    width={360}
                    height={220}
                    className="h-28 w-full object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-xs text-white">
                    #{index + 1}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

