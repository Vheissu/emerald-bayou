const MAX_TRAFFIC_WAKE_HEIGHT = 0.24;
export const MAX_DIRECTED_WAKE_HEIGHT = 0.24;
export const MAX_COMBINED_WAKE_HEIGHT = 0.34;

export function clampWakeHeight(height, maxHeight = MAX_COMBINED_WAKE_HEIGHT) {
  const limit = Math.max(0, Number(maxHeight) || 0);
  return Math.max(-limit, Math.min(limit, Number(height) || 0));
}

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

// Mission, police, race, story, and recovery craft already live in small retained agent pools. Sampling those
// records directly makes their rendered wakes physical without building another graph or allocating a hot-path list.
export function sampleVesselWake(sources, x, z, t, defaultMaxSpeed = 11.6, defaultScale = 0.105, maxHeight = MAX_DIRECTED_WAKE_HEIGHT) {
  let height = 0;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source?.active || source.backing || source.speed <= 2.2 || !Number.isFinite(source.x) || !Number.isFinite(source.z) || !Number.isFinite(source.heading)) continue;
    const dx = x - source.x, dz = z - source.z;
    if (dx * dx + dz * dz > 10609) continue;
    const maxSpeed = Number.isFinite(source.wakeMaxSpeed) ? source.wakeMaxSpeed : Number.isFinite(source.maxSpeed) ? source.maxSpeed : Number.isFinite(source.max) ? source.max : defaultMaxSpeed;
    const scale = Number.isFinite(source.wakeScale) ? source.wakeScale : defaultScale;
    height += wakeSampleAt(source.x, source.z, source.heading, source.speed, maxSpeed, scale, x, z, t);
  }
  return clampWakeHeight(height, maxHeight);
}

// The player hull samples several points per physics step. A retained list of fields keeps that work bounded and
// prevents overlapping pursuit wakes from stacking into an implausible launch ramp.
export function sampleWakeFields(fields, x, z, t, maxHeight = MAX_COMBINED_WAKE_HEIGHT) {
  let height = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field || typeof field.wakeHeightAt !== 'function') continue;
    height += field.wakeHeightAt(x, z, t);
  }
  return clampWakeHeight(height, maxHeight);
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
  return clampWakeHeight(height, MAX_TRAFFIC_WAKE_HEIGHT);
}
