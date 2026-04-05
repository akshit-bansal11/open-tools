"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { drawWaveform } from "@/lib/tools/audio-trimmer/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WaveformCanvasProps {
  /** Decoded audio buffer to render */
  audioBuffer: AudioBuffer;
  /**
   * 0–1 ratio of where the trim start handle sits.
   * If undefined, no trim region is shown (read-only / preview mode).
   */
  startRatio?: number;
  /**
   * 0–1 ratio of where the trim end handle sits.
   */
  endRatio?: number;
  /**
   * Playhead position ratio (0–1), animated during playback.
   */
  playheadRatio?: number;
  /**
   * Called when the user drags a handle.
   * `start` and `end` are both 0–1 ratios.
   */
  onRegionChange?: (start: number, end: number) => void;
  /** Fixed pixel height for the canvas (defaults to 128) */
  height?: number;
  /** Extra className for the wrapper div */
  className?: string;
  /** Whether to show trim handles (defaults to true when start/end provided) */
  trimHandles?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WAVEFORM_COLOR = "#4ade80"; // green
const REGION_FILL = "rgba(96, 165, 250, 0.12)"; // blue-ish overlay
const HANDLE_COLOR = "#60a5fa"; // blue handle bars
const HANDLE_WIDTH = 2;
const HANDLE_HIT_SLOP = 12; // px either side → makes grab easier
const PLAYHEAD_COLOR = "rgba(255, 255, 255, 0.7)";
const DIM_FILL = "rgba(0, 0, 0, 0.35)"; // outside-region dimming

type DragTarget = "start" | "end" | null;

// ─── Component ───────────────────────────────────────────────────────────────

export function WaveformCanvas({
  audioBuffer,
  startRatio,
  endRatio,
  playheadRatio,
  onRegionChange,
  height = 128,
  className = "",
  trimHandles = true,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragTarget = useRef<DragTarget>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  const hasRegion =
    trimHandles &&
    startRatio !== undefined &&
    endRatio !== undefined &&
    onRegionChange !== undefined;

  // ── Responsive width ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCanvasWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(el);
    setCanvasWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // ── Draw ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // 1. Clear
    ctx.clearRect(0, 0, W, H);

    // 2. Waveform
    drawWaveform(canvas, audioBuffer, WAVEFORM_COLOR);

    if (hasRegion && startRatio !== undefined && endRatio !== undefined) {
      const sx = startRatio * W;
      const ex = endRatio * W;

      // 3. Dim outside-region
      ctx.fillStyle = DIM_FILL;
      ctx.fillRect(0, 0, sx, H);
      ctx.fillRect(ex, 0, W - ex, H);

      // 4. Trim region overlay
      ctx.fillStyle = REGION_FILL;
      ctx.fillRect(sx, 0, ex - sx, H);

      // 5. Handle bars
      ctx.fillStyle = HANDLE_COLOR;
      ctx.fillRect(sx - HANDLE_WIDTH / 2, 0, HANDLE_WIDTH, H);
      ctx.fillRect(ex - HANDLE_WIDTH / 2, 0, HANDLE_WIDTH, H);

      // 6. Handle grip caps (rounded rect at top)
      const capW = 10;
      const capH = 18;
      const capR = 3;
      for (const hx of [sx, ex]) {
        const cx = hx - capW / 2;
        ctx.fillStyle = HANDLE_COLOR;
        ctx.beginPath();
        ctx.roundRect(cx, 2, capW, capH, capR);
        ctx.fill();

        // Three grip dots
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        for (let dot = 0; dot < 3; dot++) {
          ctx.beginPath();
          ctx.arc(hx, 6 + dot * 5, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 7. Playhead
    if (playheadRatio !== undefined && playheadRatio >= 0) {
      const px = playheadRatio * W;
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
  }, [audioBuffer, canvasWidth, startRatio, endRatio, playheadRatio, hasRegion]);

  // ── Pointer events ────────────────────────────────────────────────────────
  const ratioFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!hasRegion || startRatio === undefined || endRatio === undefined)
        return;
      const r = ratioFromEvent(e);
      const W = canvasRef.current?.getBoundingClientRect().width ?? 1;
      const slop = HANDLE_HIT_SLOP / W;

      if (Math.abs(r - startRatio) < slop) {
        dragTarget.current = "start";
      } else if (Math.abs(r - endRatio) < slop) {
        dragTarget.current = "end";
      } else {
        return;
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [hasRegion, startRatio, endRatio, ratioFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragTarget.current || !onRegionChange) return;
      if (startRatio === undefined || endRatio === undefined) return;
      const r = ratioFromEvent(e);
      e.preventDefault();

      if (dragTarget.current === "start") {
        onRegionChange(Math.min(r, endRatio - 0.01), endRatio);
      } else {
        onRegionChange(startRatio, Math.max(r, startRatio + 0.01));
      }
    },
    [onRegionChange, startRatio, endRatio, ratioFromEvent],
  );

  const handlePointerUp = useCallback(() => {
    dragTarget.current = null;
  }, []);

  // ── Cursor ────────────────────────────────────────────────────────────────
  const getCursor = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!hasRegion || startRatio === undefined || endRatio === undefined)
        return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = ratioFromEvent(e);
      const W = canvas.getBoundingClientRect().width;
      const slop = HANDLE_HIT_SLOP / W;
      const nearHandle =
        Math.abs(r - startRatio) < slop || Math.abs(r - endRatio) < slop;
      canvas.style.cursor = nearHandle ? "ew-resize" : "default";
    },
    [hasRegion, startRatio, endRatio, ratioFromEvent],
  );

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 ${className}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={height}
        className="block h-full w-full"
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          getCursor(e);
          handlePointerMove(e);
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
