const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

const WEATHER_WEIGHT = Object.freeze({
  squall: 0.2,
  thunderstorm: 0.5,
  hail: 0.58,
  tropical: 0.12,
});

// Wet downbursts need a convective storm and a loaded rain or hail core. The returned value is a chance per
// director check, not a percentage of thunderstorms that produce one.
export function downburstFormationChance(weatherKey = '', values = {}) {
  const weather = WEATHER_WEIGHT[weatherKey] || 0;
  if (!weather) return 0;
  const storm = clamp(finite(values.storm)), rain = clamp(finite(values.rain)), hail = clamp(finite(values.hail));
  const lightning = clamp(finite(values.lightning)), wind = Math.max(0, finite(values.wind));
  if (storm < 0.62 || rain < 0.35) return 0;
  const convection = smooth(0.62, 0.96, storm);
  const precipitation = clamp(smooth(0.35, 0.92, rain) * 0.78 + hail * 0.34);
  const core = 0.72 + lightning * 0.18 + hail * 0.18;
  const ambientRoom = 1 - smooth(29, 41, wind) * 0.42;
  return clamp(weather * convection * precipitation * core * ambientRoom, 0, 0.68);
}

export function downburstCanForm(weatherKey = '', values = {}, roll = 1) {
  const sample = clamp(Number.isFinite(Number(roll)) ? Number(roll) : 1);
  return sample < downburstFormationChance(weatherKey, values);
}

// A downburst hits the surface, spreads radially, and leaves its strongest visual edge at the rain foot. Space and
// time are compressed for the playable map, but the divergent flow is preserved. `out` is caller-owned so the field
// can be sampled every frame without allocating.
export function downburstSurfaceState(cell = {}, x = 0, z = 0, out = {}) {
  const duration = Math.max(1, finite(cell.duration) || 1), age = clamp(finite(cell.age), 0, duration);
  const progress = age / duration;
  const lifecycle = smooth(0, 0.075, progress) * (1 - smooth(0.72, 1, progress));
  const spread = smooth(0.015, 0.52, progress);
  const startRadius = Math.max(4, finite(cell.startRadius) || 12), maxRadius = Math.max(startRadius, finite(cell.maxRadius) || 120);
  const radius = lerp(startRadius, maxRadius, spread), width = Math.max(7, radius * 0.14);
  const dx = finite(x) - finite(cell.x), dz = finite(z) - finite(cell.z), distance = Math.hypot(dx, dz);
  const frontDelta = (distance - radius) / width;
  const rainFoot = Math.exp(-frontDelta * frontDelta * 1.85) * lifecycle;
  const interior = smooth(radius * 0.08, radius * 0.24, distance) * (1 - smooth(radius * 0.68, radius * 1.03, distance));
  const intensity = clamp(Math.max(rainFoot, interior * 0.62 * lifecycle));
  const coreRain = (1 - smooth(radius * 0.62, radius * 1.08, distance)) * lifecycle;

  const radialX = distance > 0.25 ? dx / distance : 0, radialZ = distance > 0.25 ? dz / distance : 0;
  const biasX0 = finite(cell.biasX), biasZ0 = finite(cell.biasZ), biasLength = Math.hypot(biasX0, biasZ0);
  const biasX = biasLength > 1e-6 ? biasX0 / biasLength : 1, biasZ = biasLength > 1e-6 ? biasZ0 / biasLength : 0;
  let directionX = radialX * 0.86 + biasX * 0.14, directionZ = radialZ * 0.86 + biasZ * 0.14;
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength > 1e-6) { directionX /= directionLength; directionZ /= directionLength; }
  else { directionX = biasX; directionZ = biasZ; }
  const speed = Math.max(0, finite(cell.peakWind)) * intensity;

  out.progress = progress; out.lifecycle = lifecycle; out.radius = radius; out.width = width; out.distance = distance;
  out.intensity = intensity; out.rainFoot = rainFoot; out.coreRain = coreRain;
  out.directionX = directionX; out.directionZ = directionZ; out.windX = directionX * speed; out.windZ = directionZ * speed; out.speed = speed;
  return out;
}

const CRAFT_EXPOSURE = Object.freeze({ canoe: 1.28, skiff: 1.12, john: 1.08, air: 1, cruiser: 0.88 });

function clearCraftState(out) {
  out.progress = 0; out.lifecycle = 0; out.radius = 0; out.width = 0; out.distance = Infinity;
  out.intensity = 0; out.rainFoot = 0; out.coreRain = 0; out.directionX = 0; out.directionZ = 0;
  out.windX = 0; out.windZ = 0; out.speed = 0; out.frontDistance = Infinity; out.visualWarning = 0; out.urgency = 0;
  return out;
}

// The rain foot is visible before its strongest outflow reaches a skipper. Small open craft treat that cue more
// seriously, while enclosed cruisers are less reactive. The retained field also feeds vessel wind loads later in the
// traffic update, so perception and physics agree without sampling into a new object.
export function downburstCraftUrgency(cell, x = 0, z = 0, kind = 'john', out = {}) {
  if (!cell || cell.active === false) return clearCraftState(out);
  downburstSurfaceState(cell, x, z, out);
  out.frontDistance = Math.abs(out.distance - out.radius);
  out.visualWarning = (1 - smooth(out.width * 0.65, out.width * 3.1, out.frontDistance)) * out.lifecycle;
  const exposure = CRAFT_EXPOSURE[kind] || CRAFT_EXPOSURE.john;
  out.urgency = clamp(Math.max(out.intensity, out.visualWarning * 0.72, out.coreRain * 0.32) * exposure);
  return out;
}

export function downburstReactionReady(state, noticeT = 0, reactionDelay = 0) {
  if (!state || finite(state.urgency) <= 0.025) return false;
  const immediate = finite(state.intensity) >= 0.52
    || (finite(state.lifecycle) > 0.18 && finite(state.frontDistance) <= Math.max(5, finite(state.width) * 0.62));
  return immediate || Math.max(0, finite(noticeT)) >= Math.max(0.1, finite(reactionDelay));
}

// Candidate headings first avoid crossing deeper into the rain core, then prefer lower local exposure. When two
// escape lanes are similarly safe, a skipper quarters the bow toward the radial outflow instead of taking it abeam.
// `probeOut` is shared scratch owned by Traffic; no candidate allocates.
export function downburstProbeScore(cell, current, probeX, probeZ, forwardX, forwardZ, kind = 'john', response = 0, probeOut = {}) {
  const strength = clamp(finite(response));
  if (!strength || !current || !cell || cell.active === false) return 0;
  const probe = downburstCraftUrgency(cell, probeX, probeZ, kind, probeOut);
  const distanceScale = Math.max(18, finite(current.width) * 2);
  const radialChange = clamp((finite(probe.distance) - finite(current.distance)) / distanceScale, -1.6, 1.6);
  const outward = Math.max(0, radialChange), inward = Math.max(0, -radialChange);
  const safer = clamp(finite(current.urgency) - finite(probe.urgency), -1, 1);
  const deeperCore = Math.max(0, finite(probe.coreRain) - finite(current.coreRain));
  const headingLength = Math.hypot(finite(forwardX), finite(forwardZ));
  const bowIntoOutflow = headingLength > 1e-6
    ? -(finite(forwardX) / headingLength * finite(current.directionX) + finite(forwardZ) / headingLength * finite(current.directionZ))
    : 0;
  return strength * (safer * 5.2 + outward * 2.8 - inward * 5.4 - deeperCore * 4.8
    + bowIntoOutflow * finite(current.intensity) * 1.35);
}
