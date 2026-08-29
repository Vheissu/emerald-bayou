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
export function msaaSamplesFor(width, height) {
  return Math.max(1, width) * Math.max(1, height) > FOUR_SAMPLE_MAX_PIXELS ? 2 : 4;
}
