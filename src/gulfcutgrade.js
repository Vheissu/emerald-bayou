import { GULF_CUT, bridgeDeckAt, bridgeZAt } from './waterfrontlayout.js';

function smoothstep(min, max, value) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

// Cut the natural hummocks around the abutments into short roadside shoulders.
// The main channel and the foundation profiles under the navigation span are untouched.
export function gulfCutApproachHeight(x, z, height) {
  const { west, east } = GULF_CUT;
  const atWest = x > west - 13 && x < west + 29;
  const atEast = x > east - 22 && x < east + 19;
  if ((!atWest && !atEast) || z < -65 || z > -40) return height;
  const offset = Math.abs(z - bridgeZAt(x));
  if (offset >= 10.5) return height;
  const cutHeight = bridgeDeckAt(x) - 0.42 - Math.max(0, offset - 4.4) * 0.10;
  if (height <= cutHeight) return height;
  const path = atWest ? smoothstep(west - 13, west - 5, x) * (1 - smoothstep(west + 23, west + 29, x))
    : smoothstep(east - 22, east - 16, x) * (1 - smoothstep(east + 9, east + 19, x));
  return height - (height - cutHeight) * path * (1 - smoothstep(4.45, 10.5, offset));
}
