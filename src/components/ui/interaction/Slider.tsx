// Slider.tsx
// Range selection slider built on Radix UI primitives.

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const sliderClassName = [
  "w-full h-2 rounded-full appearance-none cursor-pointer bg-primary/20 accent-primary",
  "[&::-webkit-slider-thumb]:appearance-none",
  "[&::-webkit-slider-thumb]:h-4",
  "[&::-webkit-slider-thumb]:w-4",
  "[&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:bg-primary",
  "[&::-webkit-slider-thumb]:border-2",
  "[&::-webkit-slider-thumb]:border-background",
  "[&::-webkit-slider-thumb]:shadow-md",
  "[&::-webkit-slider-thumb]:transition-transform",
  "[&::-webkit-slider-thumb]:hover:scale-110",
  "[&::-moz-range-thumb]:h-4",
  "[&::-moz-range-thumb]:w-4",
  "[&::-moz-range-thumb]:rounded-full",
  "[&::-moz-range-thumb]:bg-primary",
  "[&::-moz-range-thumb]:border-2",
  "[&::-moz-range-thumb]:border-background",
  "[&::-moz-range-thumb]:shadow-md",
].join(" ");

function Slider({
  className,
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  ...props
}: React.ComponentProps<"input"> & {
  value?: number;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
    >
      <input
        data-slot="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className={sliderClassName}
        {...props}
      />
    </div>
  );
}

export { Slider };
