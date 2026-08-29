const SIDE_ARC = 112.5 * Math.PI / 180;
const AHEAD_OVERLAP = 0.75 * Math.PI / 180;
const ARC_EPSILON = 1e-7;

// Boat local frame: +X starboard, -X port, -Z ahead. A short overlap at dead ahead prevents a camera sitting
// exactly on the bow line from losing one sidelight to floating-point jitter.
export const PLAYER_NAV_LIGHT_LAYOUT = Object.freeze({
  port: Object.freeze({ x: -1.03, y: 0.78, z: -1.55 }),
  starboard: Object.freeze({ x: 1.03, y: 0.78, z: -1.55 }),
  stern: Object.freeze({ x: 0, y: 2.1, z: 1.8 }),
});

export function navigationLightVisibility(localObserverX, localObserverZ, out = {}) {
  const x = Number(localObserverX), z = Number(localObserverZ);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 0.001) {
    out.port = true; out.starboard = true; out.stern = true; return out;
  }
  const bearing = Math.atan2(x, -z);
  out.port = bearing >= -SIDE_ARC - ARC_EPSILON && bearing <= AHEAD_OVERLAP;
  out.starboard = bearing <= SIDE_ARC + ARC_EPSILON && bearing >= -AHEAD_OVERLAP;
  out.stern = Math.abs(bearing) >= SIDE_ARC - ARC_EPSILON;
  return out;
}
