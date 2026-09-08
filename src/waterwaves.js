// These are the existing buoyancy waves. Rendering uses the same coefficients and analytic derivatives; it does
// not invent a second swell field or move the physical support plane to fit an unrelated visual animation.
export const WATER_WAVES = Object.freeze({
  ambient: Object.freeze({ amplitude: 0.04, x: 0.18, z: 0.15, timeX: 0.9, timeZ: 0.7 }),
  ripple: Object.freeze({ amplitude: 0.025, x: 0.4, z: 0.3, time: -1.3 }),
  swell: Object.freeze({ amplitude: 0.105, along: 0.042, speed: 0.62, seaSpeed: 0.12, base: 0.72, modulation: 0.28, across: 0.018, time: 0.21 }),
  chop: Object.freeze({ amplitude: 0.038, along: 0.24, time: -1.8, across: 0.11 }),
  rain: Object.freeze({ amplitude: 0.012, x: 1.7, z: 1.3, time: 5.2 }),
});

export function waterWaveHeight(x, z, t, sea, windAngle, rainAmount) {
  const a = WATER_WAVES.ambient, r = WATER_WAVES.ripple, s = WATER_WAVES.swell, c = WATER_WAVES.chop, rain = WATER_WAVES.rain;
  const ca = Math.cos(windAngle), sa = Math.sin(windAngle), along = x * ca + z * sa, across = -x * sa + z * ca;
  const ambient = a.amplitude * Math.sin(x * a.x + t * a.timeX) * Math.cos(z * a.z + t * a.timeZ)
    + r.amplitude * Math.sin(x * r.x + t * r.time + z * r.z);
  const swell = sea * s.amplitude * Math.sin(along * s.along - t * (s.speed + sea * s.seaSpeed))
    * (s.base + s.modulation * Math.cos(across * s.across + t * s.time));
  const chop = sea * c.amplitude * Math.sin(along * c.along + t * c.time + Math.sin(across * c.across))
    + rainAmount * rain.amplitude * Math.sin(x * rain.x + z * rain.z + t * rain.time);
  return ambient + swell + chop;
}

const a = WATER_WAVES.ambient, r = WATER_WAVES.ripple, s = WATER_WAVES.swell, c = WATER_WAVES.chop, rain = WATER_WAVES.rain;
export const WATER_WAVES_GLSL = `
// Suppress frequencies a coarse horizon cell cannot resolve instead of turning them into kilometre-wide facets.
// The dense near patch retains every original buoyancy component, including the small rain term.
float waterWaveFilter(float frequency, float spacing) { return 1.0 - smoothstep(2.4, 3.1, frequency * spacing); }
vec3 waterWaveSample(vec2 p, float t, float sea, vec2 wind, float rain, float spacing) {
  float ambientFilter = waterWaveFilter(${Math.hypot(a.x, a.z)}, spacing);
  float rippleFilter = waterWaveFilter(${Math.hypot(r.x, r.z)}, spacing);
  float swellFilter = waterWaveFilter(${Math.hypot(s.along, s.across)}, spacing);
  float chopFilter = waterWaveFilter(${c.along + c.across}, spacing);
  float rainFilter = waterWaveFilter(${Math.hypot(rain.x, rain.z)}, spacing);
  float ax = p.x * ${a.x} + t * ${a.timeX}, az = p.y * ${a.z} + t * ${a.timeZ};
  float rp = p.x * ${r.x} + p.y * ${r.z} + t * ${r.time};
  float h = ambientFilter * ${a.amplitude} * sin(ax) * cos(az) + rippleFilter * ${r.amplitude} * sin(rp);
  vec2 gradient = vec2(ambientFilter * ${a.amplitude * a.x} * cos(ax) * cos(az) + rippleFilter * ${r.amplitude * r.x} * cos(rp),
    -ambientFilter * ${a.amplitude * a.z} * sin(ax) * sin(az) + rippleFilter * ${r.amplitude * r.z} * cos(rp));
  vec2 crossWind = vec2(-wind.y, wind.x);
  float along = dot(p, wind), across = dot(p, crossWind);
  float sp = along * ${s.along} - t * (${s.speed} + sea * ${s.seaSpeed});
  float ep = across * ${s.across} + t * ${s.time};
  float envelope = ${s.base} + ${s.modulation} * cos(ep);
  h += swellFilter * sea * ${s.amplitude} * sin(sp) * envelope;
  gradient += swellFilter * sea * ${s.amplitude} * (cos(sp) * ${s.along} * envelope * wind
    - sin(sp) * ${s.modulation * s.across} * sin(ep) * crossWind);
  float cp = along * ${c.along} + t * ${c.time} + sin(across * ${c.across});
  h += chopFilter * sea * ${c.amplitude} * sin(cp);
  gradient += chopFilter * sea * ${c.amplitude} * cos(cp) * (${c.along} * wind + ${c.across} * cos(across * ${c.across}) * crossWind);
  float rainPhase = p.x * ${rain.x} + p.y * ${rain.z} + t * ${rain.time};
  h += rainFilter * rain * ${rain.amplitude} * sin(rainPhase);
  gradient += rainFilter * rain * ${rain.amplitude} * cos(rainPhase) * vec2(${rain.x}, ${rain.z});
  return vec3(h, gradient);
}`;
