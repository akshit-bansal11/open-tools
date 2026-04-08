// client.ts
// FFmpeg WASM client loader, specific format codecs, and file utilities.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const FFMPEG_CORE_VERSION = "0.12.10";
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function loadCore(ffmpeg: FFmpeg) {
  const coreURL = await toBlobURL(
    `${CORE_BASE_URL}/ffmpeg-core.js`,
    "text/javascript",
  );
  const wasmURL = await toBlobURL(
    `${CORE_BASE_URL}/ffmpeg-core.wasm`,
    "application/wasm",
  );

  await ffmpeg.load({ coreURL, wasmURL });
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await loadCore(ffmpeg);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return ffmpegLoadPromise;
}

export const AUDIO_FORMAT_CODEC_MAP = {
  mp3: ["libmp3lame"],
  opus: ["libopus"],
  m4a: ["aac", "libfdk_aac"],
  aac: ["aac"],
  mpeg: ["libmp3lame", "mpeg2audio"],
  wma: ["wmav2"],
  flac: ["flac"],
  wav: ["pcm_s16le", "pcm_s24le", "pcm_f32le"],
  aiff: ["pcm_s16be", "pcm_s24be"],
} as const;

export type AudioOutputFormat = keyof typeof AUDIO_FORMAT_CODEC_MAP;

export function getAudioCodecsForFormat(
  format: AudioOutputFormat,
): readonly string[] {
  return AUDIO_FORMAT_CODEC_MAP[format];
}

export const VIDEO_FORMAT_CODEC_MAP = {
  mp4: ["libx264", "libx265", "libvpx-vp9"],
  webm: ["libvpx", "libvpx-vp9"],
  mkv: ["libx264", "libx265", "libvpx-vp9"],
  mov: ["libx264", "prores"],
  avi: ["libxvid", "libx264"],
  flv: ["libx264", "flv"],
  ogv: ["libtheora"],
  "3gp": ["libx264", "libxvid"],
} as const;

export type VideoOutputFormat = keyof typeof VIDEO_FORMAT_CODEC_MAP;

export function getVideoCodecsForFormat(
  format: VideoOutputFormat,
): readonly string[] {
  return VIDEO_FORMAT_CODEC_MAP[format];
}

const VIDEO_AUDIO_CODEC_MAP: Record<VideoOutputFormat, readonly string[]> = {
  mp4: ["aac", "libmp3lame", "copy"],
  mkv: ["aac", "libmp3lame", "copy"],
  mov: ["aac", "libmp3lame", "copy"],
  webm: ["libvorbis", "libopus"],
  avi: ["aac", "copy"],
  flv: ["aac", "copy"],
  ogv: ["aac", "copy"],
  "3gp": ["aac", "copy"],
};

export function getVideoAudioCodecsForFormat(
  format: VideoOutputFormat,
): readonly string[] {
  return VIDEO_AUDIO_CODEC_MAP[format];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
