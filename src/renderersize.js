import { Vector2 } from 'three';

const logicalSize = new Vector2();
const dimension = value => Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : 1;

// setPixelRatio calls setSize internally. Applying both used to reset the canvas twice, even for identical sizes.
// Keep one drawing-surface update for an actual window/profile request; callers can resize their HDR targets alone.
export function resizeDrawingSurface(renderer, width, height, pixelRatio = 1, updateStyle = true) {
  const w = dimension(width), h = dimension(height);
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  renderer.getSize(logicalSize);
  const changed = logicalSize.x !== w || logicalSize.y !== h || renderer.getPixelRatio() !== ratio;
  if (changed) renderer.setDrawingBufferSize(w, h, ratio);
  if (updateStyle) {
    const style = renderer.domElement.style, cssWidth = `${w}px`, cssHeight = `${h}px`;
    if (style.width !== cssWidth) style.width = cssWidth;
    if (style.height !== cssHeight) style.height = cssHeight;
  }
  return changed;
}
