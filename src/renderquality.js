// Full-size post targets dominate GPU memory on dense displays. Keep a high-resolution image while preventing a
// Retina or 4K window from multiplying every HDR, depth, antialiasing and reflection attachment without a bound.
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const MAX_DRAW_PIXELS = 3_000_000;
export const FOUR_SAMPLE_MAX_PIXELS = 1_600_000;

export function pixelRatioFor(width, height, devicePixelRatio = 1) {
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const native = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(0.1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const budget = Math.sqrt(MAX_DRAW_PIXELS / cssPixels);
  return Math.min(native, budget);
}

// At high drawing-buffer density, two hardware samples plus the existing FXAA pass retain clean edges. Four samples
// remain available at lower resolutions, where their attachment cost is modest and each sample is more visible.
// `cap` lets the adaptive governor stop samples climbing back to four as it shrinks the buffer on a weak GPU.
export function msaaSamplesFor(width, height, cap = 4) {
  return Math.min(cap, Math.max(1, width) * Math.max(1, height) > FOUR_SAMPLE_MAX_PIXELS ? 2 : 4);
}

// Frame-time governor for machines that cannot hold the fill-rate budget above. The cost of this game is almost
// entirely per-pixel, so the levers are drawing-buffer scale, the MSAA sample cap and the sun shadow map. A machine
// holding 60 fps never leaves rung 0 and renders exactly as before; a struggling one steps down one rung at a time
// (each ~28% less fill) and only climbs back after a long comfortable stretch, so the size never oscillates.
// Frames are fed unclamped; anything over IGNORE_MS (tab switch, shader compile, GC pause) is discarded.
const RUNGS = [
  { renderScale: 1.0, msaaCap: 4, shadowMapSize: 4096 },
  { renderScale: 0.85, msaaCap: 2, shadowMapSize: 4096 },
  { renderScale: 0.72, msaaCap: 2, shadowMapSize: 2048 },
  { renderScale: 0.6, msaaCap: 2, shadowMapSize: 2048 },
  { renderScale: 0.5, msaaCap: 2, shadowMapSize: 2048 },
];
const STEP_DOWN_MS = 21.5; // sustained slower than ~46 fps: give fill rate back
const STEP_UP_MS = 15.2;   // sustained faster than ~65 fps: try the next rung up
const STEP_DOWN_AFTER = 1.6, STEP_UP_AFTER = 11, SETTLE = 2.5, PROBE = 3; // seconds
const IGNORE_MS = 250;

export class AdaptiveQuality {
  constructor(onChange) {
    this.onChange = onChange;
    this.rung = 0; this.ema = 1000 / 60; this.slowT = 0; this.fastT = 0; this.settleT = 0;
    this.probe = null; this.lockT = 0;
  }
  get renderScale() { return RUNGS[this.rung].renderScale; }
  get msaaCap() { return RUNGS[this.rung].msaaCap; }
  get shadowMapSize() { return RUNGS[this.rung].shadowMapSize; }
  frame(frameMs) {
    if (!(frameMs > 0) || frameMs > IGNORE_MS) return;
    const dt = frameMs / 1000;
    if (this.settleT > 0) { this.settleT -= dt; return; } // let reallocation hitches pass unmeasured
    this.ema += (frameMs - this.ema) * 0.05;
    if (this.probe) {
      // A down-step must actually buy frame time. A machine pinned by a 30 Hz cap, vsync or the CPU
      // reads slow no matter how few pixels are drawn; shrinking its image helps nobody. Undo and hold.
      this.probe.t += dt;
      if (this.probe.t > PROBE) {
        if (this.ema > this.probe.before * 0.93) { this.lockT = 90; this.change(this.probe.rung); }
        this.probe = null;
      }
      return;
    }
    if (this.lockT > 0) this.lockT -= dt;
    if (this.ema > STEP_DOWN_MS) { this.slowT += dt; this.fastT = 0; }
    else if (this.ema < STEP_UP_MS) { this.fastT += dt; this.slowT = 0; }
    else { this.slowT = 0; this.fastT = 0; }
    if (this.slowT > STEP_DOWN_AFTER && this.rung < RUNGS.length - 1 && this.lockT <= 0) {
      this.probe = { before: this.ema, rung: this.rung, t: 0 };
      this.change(this.rung + 1);
    } else if (this.fastT > STEP_UP_AFTER && this.rung > 0) this.change(this.rung - 1);
  }
  change(rung) {
    this.rung = rung; this.slowT = 0; this.fastT = 0; this.settleT = SETTLE;
    this.ema = 1000 / 60; // forget the old rung's timings; measure the new one fresh
    if (this.onChange) this.onChange(this);
  }
  stats() { return { rung: this.rung, frameMsEma: this.ema, probing: !!this.probe, lockT: Math.max(0, this.lockT), ...RUNGS[this.rung] }; }
}
