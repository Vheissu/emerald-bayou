const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Airboat propellers sit above the water, so this models the hull pressure wave and stern wash lifting soft
// Florida mud rather than an underwater propeller cutting into the bed. The reusable conditions object keeps the
// live frame loop allocation-free.
export function shallowWaterSediment(conditions = {}) {
  const depth = Number.isFinite(conditions.depth) ? conditions.depth : 99;
  const wet = clamp01(conditions.wet);
  if (wet <= 0 || depth <= 0.08 || depth >= 2.7) return 0;

  const submerged = smoothstep(0.10, 0.34, depth);
  const bedReach = 1 - smoothstep(0.72, 2.55, depth);
  const speed = Math.max(0, Number(conditions.speed) || 0);
  const rpm = clamp01(conditions.rpm);
  const throttle = clamp01(conditions.throttle);
  const hullWash = smoothstep(0.35, 8.5, speed);
  const fanWash = smoothstep(0.19, 0.92, rpm);
  const powerWash = smoothstep(0.04, 0.72, throttle);
  const agitation = clamp01(hullWash * 0.72 + fanWash * 0.38 + powerWash * 0.24);
  const softBed = 0.50 + clamp01(conditions.murk) * 0.42;
  return clamp01(submerged * bedReach * agitation * softBed * wet);
}

export function sedimentPlumeRadius(depth, speed) {
  const shallow = 1 - smoothstep(0.7, 2.5, Number.isFinite(depth) ? depth : 99);
  const speedSpread = smoothstep(1.0, 13.0, Math.max(0, Number(speed) || 0));
  return 1.8 + shallow * 0.75 + speedSpread * 1.15;
}
