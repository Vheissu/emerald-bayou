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
