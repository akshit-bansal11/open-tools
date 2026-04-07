import type { VideoEditorState } from "./types";

export function buildVideoFilterChain(s: VideoEditorState): string | null {
  const vf: string[] = [];

  // 1. Crop
  if (s.cropEnabled && s.cropW > 0 && s.cropH > 0) {
    vf.push(`crop=${s.cropW}:${s.cropH}:${s.cropX}:${s.cropY}`);
  }

  // 2. Rotate
  if (s.rotateAngle === 90) vf.push("transpose=1");
  if (s.rotateAngle === 180) vf.push("transpose=1,transpose=1");
  if (s.rotateAngle === 270) vf.push("transpose=2");

  // 3. Flip
  if (s.flipH) vf.push("hflip");
  if (s.flipV) vf.push("vflip");

  // 4. Resize
  if (s.resolution !== "original") {
    vf.push(`scale=-2:${s.resolution}`);
  } else if (s.customW > 0 && s.customH > 0) {
    vf.push(`scale=${s.customW}:${s.customH}`);
  }

  // 5. Speed (video PTS)
  if (Math.abs(s.speed - 1) > 0.01) {
    vf.push(`setpts=${(1 / s.speed).toFixed(6)}*PTS`);
  }

  return vf.length > 0 ? vf.join(",") : null;
}

function buildAtempoChain(speed: number): string[] {
  // atempo only accepts 0.5–2.0, so chain multiple filters for extremes
  if (speed >= 0.5 && speed <= 2.0) {
    return [`atempo=${speed.toFixed(4)}`];
  }
  if (speed > 2.0) {
    // e.g. speed=4: atempo=2.0,atempo=2.0
    const chain: string[] = [];
    let remaining = speed;
    while (remaining > 2.0) {
      chain.push("atempo=2.0");
      remaining /= 2.0;
    }
    chain.push(`atempo=${remaining.toFixed(4)}`);
    return chain;
  }
  // speed < 0.5
  const chain: string[] = [];
  let remaining = speed;
  while (remaining < 0.5) {
    chain.push("atempo=0.5");
    remaining /= 0.5;
  }
  chain.push(`atempo=${remaining.toFixed(4)}`);
  return chain;
}

export function buildAudioFilterChain(s: VideoEditorState): string | null {
  const af: string[] = [];

  if (Math.abs(s.volume - 100) > 1) {
    af.push(`volume=${(s.volume / 100).toFixed(2)}`);
  }

  if (Math.abs(s.speed - 1) > 0.01) {
    af.push(...buildAtempoChain(s.speed));
  }

  return af.length > 0 ? af.join(",") : null;
}
