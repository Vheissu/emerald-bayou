const BAND_SHAPES = {
  lightRain: { width: 195, length: 620, speed: 6.5, rainFloor: 0.07, stormFloor: 0.56 },
  squall: { width: 235, length: 910, speed: 12, rainFloor: 0.20, stormFloor: 0.62 },
  thunderstorm: { width: 340, length: 1060, speed: 10.5, rainFloor: 0.26, stormFloor: 0.80 },
  hail: { width: 270, length: 720, speed: 12.5, rainFloor: 0.33, stormFloor: 0.84 },
  tropical: { width: 610, length: 1950, speed: 16, rainFloor: 0.60, stormFloor: 0.94 },
};

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const turn = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function createWeatherBand(key, x, z, angle, leadSeconds = 0, phase = 0) {
  const shape = Object.hasOwn(BAND_SHAPES, key) ? BAND_SHAPES[key] : null;
  if (!shape) return null;
  const alongX = Math.cos(angle), alongZ = Math.sin(angle), lead = leadSeconds * shape.speed;
  return { key, x: x - alongX * lead, z: z - alongZ * lead, angle, phase, age: 0, alongX, alongZ, shape };
}

export function restoreWeatherBand(key, saved) {
  if (!saved || ![saved.x, saved.z, saved.angle, saved.phase, saved.age].every(Number.isFinite)
    || Math.abs(saved.x) > 32000 || Math.abs(saved.z) > 32000 || saved.age < 0 || saved.age > 600) return null;
  const band = createWeatherBand(key, saved.x, saved.z, turn(saved.angle), 0, turn(saved.phase));
  if (band) band.age = saved.age;
  return band;
}

export function serializeWeatherBand(band) {
  if (!band) return null;
  const { x, z, angle, age, phase } = band;
  return { x, z, angle, age, phase };
}

// The envelope is evaluated in world coordinates. A passing shower keeps its position
// around a bend, and two boats can be under different parts of the same rain band.
export function weatherBandStrength(band, x, z) {
  const { alongX, alongZ, shape, age, phase } = band;
  const dx = x - band.x, dz = z - band.z;
  const across = -dx * alongZ + dz * alongX;
  const along = dx * alongX + dz * alongZ - age * shape.speed;
  const bowed = along + Math.sin(across * 0.0035 + phase) * shape.width * 0.22;
  const core = (1 - smooth(0.32, 1.34, Math.abs(bowed) / shape.width))
    * (1 - smooth(0.32, 1.18, Math.abs(across) / shape.length));
  const tail = (1 - smooth(0.16, 0.73, Math.abs(bowed / shape.width + 1.42)))
    * (1 - smooth(0.18, 0.96, Math.abs(across / shape.length - 0.26)));
  return Math.max(core, tail * 0.48);
}

// This matches the world-space envelope used by gameplay. The sky evaluates it
// where the view ray meets the base of the distant rain curtains.
export const WEATHER_BAND_GLSL = /* glsl */ `
float weatherBandStrength(vec2 world, vec2 center, vec2 wind, vec2 size, float phase) {
  vec2 d = world - center;
  float across = dot(d, vec2(-wind.y, wind.x));
  float along = dot(d, wind);
  float bowed = along + sin(across * 0.0035 + phase) * size.x * 0.22;
  float core = (1.0 - smoothstep(0.32, 1.34, abs(bowed) / size.x))
    * (1.0 - smoothstep(0.32, 1.18, abs(across) / size.y));
  float tail = (1.0 - smoothstep(0.16, 0.73, abs(bowed / size.x + 1.42)))
    * (1.0 - smoothstep(0.18, 0.96, abs(across / size.y - 0.26)));
  return max(core, tail * 0.48);
}
`;

export function bandRain(rain, band, strength) {
  return rain * lerp(band.shape.rainFloor, 1, strength);
}

export function bandWind(wind, band, strength) {
  return wind * (1 - (1 - strength) * (1 - band.shape.rainFloor) * 0.24);
}

export function bandStorm(storm, band, strength) {
  return storm * lerp(band.shape.stormFloor, 1, strength);
}

export function applyWeatherBand(out, target, band, strength) {
  const edge = 1 - strength, { rainFloor } = band.shape;
  const open = edge * (1 - rainFloor);
  out.rain = bandRain(target.rain, band, strength);
  out.wind = bandWind(target.wind, band, strength);
  out.sea = target.sea * (1 - open * 0.22);
  out.hail = target.hail * (1 - open * 0.88);
  out.cloud = target.cloud + open * 0.10;
  out.fog = target.fog * (1 - open * 0.47);
  out.exposure = target.exposure + open * 0.08;
  out.lightning = target.lightning * (1 - open * 0.68);
  out.storm = bandStorm(target.storm, band, strength);
  out.surge = target.surge;
}

export function nextWeatherKey(key, hour, roll) {
  const afternoon = smooth(10, 14, hour) * (1 - smooth(17, 22, hour));
  const fogWindow = hour >= 0.5 && hour < 7.35;
  switch (key) {
    case 'calm':
    case 'fair':
      if (fogWindow && roll < 0.21) return 'fog';
      if (roll < 0.40 + afternoon * 0.16) return 'lightRain';
      if (roll < 0.72 + afternoon * 0.08) return 'overcast';
      return key === 'calm' ? 'fair' : 'calm';
    case 'fog':
      return roll < 0.66 ? 'calm' : 'overcast';
    case 'overcast':
      if (fogWindow && roll < 0.14) return 'fog';
      if (roll < 0.24 - afternoon * 0.11) return 'calm';
      if (roll < 0.81 - afternoon * 0.2) return 'lightRain';
      return 'squall';
    case 'lightRain':
      if (roll < 0.31 - afternoon * 0.14) return 'calm';
      if (roll < 0.66 - afternoon * 0.22) return 'overcast';
      return roll < 0.89 - afternoon * 0.24 ? 'squall' : 'thunderstorm';
    case 'squall':
      return roll < 0.57 - afternoon * 0.22 ? 'lightRain' : 'thunderstorm';
    case 'thunderstorm':
      if (roll < 0.70) return 'lightRain';
      if (roll < 0.87) return 'overcast';
      return roll < 0.97 ? 'hail' : 'tropical';
    case 'hail':
      return roll < 0.78 ? 'lightRain' : 'squall';
    case 'tropical':
      if (roll < 0.17) return 'hurricane';
      return roll < 0.72 ? 'squall' : 'lightRain';
    case 'hurricane':
      return roll < 0.73 ? 'tropical' : 'squall';
    default:
      return 'calm';
  }
}
