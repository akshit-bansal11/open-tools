/**
 * Shared audio utilities for Audio Trimmer & Audio Joiner tools.
 */

/**
 * Decode a File into an AudioBuffer using the Web Audio API.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    // Don't close — the caller may reuse the context for playback.
    // Callers that only need decoding should close their own ctx.
  }
}

/**
 * Format a duration in seconds to the "MM:SS.d" display format.
 * e.g. 87.35 → "01:27.3"
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = secs.toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

/** Waveform rendering constants */
const BAR_COLOR = "#4ade80";
const BAR_GAP_RATIO = 0.25; // gap is 25% of bar slot width

/**
 * Draw a full waveform onto an existing canvas element using the given
 * AudioBuffer. Uses the first channel (mono sum not needed for visual).
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  color: string = BAR_COLOR,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const data = buffer.getChannelData(0);
  const numBars = Math.floor(width / 3); // ~3px slot per bar
  const samplesPerBar = Math.floor(data.length / numBars);
  const barSlotWidth = width / numBars;
  const barWidth = barSlotWidth * (1 - BAR_GAP_RATIO);
  const halfH = height / 2;

  ctx.fillStyle = color;

  for (let i = 0; i < numBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, data.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > peak) peak = abs;
    }

    const barH = Math.max(2, peak * halfH * 1.8); // slight amplification
    const x = i * barSlotWidth + (barSlotWidth - barWidth) / 2;

    // Draw symmetric bar (top + bottom)
    ctx.fillRect(x, halfH - barH, barWidth, barH * 2);
  }
}
