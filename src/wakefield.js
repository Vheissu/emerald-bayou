const MAX_TRAFFIC_WAKE_HEIGHT = 0.24;

export function wakeSampleAt(sx, sz, heading, speed, maxSpeed, scale, x, z, t) {
  const strength = Math.max(0, Math.min(1, (speed - 2.2) / Math.max(1, maxSpeed - 2.2))); if (strength <= 0) return 0;
  const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = -Math.cos(heading), rz = Math.sin(heading);
  const dx = x - sx, dz = z - sz, aft = -(dx * fx + dz * fz); if (aft < 1.5 || aft > 95) return 0;
  const lateral = Math.abs(dx * rx + dz * rz), arm = 1.1 + aft * 0.34, width = 0.7 + aft * 0.025;
  const edge = Math.abs(lateral - arm), ridge = Math.exp(-(edge * edge) / (width * width));
  const centerWidth = 1.4 + aft * 0.055, trough = Math.exp(-(lateral * lateral) / (centerWidth * centerWidth));
  if (ridge < 0.002 && trough < 0.002) return 0;
  const phase = t * (4.2 + strength * 0.8) - aft * (0.46 + strength * 0.08) + (sx + sz) * 0.013;
  return scale * strength * strength * Math.exp(-aft / 85) * (ridge * Math.sin(phase) - trough * 0.27 * Math.sin(phase * 0.73 + 1.2));
}

export function trafficWakeScale(kind) {
  return kind === 'air' ? 0.18 : kind === 'cruiser' ? 0.13 : 0.105;
}

// Resident traffic is a fixed seven-hull pool. Sampling it directly keeps the field deterministic and avoids
// allocating a second wake graph or per-frame sample list for the boats that are already alive in the world.
export function sampleTrafficWake(boats, x, z, t, excludeBoat = null) {
  let height = 0;
  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i];
    if (boat === excludeBoat || !boat.active || boat.kind === 'canoe') continue;
    height += wakeSampleAt(boat.x, boat.z, boat.heading, boat.speed, boat.max, trafficWakeScale(boat.kind), x, z, t);
  }
  return Math.max(-MAX_TRAFFIC_WAKE_HEIGHT, Math.min(MAX_TRAFFIC_WAKE_HEIGHT, height));
}
