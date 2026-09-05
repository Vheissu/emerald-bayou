import * as THREE from 'three';
import { lunarAgeAt, lunarIllumination, lunarNightLight, lunarPhaseAt, lunarPhaseName, lunarTideRange } from './lunar.js';
import { updateAttributePrefix } from './cache.js';
import { navigationLightVisibility, PLAYER_NAV_LIGHT_LAYOUT } from './navigationrules.js';
import { applyAirboatWind, combinedSurfaceWind } from './vesselwind.js';
import { LIGHTNING_LIFETIME, LIGHTNING_MAX_SEGMENTS, LIGHTNING_TRUNK_SEGMENTS, lightningSkyDirection, lightningStrokeEnvelope, writeLightningStroke } from './lightning.js';
import {
  insertNearestSettlement, MAX_SETTLEMENT_LIGHTS, MAX_SETTLEMENT_OUTAGES, normalizeSettlementOutages,
  resetSettlementCandidates, serializeSettlementOutages, settlementGridStress, settlementLightLevel,
  settlementPowerRoll, settlementPowerStep, settlementPowerTarget, settlementStrikeOutageMinutes,
} from './settlementpower.js';
import {
  normalizeSurfaceWetness, setGlobalSurfaceWetness, surfaceWetMaterialStats, surfaceWetnessStep, surfaceWetnessTarget,
} from './surfacewetness.js';

const FT = 3.28084;
const MPS_TO_MPH = 2.23694;
const CLOUD_SHADOW_WRAP = 25000;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoothSlope = (a, b, v) => { const t = (v - a) / (b - a); return t > 0 && t < 1 ? 6 * t * (1 - t) / (b - a) : 0; };
const lerp = (a, b, t) => a + (b - a) * t;

// Exposure is already part of the retained grade pass. This model changes only that scalar: it contracts quickly
// around a visible sun, lightning or the night spotlight, then recovers more slowly after the bright source leaves.
// Weather transmission prevents a hidden sun from darkening an overcast or fog-bound frame.
export function eyeExposureTarget({
  baseExposure = 1, daylight = 0, night = 1, sunAltitude = 0, viewSunDot = -1,
  cloud = 0.49, cloudLight = 1, rain = 0, fog = 0, storm = 0, flash = 0,
  spotlight = false, restrictedVisibility = 0,
} = {}) {
  const dayN = clamp(Number(daylight) || 0), nightN = clamp(Number(night) || 0);
  const parsedExposure = Number(baseExposure), dayExposure = clamp(Number.isFinite(parsedExposure) ? parsedExposure : 1, 0.4, 1.2);
  const baseline = lerp(0.54, dayExposure, dayN);
  const sunTransmission = smooth(0.405, 0.485, Number(cloud) || 0)
    * smooth(0.89, 0.985, Number(cloudLight) || 0)
    * (1 - smooth(0.02, 0.45, Number(rain) || 0))
    * (1 - smooth(0.00045, 0.0018, Number(fog) || 0))
    * (1 - smooth(0.12, 0.72, Number(storm) || 0));
  const directSun = dayN * smooth(0.002, 0.055, Number(sunAltitude) || 0)
    * smooth(0.82, 0.965, Number(viewSunDot) || -1) * sunTransmission;
  const lightning = smooth(0.02, 0.65, Number(flash) || 0);
  const localLight = spotlight ? nightN * lerp(0.18, 0.32, clamp(Number(restrictedVisibility) || 0)) : 0;
  const brightSource = clamp(directSun * 0.96 + lightning + localLight);
  const darkRecovery = nightN * 0.085 * (1 - clamp(lightning + localLight));
  return clamp(baseline * (1 + darkRecovery) * (1 - brightSource * 0.34), 0.36, 1.12);
}

export function eyeExposureStep(current = 1, target = 1, dt = 0) {
  const parsedTarget = Number(target), targetN = clamp(Number.isFinite(parsedTarget) ? parsedTarget : 1, 0.36, 1.12);
  const parsedCurrent = Number(current), currentN = clamp(Number.isFinite(parsedCurrent) ? parsedCurrent : targetN, 0.36, 1.12);
  const seconds = clamp(Number(dt) || 0, 0, 0.25);
  if (!seconds) return currentN;
  const rate = targetN < currentN ? 9 : 0.55;
  return targetN + (currentN - targetN) * Math.exp(-seconds * rate);
}

export function surfaceMistEnvelope({ hour = 12, fog = 0, rain = 0, wind = 0, storm = 0 } = {}) {
  const dawnCooling = Math.exp(-Math.pow((hour - 6.35) / 1.75, 2));
  const calm = 1 - smooth(5, 18, wind);
  const weatherFog = smooth(0.0006, 0.0031, fog) * 0.88;
  const rainCooling = smooth(0.22, 0.86, rain) * calm * (1 - smooth(0.52, 1, storm)) * 0.2;
  return clamp(weatherFog + dawnCooling * calm * 0.58 + rainCooling);
}

// Refractive shimmer belongs to sun-heated low surfaces, not to a generic sunny-screen wobble. The thermal lag peaks
// after solar noon; cloud, rain, fog and strong mixing wind all remove the near-surface temperature gradient.
export function heatHazePotential(input = {}, daylightArg = 0, sunAltitudeArg = 0, cloudArg = 0.49, rainArg = 0, windArg = 0, stormArg = 0, fogArg = 0) {
  const object = input && typeof input === 'object';
  const hour = object ? input.hour ?? 12 : input, daylight = object ? input.daylight ?? 0 : daylightArg;
  const sunAltitude = object ? input.sunAltitude ?? 0 : sunAltitudeArg, cloud = object ? input.cloud ?? 0.49 : cloudArg;
  const rain = object ? input.rain ?? 0 : rainArg, wind = object ? input.wind ?? 0 : windArg;
  const storm = object ? input.storm ?? 0 : stormArg, fog = object ? input.fog ?? 0 : fogArg;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const thermalLag = Math.exp(-Math.pow((h - 14) / 3.25, 2));
  const solarHeating = clamp(Number(daylight) || 0) * smooth(0.28, 0.72, Number(sunAltitude) || 0);
  const openDeck = smooth(0.37, 0.5, Number(cloud) || 0);
  const dry = 1 - smooth(0.015, 0.32, Number(rain) || 0);
  const calm = 1 - smooth(7, 22, Number(wind) || 0);
  const clear = 1 - smooth(0.00055, 0.0018, Number(fog) || 0);
  const stable = 1 - smooth(0.08, 0.58, Number(storm) || 0);
  return clamp(thermalLag * solarHeating * openDeck * dry * calm * clear * stable);
}

// Cloud cover is a threshold in the sky shader: lower values build a more continuous deck. Distinct moving
// shadows therefore peak under broken fair/overcast cover, then recede when a severe cell becomes uniformly dark.
export function cloudShadowPotential(cover = 0.49, daylight = 0, sunAltitude = 0, storm = 0) {
  const coverN = clamp(Number(cover) || 0), dayN = clamp(Number(daylight) || 0), stormN = clamp(Number(storm) || 0);
  const cloudMass = 1 - smooth(0.42, 0.56, coverN);
  const openTexture = smooth(0.18, 0.38, coverN);
  const liftedSun = smooth(0.015, 0.13, Number(sunAltitude) || 0);
  return clamp(cloudMass * openTexture * dayN * liftedSun * lerp(1, 0.38, stormN));
}

export function spotlightVolumeState(out = {}, on = false, night = 0, restrictedVisibility = 0, rain = 0, storm = 0, quality = 1) {
  const q = clamp(Number(quality) || 0), nightN = clamp(Number(night) || 0), restricted = clamp(Number(restrictedVisibility) || 0);
  const rainN = clamp(Number(rain) || 0), stormN = clamp(Number(storm) || 0);
  const scatter = clamp(0.055 + restricted * 0.76 + rainN * 0.24 + stormN * 0.08);
  out.strength = on && q > 0 ? q * scatter * lerp(0.55, 1, nightN) : 0;
  out.range = out.strength > 0.018 ? clamp(92 - restricted * 32 - rainN * 9 - stormN * 7, 44, 92) : 0;
  out.visible = out.range > 0;
  return out;
}

export function makeSpotlightVolumeGeometry(radialSegments = 24) {
  const segments = Math.max(8, Math.min(64, Math.trunc(Number(radialSegments) || 24)));
  const shellRadius = [0.43, 0.72, 1], shellDensity = [1, 0.52, 0.2], vertices = segments * 6 * shellRadius.length;
  const positions = new Float32Array(vertices * 3), axial = new Float32Array(vertices), shell = new Float32Array(vertices);
  const near = 0.012, cone = Math.tan(0.31); let vertex = 0;
  const write = (angle, distance, radiusScale, density) => {
    const radius = cone * distance * radiusScale, p = vertex * 3;
    positions[p] = Math.cos(angle) * radius; positions[p + 1] = Math.sin(angle) * radius; positions[p + 2] = -distance;
    axial[vertex] = distance; shell[vertex] = density; vertex++;
  };
  for (let layer = 0; layer < shellRadius.length; layer++) {
    const radiusScale = shellRadius[layer], density = shellDensity[layer];
    for (let segment = 0; segment < segments; segment++) {
      const a0 = segment / segments * Math.PI * 2, a1 = (segment + 1) / segments * Math.PI * 2;
      write(a0, near, radiusScale, density); write(a0, 1, radiusScale, density); write(a1, 1, radiusScale, density);
      write(a0, near, radiusScale, density); write(a1, 1, radiusScale, density); write(a1, near, radiusScale, density);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAxial', new THREE.BufferAttribute(axial, 1));
  geometry.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
  geometry.computeBoundingSphere(); geometry.userData.byteLength = positions.byteLength + axial.byteLength + shell.byteLength;
  return geometry;
}

export class BoatSpotlightVolume {
  constructor(profile = {}) {
    this.geometry = makeSpotlightVolumeGeometry();
    this.uniforms = {
      uColor: { value: new THREE.Color(1.12, 0.91, 0.68) }, uStrength: { value: 0 }, uTime: { value: 0 }, uRain: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `
        attribute float aAxial, aShell;
        varying float vAxial, vShell; varying vec3 vWorld;
        void main() {
          vAxial = aAxial; vShell = aShell;
          vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        precision highp float;
        uniform vec3 uColor; uniform float uStrength, uTime, uRain;
        varying float vAxial, vShell; varying vec3 vWorld;
        void main() {
          float start = smoothstep(0.008, 0.065, vAxial);
          float finish = 1.0 - smoothstep(0.48, 1.0, vAxial);
          float broad = 0.84 + 0.16 * sin(vWorld.x * 0.11 + vWorld.z * 0.087 - uTime * 0.22 + sin(vWorld.y * 0.31));
          float detail = 0.88 + 0.12 * sin(vWorld.x * 0.39 - vWorld.z * 0.27 + uTime * 0.61);
          float streak = 0.82 + 0.18 * sin(vWorld.y * 1.7 - uTime * 13.0 + vWorld.x * 0.2);
          float weather = broad * detail * mix(1.0, streak, uRain);
          float alpha = uStrength * vShell * start * finish * weather * 0.052;
          if (alpha < 0.0004) discard;
          gl_FragColor = vec4(uColor * (0.68 + uStrength * 0.42), alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.name = 'player spotlight atmosphere';
    this.mesh.position.set(0, 1.15, -1.45); this.mesh.rotation.x = -Math.atan2(1.05, 53.55);
    this.mesh.visible = false; this.mesh.renderOrder = 39; this.mesh.layers.set(1);
    this.state = { visible: false, strength: 0, range: 0 }; this.transformWrites = 0; this.uniformWrites = 0;
    this.setQuality(profile);
  }

  setQuality(profile = {}) {
    const value = typeof profile === 'number' ? profile : profile.spotlightVolume;
    this.quality = clamp(Number.isFinite(Number(value)) ? Number(value) : 1);
    if (this.quality <= 0) { this.state.visible = false; this.state.strength = 0; this.state.range = 0; this.mesh.visible = false; this.uniforms.uStrength.value = 0; }
    return this.quality;
  }

  update(time, on, night, restrictedVisibility, rain, storm) {
    spotlightVolumeState(this.state, on, night, restrictedVisibility, rain, storm, this.quality);
    this.mesh.visible = this.state.visible;
    if (!this.state.visible) return this.state;
    if (Math.abs(this.mesh.scale.x - this.state.range) > 0.001) { this.mesh.scale.setScalar(this.state.range); this.transformWrites++; }
    const seconds = Number(time);
    this.uniforms.uStrength.value = this.state.strength; this.uniforms.uTime.value = Number.isFinite(seconds) ? seconds : 0; this.uniforms.uRain.value = clamp(Number(rain) || 0); this.uniformWrites += 3;
    return this.state;
  }

  resourceStats() {
    return {
      visible: this.mesh.visible, strength: this.state.strength, range: this.state.range, quality: this.quality,
      drawCalls: this.mesh.visible ? 1 : 0, geometries: 1, materials: 1, textures: 0, lights: 0,
      vertices: this.geometry.attributes.position.count, geometryBytes: this.geometry.userData.byteLength,
      transformWrites: this.transformWrites, uniformWrites: this.uniformWrites,
    };
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

// Local rain can stop before the retreating curtain has cleared the opposite horizon. Retaining a small amount of
// atmospheric moisture lets a bow emerge during that clearing interval without inventing another weather state.
export function rainbowMoistureStep(current = 0, rain = 0, dt = 0) {
  const moisture = clamp(Number(current) || 0), target = smooth(0.08, 0.72, Number(rain) || 0);
  const seconds = clamp(Number(dt) || 0, 0, 60), rate = target > moisture ? 0.65 : 0.018;
  return clamp(target + (moisture - target) * Math.exp(-seconds * rate));
}

export function rainbowPotential({ moisture = 0, rain = 0, storm = 0, daylight = 0, sunAltitude = 0, cloudLight = 1 } = {}) {
  const droplets = smooth(0.12, 0.52, Math.max(Number(moisture) || 0, (Number(rain) || 0) * 0.72));
  const clearing = 1 - smooth(0.72, 0.98, Number(storm) || 0);
  const lowSun = smooth(0.015, 0.075, Number(sunAltitude) || 0) * (1 - smooth(0.58, 0.72, Number(sunAltitude) || 0));
  const sunBreak = smooth(0.88, 0.98, Number(cloudLight) || 0);
  const rainVeil = 1 - smooth(0.82, 1, Number(rain) || 0);
  return clamp(droplets * clearing * lowSun * clamp(Number(daylight) || 0) * sunBreak * rainVeil);
}

export function rainbowResponse(current = 0, target = 0, dt = 0) {
  const from = clamp(Number(current) || 0), to = clamp(Number(target) || 0), seconds = clamp(Number(dt) || 0, 0, 60);
  const rate = to > from ? 0.45 : 0.18;
  return clamp(to + (from - to) * Math.exp(-seconds * rate));
}

// One hurricane is a passage over the boat, not a flat weather preset. The retained output object lets the
// render loop drive every existing weather system without allocating a new phase snapshot each frame.
export function hurricanePassage(progress = 0, out = {}) {
  const p = clamp(Number(progress) || 0);
  const frontWall = smooth(0.12, 0.23, p) * (1 - smooth(0.38, 0.45, p));
  const backWall = smooth(0.55, 0.63, p) * (1 - smooth(0.81, 0.91, p));
  const eyewall = Math.max(frontWall, backWall);
  const eye = smooth(0.385, 0.45, p) * (1 - smooth(0.55, 0.615, p));
  const leadingBands = lerp(0.62, 0.84, smooth(0, 0.18, p));
  const trailingBands = lerp(0.84, 0.56, smooth(0.82, 1, p));
  const background = p < 0.5 ? leadingBands : trailingBands;
  const rainBands = p < 0.5 ? lerp(0.54, 0.8, smooth(0, 0.18, p)) : lerp(0.78, 0.44, smooth(0.82, 1, p));
  const seaBands = p < 0.5 ? lerp(0.66, 0.84, smooth(0, 0.18, p)) : lerp(0.86, 0.7, smooth(0.82, 1, p));
  // Storm surge is accumulated water, so it lags the first violent wind, remains through the eye and reaches its
  // local maximum on the backside before draining through the trailing bands. The slope is retained as a current
  // contribution: rising surge floods the cuts and draining surge strengthens the ebb.
  const surgeRise = smooth(0.02, 0.46, p), surgeBack = smooth(0.5, 0.67, p), surgeDrain = smooth(0.76, 0.9, p), surgeTrail = smooth(0.79, 1, p);
  const surgeShoulder = surgeBack * (1 - surgeDrain), surgeBase = 0.16 + surgeRise * 0.84 + surgeShoulder * 0.1, surgeFall = 1 - surgeTrail * 0.62;
  const shoulderSlope = smoothSlope(0.5, 0.67, p) * (1 - surgeDrain) - surgeBack * smoothSlope(0.76, 0.9, p);
  const surgeSlope = (smoothSlope(0.02, 0.46, p) * 0.84 + shoulderSlope * 0.1) * surgeFall - surgeBase * smoothSlope(0.79, 1, p) * 0.62;
  out.progress = p;
  out.phase = p < 0.16 ? 'outer-bands' : p < 0.42 ? 'front-eyewall' : p < 0.58 ? 'eye' : p < 0.91 ? 'back-eyewall' : 'trailing-bands';
  out.eye = eye;
  out.eyewall = eyewall;
  out.windScale = lerp(background, 1.08, eyewall);
  out.rainScale = lerp(rainBands, 1.12, eyewall);
  out.seaScale = lerp(seaBands, 1.06, eyewall);
  out.surgeScale = surgeBase * surgeFall;
  out.surgeTrend = clamp(surgeSlope * 0.052, -0.24, 0.24);
  out.windShift = Math.PI * smooth(0.39, 0.61, p);
  out.pressureHpa = Math.round(p <= 0.5 ? lerp(1004, 976, smooth(0, 0.5, p)) : lerp(976, 1001, smooth(0.5, 1, p)));
  return out;
}

export function applyHurricanePassage(values, passage, blend = 1) {
  const t = clamp(Number(blend) || 0), eye = passage.eye || 0, wall = passage.eyewall || 0;
  const wind = lerp(values.wind * passage.windScale, 3.2, eye);
  const rain = lerp(clamp(values.rain * passage.rainScale), 0.015, eye);
  const sea = lerp(values.sea * passage.seaScale, 1.62, eye);
  const cloud = lerp(values.cloud, 0.58, eye);
  const hail = values.hail * lerp(0.2, 0.72, wall) * (1 - eye);
  const fog = lerp(values.fog, 0.00034, eye);
  const exposure = lerp(values.exposure, 0.97, eye);
  const lightning = lerp(values.lightning, 0.035, eye);
  const storm = lerp(clamp(0.72 + passage.windScale * 0.26), 0.32, eye);
  const surge = Math.max(0, Number(values.surge) || 0) * clamp(Number(passage.surgeScale) || 1, 0, 1.25);
  values.wind = lerp(values.wind, wind, t);
  values.rain = lerp(values.rain, rain, t);
  values.sea = lerp(values.sea, sea, t);
  values.cloud = lerp(values.cloud, cloud, t);
  values.hail = lerp(values.hail, hail, t);
  values.fog = lerp(values.fog, fog, t);
  values.exposure = lerp(values.exposure, exposure, t);
  values.lightning = lerp(values.lightning, lightning, t);
  values.storm = lerp(values.storm, storm, t);
  values.surge = lerp(values.surge, surge, t);
  return values;
}

const HURRICANE_ALERTS = {
  'front-eyewall': ['Leading eyewall', 'The strongest wind and blinding rain are closing over the channel.'],
  eye: ['Eye overhead', 'Do not trust the calm. Surge and rough water remain; the wind will return from the opposite quarter.'],
  'back-eyewall': ['Backside eyewall', 'Wind reversing. Loose debris will move from the opposite quarter.'],
  'trailing-bands': ['Eyewall clear', 'The worst wind has passed, but surge and trailing squalls remain.'],
};

// Wind values are metres per second. A hurricane is intentionally uncommon in the natural
// sequence, but it is a fully simulated state rather than a cosmetic preset.
const WEATHER = {
  fair: {
    label: 'Fair', cloud: 0.49, rain: 0, hail: 0, wind: 3.5, sea: 0.08, fog: 0.00028,
    exposure: 1.02, surge: 0, lightning: 0, storm: 0, duration: [140, 230],
    call: 'Blue sky opening over the lower river.',
  },
  fog: {
    label: 'Dense fog', cloud: 0.52, rain: 0, hail: 0, wind: 1.6, sea: 0.04, fog: 0.0034,
    exposure: 0.9, surge: 0, lightning: 0, storm: 0.02, duration: [95, 170],
    call: 'Dense fog in the back cuts. Slow down, listen, and sound before blind bends.',
  },
  overcast: {
    label: 'Overcast', cloud: 0.40, rain: 0.04, hail: 0, wind: 6.5, sea: 0.28, fog: 0.00042,
    exposure: 0.89, surge: 0.02, lightning: 0, storm: 0.28, duration: [100, 190],
    call: "Pressure's falling. The light just went flat.",
  },
  squall: {
    label: 'Squall line', cloud: 0.31, rain: 0.68, hail: 0, wind: 14, sea: 0.78, fog: 0.00072,
    exposure: 0.76, surge: 0.08, lightning: 0.2, storm: 0.68, duration: [70, 125],
    call: "Squall line. Wind's cutting across the channel.",
  },
  thunderstorm: {
    label: 'Thunderstorm', cloud: 0.24, rain: 1, hail: 0.08, wind: 18, sea: 1.05, fog: 0.00096,
    exposure: 0.68, surge: 0.12, lightning: 0.9, storm: 0.9, duration: [75, 140],
    call: 'Severe thunderstorm. Get out of the open water.',
  },
  hail: {
    label: 'Hail storm', cloud: 0.22, rain: 0.78, hail: 1, wind: 20, sea: 0.9, fog: 0.00105,
    exposure: 0.65, surge: 0.08, lightning: 0.65, storm: 0.94, duration: [45, 85],
    call: 'Hail core overhead. Keep your face down.',
  },
  tropical: {
    label: 'Tropical storm', cloud: 0.20, rain: 0.94, hail: 0, wind: 25, sea: 1.45, fog: 0.00108,
    exposure: 0.63, surge: 0.32, lightning: 0.45, storm: 1, duration: [120, 210],
    call: 'Tropical storm bands have reached the bayou.',
  },
  hurricane: {
    label: 'Hurricane', cloud: 0.16, rain: 1, hail: 0.12, wind: 36, sea: 2.15, fog: 0.00134,
    exposure: 0.56, surge: 0.9, lightning: 0.62, storm: 1, duration: [150, 250],
    call: 'Hurricane warning. Surge is already in the backwater.',
  },
};
const WEATHER_ORDER = Object.keys(WEATHER);
const WEATHER_FIELDS = ['cloud', 'rain', 'hail', 'wind', 'sea', 'fog', 'exposure', 'surge', 'lightning', 'storm'];
const WEATHER_LIMITS = Object.fromEntries(WEATHER_FIELDS.map(field => {
  let lo = Infinity, hi = -Infinity;
  for (const name of WEATHER_ORDER) { const value = WEATHER[name][field]; lo = Math.min(lo, value); hi = Math.max(hi, value); }
  return [field, [lo, hi]];
}));

function weatherSnapshot(source, fallback) {
  const out = {};
  for (const key of WEATHER_FIELDS) {
    const n = Number(source && source[key]);
    const [lo, hi] = WEATHER_LIMITS[key];
    out[key] = Number.isFinite(n) ? clamp(n, lo, hi) : fallback[key];
  }
  return out;
}

function mixedWeather(out, a, b, t) {
  const e = t * t * (3 - 2 * t);
  for (const k of WEATHER_FIELDS) out[k] = lerp(a[k], b[k], e);
  return out;
}

function makeRain(count = 2200) {
  const pos = new Float32Array(count * 6);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const j = i * 6;
    pos[j] = (Math.random() - 0.5) * 100; pos[j + 1] = Math.random() * 44; pos[j + 2] = (Math.random() - 0.5) * 100;
    pos[j + 3] = pos[j]; pos[j + 4] = pos[j + 1]; pos[j + 5] = pos[j + 2]; speed[i] = 25 + Math.random() * 25;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color: 0xcfe1e8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 80;
  return { count, pos, speed, geo, mat, lines };
}

function makeHail(count = 720) {
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    pos[j] = (Math.random() - 0.5) * 70; pos[j + 1] = Math.random() * 36; pos[j + 2] = (Math.random() - 0.5) * 70; speed[i] = 18 + Math.random() * 12;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ color: 0xf5fbff, size: 0.11, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 81;
  return { count, pos, speed, geo, mat, points };
}

export class Precipitation {
  constructor(scene, { rain = 2200, hail = 720 } = {}) {
    this.rain = makeRain(rain); this.hail = makeHail(hail);
    this.group = new THREE.Group(); this.group.name = 'weather'; this.group.add(this.rain.lines, this.hail.points); scene.add(this.group);
  }
  update(dt, camera, windDir, rainAmt, hailAmt, waterLevel) {
    this.group.position.set(camera.x, waterLevel, camera.z);
    const R = this.rain, rn = Math.floor(R.count * smooth(0.03, 1, rainAmt));
    R.geo.setDrawRange(0, rn * 2); R.mat.opacity = 0.08 + rainAmt * 0.34; R.lines.visible = rn > 0;
    const slant = 4 + rainAmt * 8;
    for (let i = 0; i < rn; i++) {
      const j = i * 6; let x = R.pos[j] + windDir.x * slant * dt, y = R.pos[j + 1] - R.speed[i] * dt, z = R.pos[j + 2] + windDir.z * slant * dt;
      if (y < 0) { y += 42; x = (Math.random() - 0.5) * 100; z = (Math.random() - 0.5) * 100; }
      if (x > 50) x -= 100; else if (x < -50) x += 100;
      if (z > 50) z -= 100; else if (z < -50) z += 100;
      const len = 0.8 + rainAmt * 1.9;
      R.pos[j] = x; R.pos[j + 1] = y; R.pos[j + 2] = z;
      R.pos[j + 3] = x - windDir.x * len * 0.55; R.pos[j + 4] = y + len; R.pos[j + 5] = z - windDir.z * len * 0.55;
    }
    if (rn) updateAttributePrefix(R.geo.attributes.position, rn * 6);

    const H = this.hail, hn = Math.floor(H.count * smooth(0.05, 1, hailAmt));
    H.geo.setDrawRange(0, hn); H.mat.opacity = 0.25 + hailAmt * 0.75; H.points.visible = hn > 0;
    for (let i = 0; i < hn; i++) {
      const j = i * 3; let x = H.pos[j] + windDir.x * 7 * dt, y = H.pos[j + 1] - H.speed[i] * dt, z = H.pos[j + 2] + windDir.z * 7 * dt;
      if (y < 0) { y += 35; x = (Math.random() - 0.5) * 70; z = (Math.random() - 0.5) * 70; }
      if (x > 35) x -= 70; else if (x < -35) x += 70;
      if (z > 35) z -= 70; else if (z < -35) z += 70;
      H.pos[j] = x; H.pos[j + 1] = y; H.pos[j + 2] = z;
    }
    if (hn) updateAttributePrefix(H.geo.attributes.position, hn * 3);
  }
}

function addBulb(parent, color, x, y, z, radius = 0.055) {
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}

export class Environment {
  constructor(o) {
    Object.assign(this, o); // scene, fxScene, camera, terrain, world, water, sky, sun, hemi, pipeline, wind, boat, audio, game
    const saved = this.game.save.environment || {};
    const savedMinutes = Number(saved.minutes), savedRemaining = Number(saved.remaining), savedDuration = Number(saved.duration), savedWind = Number(saved.windAngle), savedMix = Number(saved.mix);
    this.minutes = Number.isFinite(savedMinutes) && savedMinutes >= 0 ? Math.min(savedMinutes, 1440 * 36500) : 17 * 60 + 5; // a full day takes thirty real minutes
    this.minutesPerSecond = 0.8;
    this.key = WEATHER[saved.key] ? saved.key : 'fair';
    this.from = weatherSnapshot(saved.from, WEATHER[this.key]); this.to = { ...WEATHER[this.key] };
    this.mix = Number.isFinite(savedMix) ? clamp(savedMix) : 1; this.transition = 24;
    this.values = {}; mixedWeather(this.values, this.from, this.to, this.mix);
    this.restrictedVisibility = smooth(0.00085, 0.0029, this.values.fog);
    this.remaining = Number.isFinite(savedRemaining) ? clamp(savedRemaining, 0, 600) : 95;
    const [durationLo, durationHi] = WEATHER[this.key].duration, inferredDuration = (durationLo + durationHi) * 0.5;
    this.weatherDuration = Number.isFinite(savedDuration) && savedDuration >= this.remaining ? clamp(savedDuration, 1, 600) : Math.max(this.remaining, inferredDuration);
    this.windAngle = Number.isFinite(savedWind) ? Math.atan2(Math.sin(savedWind), Math.cos(savedWind)) : 0.7;
    this.localWindAngle = this.windAngle; this.hurricaneBlend = 0; this.surgeRate = 0;
    this.hurricane = { phase: '', progress: 0, eye: 0, eyewall: 0, windScale: 1, rainScale: 1, seaScale: 1, surgeScale: 1, surgeTrend: 0, windShift: 0, pressureHpa: 1004 };
    this.lastHurricanePhase = ''; this.updateHurricanePassage(false);
    this.gust = 1; this.waterLevel = 0; this.astronomicalTideRate = 0; this.tideRate = 0; this.daylight = 0; this.night = 1; this.moonlight = 0; this.syncClockAndTide(); this.persistT = 10;
    this.rainbowMoisture = smooth(0.08, 0.72, this.values.rain); this.rainbow = 0; this.rainbowOverride = null;
    this.surfaceWetness = normalizeSurfaceWetness(saved.surfaceWetness, surfaceWetnessTarget(this.values.rain, this.values.hail, this.values.fog, this.daylight));
    this.navVisibility = { port: true, starboard: true, stern: true }; this.hornCooldown = 0;
    this.precip = new Precipitation(this.fxScene, this.effectBudget);
    this.windDir = new THREE.Vector3(1, 0, 0); this.moonDir = new THREE.Vector3(); this.viewDir = new THREE.Vector3(0, 0, -1);
    this.cloudShadowOffset = new THREE.Vector2(); this.cloudShadowAmount = 0; this.heatHaze = 0; this.heatHazeTarget = 0;
    this.lightDir = this.sunDir.clone();
    this.sunWarm = new THREE.Color(0xff9a62); this.sunDay = new THREE.Color(0xfff1d6); this.sunNight = new THREE.Color(0x91a8d5); this.flashColor = new THREE.Color(0xeaf5ff);
    this.fogDay = new THREE.Color(0x94aebc); this.fogStorm = new THREE.Color(0x263a40); this.fogNight = new THREE.Color(0x07111a); this.fogMist = new THREE.Color();
    this.flash = 0; this.flashDirection = new THREE.Vector3(0, 1, 0); this.lightningCloudY = 220;
    this.boltT = 0; this.boltAge = 0; this.boltSegments = 0; this.lightningT = 16; this.thunderT = -1; this.thunderX = 0; this.thunderZ = 0; this.hailKick = 0;
    const initialSunY = Math.sin((this.hour - 6) / 24 * Math.PI * 2), initialDaylight = smooth(-0.08, 0.16, initialSunY), initialNight = 1 - smooth(-0.04, 0.18, initialSunY);
    this.sunGaze = -1; this.eyeExposure = eyeExposureTarget({ baseExposure: this.values.exposure, daylight: initialDaylight, night: initialNight, cloud: this.values.cloud, rain: this.values.rain, fog: this.values.fog, storm: this.values.storm }); this.eyeExposureTarget = this.eyeExposure;
    this.settlementOutages = normalizeSettlementOutages(saved.powerOutages, this.minutes);
    this.settlementPowerFailures = Math.max(0, Math.trunc(Number(saved.powerFailures) || 0));
    this.windLoad = { ax: 0, az: 0, yaw: 0, heel: 0, apparentSpeed: 0, crosswind: 0 };
    this.surfaceWind = { x: 0, z: 0, speed: 0 };
    this.makeLightning(); this.makeBoatLights(); this.makeSettlementLights();
    setGlobalSurfaceWetness(this.surfaceWetness); this.terrain.setSurfaceWetness(this.surfaceWetness, this.waterLevel);
    this.el = document.getElementById('worldState'); this.alertEl = document.getElementById('weatherAlert'); this.alertT = 0; this.hudT = 0;
    this.keyHandler = (e) => this.onKey(e); window.addEventListener('keydown', this.keyHandler);
    this.pagehideHandler = () => this.persistState(true); window.addEventListener('pagehide', this.pagehideHandler);
    this.persistState(false);
  }

  makeLightning() {
    const p = new Float32Array(LIGHTNING_MAX_SEGMENTS * 6), c = new Float32Array(LIGHTNING_MAX_SEGMENTS * 6);
    const position = new THREE.BufferAttribute(p, 3), color = new THREE.BufferAttribute(c, 3);
    position.setUsage(THREE.DynamicDrawUsage); color.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', position); g.setAttribute('color', color); g.setDrawRange(0, 0);
    g.userData.byteLength = p.byteLength + c.byteLength;
    const m = new THREE.LineBasicMaterial({ color: 0xeaf6ff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.boltTrunk = new Float32Array((LIGHTNING_TRUNK_SEGMENTS + 1) * 3);
    this.bolt = new THREE.LineSegments(g, m); this.bolt.name = 'branched lightning'; this.bolt.visible = false; this.bolt.frustumCulled = false; this.scene.add(this.bolt);
  }

  lightningSnapshot() {
    return {
      active: this.bolt.visible, segments: this.boltSegments, capacity: LIGHTNING_MAX_SEGMENTS, returnStrokes: 3,
      drawCalls: this.bolt.visible ? 1 : 0, geometries: 1, materials: 1, textures: 0,
      geometryBytes: this.bolt.geometry.userData.byteLength, scratchBytes: this.boltTrunk.byteLength,
    };
  }

  stormSkySnapshot() {
    return {
      rain: this.values.rain, storm: this.values.storm, flash: this.flash,
      flashDirection: { x: this.flashDirection.x, y: this.flashDirection.y, z: this.flashDirection.z },
      weatherDetail: this.sky.uniforms.weatherDetail.value,
      extraObjects: 0, extraDrawCalls: 0, extraTextures: 0, extraRenderTargets: 0,
    };
  }

  makeBoatLights() {
    const g = new THREE.Group(); g.name = 'navigation-lights';
    const port = PLAYER_NAV_LIGHT_LAYOUT.port, starboard = PLAYER_NAV_LIGHT_LAYOUT.starboard, stern = PLAYER_NAV_LIGHT_LAYOUT.stern;
    this.port = addBulb(g, 0xff2418, port.x, port.y, port.z, 0.06);
    this.starboard = addBulb(g, 0x2cff7c, starboard.x, starboard.y, starboard.z, 0.06);
    this.stern = addBulb(g, 0xffffff, stern.x, stern.y, stern.z, 0.07);
    this.cockpitLight = new THREE.PointLight(0xffd69a, 0, 13, 2); this.cockpitLight.position.set(0, 1.7, 0.8); g.add(this.cockpitLight);
    const spot = new THREE.SpotLight(0xfff3dc, 0, 110, 0.31, 0.58, 2); spot.position.set(0, 1.15, -1.45);
    const target = new THREE.Object3D(); target.position.set(0, 0.1, -55); spot.target = target; g.add(spot, target); this.spotlight = spot; this.spotOn = false;
    this.spotlightVolume = new BoatSpotlightVolume(this.profile); g.add(this.spotlightVolume.mesh);
    this.boat.add(g); this.nav = g;
  }

  setQuality(profile = {}) { return this.spotlightVolume?.setQuality(profile) ?? 0; }
  spotlightVolumeSnapshot() { return this.spotlightVolume.resourceStats(); }

  makeSettlementLights() {
    this.settlementLights = [];
    this.settlementBulbGeometry = new THREE.SphereGeometry(0.09, 8, 6);
    this.settlementBulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffbd73, toneMapped: false });
    for (let i = 0; i < MAX_SETTLEMENT_LIGHTS; i++) {
      const group = new THREE.Group(), bulb = new THREE.Mesh(this.settlementBulbGeometry, this.settlementBulbMaterial);
      const light = new THREE.PointLight(0xffa95f, 0, 42, 2); group.add(bulb, light); group.visible = false;
      this.scene.add(group); this.settlementLights.push({ group, bulb, light, key: '', day: 0, roll: 1, phase: i * 1.37, power: 1, target: 1 });
    }
    this.settlementCandidates = Array.from({ length: MAX_SETTLEMENT_LIGHTS }, () => ({ key: '', x: 0, y: 0, z: 0, distanceSq: Infinity }));
    this.settlementPowerStats = { pool: MAX_SETTLEMENT_LIGHTS, active: 0, powered: 0, brownouts: 0, dark: 0, outages: this.settlementOutages?.size || 0, strikeFailures: this.settlementPowerFailures || 0, stress: 0 };
    this.settlementT = 0;
  }

  onKey(e) {
    if (e.repeat) return;
    if (e.code === 'KeyL' && this.game.playing && !this.game.paused && !this.game.menuOpen && !this.game.mapOpen) {
      this.spotOn = !this.spotOn; this.game.toast(`Spotlight ${this.spotOn ? 'on' : 'off'}`, this.spotOn ? 'L sweeps the channel ahead' : '', 1.3);
    }
    if (e.code === 'KeyH' && this.hornCooldown <= 0 && this.game.playing && !this.game.paused && !this.game.menuOpen && !this.game.mapOpen) {
      const prolonged = this.restrictedVisibility > 0.45;
      if (prolonged) { this.audio.fogHorn(0.34); this.game.toast('Prolonged blast', 'Restricted visibility · four to six seconds', 2.2); }
      else this.audio.horn(0.38);
      this.hornCooldown = prolonged ? 5.1 : 0.65;
      this.traffic?.signalPlayerHorn(prolonged);
      this.onPlayerHorn?.(prolonged);
    }
    // Test hooks are keys as well as methods on window.__dbg.environment. They make every extreme state inspectable.
    if (import.meta.env.DEV && e.code === 'F7') { e.preventDefault(); this.setHour((this.hour + 2) % 24); }
    if (import.meta.env.DEV && e.code === 'F8') { e.preventDefault(); this.cycleWeather(true); }
  }

  syncClockAndTide() {
    this.day = Math.floor(this.minutes / 1440) + 1; this.hour = (this.minutes / 60) % 24;
    this.lunarAge = lunarAgeAt(this.minutes); this.lunarPhase = lunarPhaseAt(this.minutes);
    this.moonIllumination = lunarIllumination(this.lunarPhase); this.tideRange = lunarTideRange(this.lunarPhase);
    const absHours = this.minutes / 60, tidePhase = absHours / 12.42 * Math.PI * 2;
    const astronomical = (Math.sin(tidePhase) * 0.34 + Math.sin(tidePhase * 0.5 + 0.8) * 0.08) * this.tideRange;
    this.waterLevel = astronomical + (this.values.surge || 0);
    this.astronomicalTideRate = (Math.cos(tidePhase) * 0.34 + Math.cos(tidePhase * 0.5 + 0.8) * 0.04) * this.tideRange;
    this.tideRate = clamp(this.astronomicalTideRate + (Number(this.surgeRate) || 0), -0.5, 0.5);
  }
  clockLabel() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60), ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  }
  weatherLabel() {
    if (this.key !== 'hurricane') return WEATHER[this.key].label;
    if (this.hurricane.phase === 'eye') return 'Hurricane eye';
    if (this.hurricane.phase === 'front-eyewall' || this.hurricane.phase === 'back-eyewall') return 'Hurricane eyewall';
    return 'Hurricane bands';
  }
  tideLabel() {
    const tideFt = this.waterLevel * FT;
    const motion = Math.abs(this.tideRate) < 0.015 ? 'Slack' : this.tideRate > 0 ? 'Rising' : 'Falling';
    return `${motion} ${tideFt >= 0 ? '+' : ''}${tideFt.toFixed(1)} ft`;
  }
  lunarSnapshot() { return { age: this.lunarAge, phase: this.lunarPhase, name: lunarPhaseName(this.lunarPhase), illumination: this.moonIllumination, tideRange: this.tideRange, altitude: this.moonDir?.y || 0, light: this.moonlight }; }
  persistState(write = true) {
    this.game.save.environment = {
      minutes: this.minutes,
      key: this.key,
      from: weatherSnapshot(this.from, WEATHER[this.key]),
      mix: this.mix,
      remaining: this.remaining,
      duration: this.weatherDuration,
      windAngle: this.windAngle,
      surfaceWetness: Math.round(this.surfaceWetness * 10000) / 10000,
      powerOutages: serializeSettlementOutages(this.settlementOutages, this.minutes),
      powerFailures: Math.max(0, Math.trunc(Number(this.settlementPowerFailures) || 0)),
      savedAt: Date.now(),
    };
    if (write) this.game.persist();
  }
  setHour(hour) {
    this.minutes = (this.day - 1) * 1440 + ((hour % 24) + 24) % 24 * 60;
    this.syncClockAndTide(); this.persistState(true);
  }
  setRainbow(value = null) {
    const n = Number(value); this.rainbowOverride = value === null || value === undefined || !Number.isFinite(n) ? null : clamp(n);
    if (this.rainbowOverride !== null) this.rainbow = this.rainbowOverride;
    this.sky.uniforms.rainbow.value = this.rainbow;
    return this.rainbowOverride;
  }
  rainbowSnapshot() {
    return { intensity: this.rainbow, moisture: this.rainbowMoisture, forced: this.rainbowOverride !== null };
  }
  surfaceWetnessSnapshot() {
    return {
      value: this.surfaceWetness,
      target: surfaceWetnessTarget(this.values.rain, this.values.hail, this.values.fog, this.daylight),
      terrainUniforms: this.terrain.uniforms ? 2 : 0,
      materials: surfaceWetMaterialStats(),
    };
  }
  cloudShadowSnapshot() {
    const grade = this.pipeline.grade.material.uniforms;
    return {
      amount: this.cloudShadowAmount, quality: grade.cloudShadowQuality.value,
      offsetX: this.cloudShadowOffset.x, offsetZ: this.cloudShadowOffset.y,
      extraPasses: 0, extraPrograms: 0, extraTextures: 0, extraAttachmentBytes: 0,
    };
  }
  heatHazeSnapshot() {
    const grade = this.pipeline.grade.material.uniforms;
    return {
      amount: this.heatHaze, target: this.heatHazeTarget, quality: grade.heatQuality.value,
      extraPasses: 0, extraPrograms: 0, extraTextures: 0, extraAttachmentBytes: 0,
    };
  }
  eyeAdaptationSnapshot() {
    return {
      exposure: this.eyeExposure, target: this.eyeExposureTarget, sunGaze: this.sunGaze,
      extraPasses: 0, extraPrograms: 0, extraTextures: 0, extraUniforms: 0, extraAttachmentBytes: 0,
    };
  }
  hurricaneSnapshot() {
    const H = this.hurricane;
    return { phase: H.phase, progress: H.progress, eye: H.eye, eyewall: H.eyewall, pressureHpa: H.pressureHpa, windShift: H.windShift, surgeScale: H.surgeScale, surge: this.values.surge, surgeRate: this.surgeRate, waterLevel: this.waterLevel, tideRate: this.tideRate, duration: this.weatherDuration, remaining: this.remaining };
  }
  updateHurricanePassage(announce = false) {
    const H = this.hurricane;
    if (this.key !== 'hurricane') {
      H.phase = ''; H.progress = 0; H.eye = 0; H.eyewall = 0; H.windScale = 1; H.rainScale = 1; H.seaScale = 1; H.surgeScale = 1; H.surgeTrend = 0; H.windShift = 0; H.pressureHpa = 1004;
      this.hurricaneBlend = 0; this.surgeRate = 0; this.localWindAngle = this.windAngle; this.lastHurricanePhase = '';
      return H;
    }
    hurricanePassage(1 - this.remaining / Math.max(1, this.weatherDuration), H);
    this.hurricaneBlend = smooth(0.5, 1, this.mix);
    applyHurricanePassage(this.values, H, this.hurricaneBlend);
    this.surgeRate = H.surgeTrend * this.hurricaneBlend;
    this.localWindAngle = this.windAngle + H.windShift * this.hurricaneBlend;
    if (H.phase !== this.lastHurricanePhase) {
      this.lastHurricanePhase = H.phase;
      const warning = HURRICANE_ALERTS[H.phase];
      if (announce && warning && this.hurricaneBlend > 0.45) {
        this.alert(warning[0], warning[1], H.phase === 'eye' || H.phase === 'back-eyewall' ? 7 : 5.5);
        this.radio?.hurricanePhaseCall(H.phase);
      }
    }
    return H;
  }
  setHurricaneProgress(progress = 0) {
    const p = clamp(Number(progress) || 0);
    if (this.key !== 'hurricane') this.setWeather('hurricane', true, false);
    else { this.from = { ...WEATHER.hurricane }; this.to = { ...WEATHER.hurricane }; this.mix = 1; mixedWeather(this.values, this.from, this.to, 1); }
    this.weatherDuration = Math.max(1, this.weatherDuration || 200); this.remaining = this.weatherDuration * (1 - p); this.lastHurricanePhase = '';
    mixedWeather(this.values, this.from, this.to, this.mix); this.updateHurricanePassage(true); this.syncClockAndTide(); this.persistState(true);
    return this.hurricaneSnapshot();
  }
  setWeather(key, instant = false, announce = true) {
    if (!WEATHER[key]) return;
    const surgeStep = instant ? WEATHER[key].surge - (this.values.surge || 0) : 0;
    if (this.key === 'hurricane') this.windAngle = Math.atan2(Math.sin(this.localWindAngle), Math.cos(this.localWindAngle));
    this.from = { ...this.values }; this.to = { ...WEATHER[key] }; this.key = key; this.mix = instant ? 1 : 0;
    const [a, b] = WEATHER[key].duration; this.remaining = a + Math.random() * (b - a); this.weatherDuration = this.remaining;
    this.lastHurricanePhase = ''; this.hurricaneBlend = 0; this.localWindAngle = this.windAngle;
    // F8 is a visual test hook. Carry a floating hull with an instantaneous debug surge so the
    // one-frame water-level jump is not misread as a five-foot stunt; natural transitions stay gradual.
    if (instant && this.phys && Math.abs(surgeStep) > 0.001 && this.phys.wet > 0.15) { this.phys.y += surgeStep; this.phys.prevFloor = null; this.phys.vy *= 0.35; }
    if (instant) { mixedWeather(this.values, this.from, this.to, 1); this.updateHurricanePassage(false); this.syncClockAndTide(); }
    if (instant && WEATHER[key].lightning > 0.4) this.lightningT = Math.min(this.lightningT, 1.2);
    if (announce) this.alert(WEATHER[key].label, WEATHER[key].call, key === 'hurricane' ? 7 : 5);
    this.persistState(true);
  }
  cycleWeather(instant = false) { const i = WEATHER_ORDER.indexOf(this.key); this.setWeather(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length], instant, true); }

  chooseWeather() {
    const r = Math.random(), fogWindow = this.hour >= 0.5 && this.hour < 7.35; let next = 'fair';
    if (this.key === 'fair') {
      if (fogWindow && r < 0.2) next = 'fog';
      else { const q = fogWindow ? (r - 0.2) / 0.8 : r; next = q < 0.67 ? 'overcast' : q < 0.83 ? 'fair' : 'squall'; }
    } else if (this.key === 'fog') next = r < 0.7 ? 'fair' : 'overcast';
    else if (this.key === 'overcast') {
      if (fogWindow && r < 0.14) next = 'fog';
      else { const q = fogWindow ? (r - 0.14) / 0.86 : r; next = q < 0.34 ? 'fair' : q < 0.62 ? 'squall' : q < 0.88 ? 'thunderstorm' : q < 0.96 ? 'hail' : 'tropical'; }
    }
    else if (this.key === 'squall') next = r < 0.5 ? 'overcast' : r < 0.84 ? 'thunderstorm' : 'fair';
    else if (this.key === 'thunderstorm' || this.key === 'hail') next = r < 0.62 ? 'overcast' : r < 0.9 ? 'fair' : 'tropical';
    else if (this.key === 'tropical') next = r < 0.22 ? 'hurricane' : r < 0.78 ? 'squall' : 'overcast';
    else next = r < 0.72 ? 'tropical' : 'overcast';
    this.setWeather(next);
  }

  alert(title, text, seconds = 5) {
    if (!this.alertEl) return;
    this.alertEl.innerHTML = `<span>${title}</span>${text}`; this.alertEl.classList.add('on'); this.alertT = seconds;
  }

  triggerLightning(camera, target = null) {
    const a = Math.random() * Math.PI * 2;
    const close = !target && this.values.storm > 0.82 && Math.random() < 0.24;
    let dist = close ? 28 + Math.random() * 92 : 140 + Math.random() * 320;
    const x = target ? target.x : camera.x + Math.cos(a) * dist, z = target ? target.z : camera.z + Math.sin(a) * dist;
    if (target) dist = Math.hypot(x - camera.x, z - camera.z);
    const ground = this.terrain.heightAt(x, z), y0 = Math.max(this.waterLevel, ground) + 0.5, top = 190 + Math.random() * 100;
    const position = this.bolt.geometry.attributes.position, color = this.bolt.geometry.attributes.color;
    this.boltSegments = writeLightningStroke(position.array, color.array, this.boltTrunk, { x, y: y0, z, height: top });
    this.bolt.geometry.setDrawRange(0, this.boltSegments * 2);
    updateAttributePrefix(position, this.boltSegments * 6); updateAttributePrefix(color, this.boltSegments * 6);
    this.bolt.material.opacity = 1; this.bolt.visible = true; this.boltAge = 0; this.boltT = LIGHTNING_LIFETIME;
    this.lightningCloudY = y0 + top; lightningSkyDirection(this.flashDirection, camera, x, this.lightningCloudY, z);
    this.flash = 1; this.thunderT = dist / 343; this.thunderX = x; this.thunderZ = z; this.lightningT = lerp(7, 28, Math.random()) / Math.max(0.35, this.values.lightning);
    this.registerSettlementPowerStrike(x, z);
    if (this.onLightning) this.onLightning({ x, z, y: y0, distance: dist, water: ground < this.waterLevel + 0.12 });
  }

  thunder(strength = 1) {
    this.audio?.thunder?.(strength, this.thunderX, this.thunderZ);
  }

  refreshSettlementLights(night, stress) {
    const candidates = resetSettlementCandidates(this.settlementCandidates), bx = this.phys.pos.x, bz = this.phys.pos.y;
    for (const [key, expiry] of this.settlementOutages) if (expiry <= this.minutes) this.settlementOutages.delete(key);
    if (this.world) {
      for (const live of this.world.liveSites.values()) {
        const site = live.site; if (site.kind !== 'house' && site.kind !== 'boathouse') continue;
        site.powerKey ||= `site:${site.key}`;
        const dx = site.x - bx, dz = site.z - bz;
        insertNearestSettlement(candidates, site.powerKey, site.x, site.kind === 'house' ? site.h + 2.7 : 2.5, site.z, dx * dx + dz * dz);
      }
      for (const group of this.world.liveCamps.values()) {
        const camp = group.userData.site; if (!camp) continue; camp.powerKey ||= `camp:${camp.key}`;
        const dx = camp.x - bx, dz = camp.z - bz;
        insertNearestSettlement(candidates, camp.powerKey, camp.x, camp.h + 2.1, camp.z, dx * dx + dz * dz);
      }
    }
    for (let i = 0; i < this.settlementLights.length; i++) {
      const light = this.settlementLights[i], candidate = candidates[i], assigned = Boolean(candidate.key);
      light.group.visible = assigned && night > 0.05;
      if (!assigned) { light.key = ''; light.light.intensity = 0; light.bulb.visible = false; continue; }
      light.group.position.set(candidate.x, candidate.y, candidate.z);
      if (light.key !== candidate.key || light.day !== this.day) {
        light.key = candidate.key; light.day = this.day; light.roll = settlementPowerRoll(candidate.key, this.day); light.phase = light.roll * Math.PI * 2;
        light.target = settlementPowerTarget(light.roll, stress, (this.settlementOutages.get(light.key) || 0) > this.minutes); light.power = light.target;
      }
    }
  }

  updateSettlementLights(dt, realTime, night) {
    const stress = settlementGridStress(this.key, this.values, this.values.wind * this.gust);
    this.settlementT -= dt;
    if (this.settlementT <= 0) { this.settlementT = 0.6; this.refreshSettlementLights(night, stress); }
    let active = 0, powered = 0, brownouts = 0, dark = 0;
    for (const light of this.settlementLights) {
      if (!light.key) continue;
      if (light.day !== this.day) { light.day = this.day; light.roll = settlementPowerRoll(light.key, this.day); light.phase = light.roll * Math.PI * 2; }
      light.target = settlementPowerTarget(light.roll, stress, (this.settlementOutages.get(light.key) || 0) > this.minutes);
      light.power = settlementPowerStep(light.power, light.target, dt);
      const level = settlementLightLevel(light.power, stress, realTime, light.phase);
      light.light.intensity = light.group.visible ? night * 85 * level : 0;
      light.bulb.visible = light.group.visible && level > 0.018; light.bulb.scale.setScalar(0.7 + level * 0.3);
      if (light.group.visible) active++;
      if (light.target <= 0.02) dark++; else if (light.target < 0.9) brownouts++; else powered++;
    }
    const stats = this.settlementPowerStats; stats.active = active; stats.powered = powered; stats.brownouts = brownouts; stats.dark = dark;
    stats.outages = this.settlementOutages.size; stats.strikeFailures = this.settlementPowerFailures; stats.stress = stress;
  }

  registerSettlementOutage(source, prefix, strikeX, strikeZ) {
    if (!source) return false;
    const duration = settlementStrikeOutageMinutes(Math.hypot(source.x - strikeX, source.z - strikeZ), this.values.lightning, Math.random());
    if (!duration) return false;
    source.powerKey ||= `${prefix}:${source.key}`;
    const expiry = this.minutes + duration, current = this.settlementOutages.get(source.powerKey) || 0;
    this.settlementOutages.delete(source.powerKey); this.settlementOutages.set(source.powerKey, Math.max(current, expiry));
    return true;
  }

  registerSettlementPowerStrike(x, z) {
    if (!this.world || !this.settlementOutages) return 0;
    let failures = 0;
    for (const live of this.world.liveSites.values()) {
      const site = live.site; if ((site.kind === 'house' || site.kind === 'boathouse') && this.registerSettlementOutage(site, 'site', x, z)) failures++;
    }
    for (const group of this.world.liveCamps.values()) if (this.registerSettlementOutage(group.userData.site, 'camp', x, z)) failures++;
    while (this.settlementOutages.size > MAX_SETTLEMENT_OUTAGES) {
      let oldestKey = '', oldestExpiry = Infinity;
      for (const [key, expiry] of this.settlementOutages) if (expiry < oldestExpiry) { oldestKey = key; oldestExpiry = expiry; }
      if (!oldestKey) break; this.settlementOutages.delete(oldestKey);
    }
    if (failures) { this.settlementPowerFailures += failures; this.persistState(true); }
    return failures;
  }

  settlementPowerSnapshot() {
    return { ...this.settlementPowerStats, savedOutages: this.settlementOutages.size, maxOutages: MAX_SETTLEMENT_OUTAGES, bulbGeometries: 1, bulbMaterials: 1 };
  }

  applyPhysics(dt, localOutflow = null) {
    if (!dt || this.game.paused) return;
    combinedSurfaceWind(this.windDir, this.values.wind * this.gust, localOutflow, this.surfaceWind);
    applyAirboatWind(this.phys, this.surfaceWind, this.surfaceWind.speed, dt, this.windLoad);
    if (this.values.hail > 0.35) {
      this.hailKick -= dt; if (this.hailKick <= 0) { this.hailKick = lerp(0.16, 0.65, Math.random()); this.game.shake = Math.max(this.game.shake, 0.035 + this.values.hail * 0.04); }
    }
  }

  update(dt, realTime, camera, paused = false) {
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);
    const step = paused ? 0 : dt;
    this.minutes += step * this.minutesPerSecond;
    if (step) {
      this.remaining -= step;
      const clockHour = (this.minutes / 60) % 24;
      // Low-wind pre-dawn fog lingers into the morning, then gives way quickly once solar heating takes hold.
      if (this.key === 'fog' && clockHour >= 8.15 && clockHour < 11.5) this.remaining = Math.min(this.remaining, 18);
      if (this.remaining <= 0) this.chooseWeather();
      if (this.mix < 1) this.mix = Math.min(1, this.mix + step / this.transition);
    }
    mixedWeather(this.values, this.from, this.to, this.mix);
    this.updateHurricanePassage(step > 0);
    this.syncClockAndTide();

    const V = this.values;
    this.restrictedVisibility = smooth(0.00085, 0.0029, V.fog);
    this.windAngle += step * (0.003 + V.wind * 0.00016) + Math.sin(realTime * 0.019) * step * 0.0015;
    this.localWindAngle = this.windAngle + (this.key === 'hurricane' ? this.hurricane.windShift * this.hurricaneBlend : 0);
    this.gust = 0.78 + 0.22 * Math.sin(realTime * 0.37) + 0.13 * Math.sin(realTime * 1.11 + 1.7) + 0.07 * Math.sin(realTime * 2.73);
    this.gust = clamp(this.gust, 0.58, 1.18);
    this.windDir.set(Math.cos(this.localWindAngle), 0, Math.sin(this.localWindAngle));
    this.wind.set(this.windDir.x, clamp(0.32 + V.wind * this.gust / 16, 0.35, 2.65), this.windDir.z);
    if (step) {
      this.cloudShadowOffset.x += this.windDir.x * V.wind * step;
      this.cloudShadowOffset.y += this.windDir.z * V.wind * step;
      // 25 km is exactly 32 repeats at the grade shader's 0.00128 scale, so precision wrapping cannot pop the mask.
      if (Math.abs(this.cloudShadowOffset.x) > CLOUD_SHADOW_WRAP) this.cloudShadowOffset.x %= CLOUD_SHADOW_WRAP;
      if (Math.abs(this.cloudShadowOffset.y) > CLOUD_SHADOW_WRAP) this.cloudShadowOffset.y %= CLOUD_SHADOW_WRAP;
    }

    const solar = (this.hour - 6) / 24 * Math.PI * 2;
    const sunY = Math.sin(solar), sunX = -Math.cos(solar) * 0.86;
    this.sunDir.set(sunX, sunY, -0.42).normalize();
    const lunar = solar - this.lunarPhase;
    this.moonDir.set(-Math.cos(lunar) * 0.86, Math.sin(lunar), -0.42 * Math.cos(this.lunarPhase)).normalize();
    const daylight = smooth(-0.08, 0.16, sunY), night = 1 - smooth(-0.04, 0.18, sunY);
    this.daylight = daylight; this.night = night;
    this.surfaceWetness = surfaceWetnessStep(this.surfaceWetness, V.rain, V.hail, V.fog, daylight, V.wind * this.gust, V.storm, step);
    setGlobalSurfaceWetness(this.surfaceWetness); this.terrain.setSurfaceWetness(this.surfaceWetness, this.waterLevel);
    const horizon = 1 - smooth(0.04, 0.52, Math.max(0, sunY));
    const stormShade = 1 - V.storm * 0.7;
    const moonTransmission = lerp(0.3, 1, smooth(0.19, 0.52, V.cloud)) * lerp(1, 0.45, V.storm);
    this.moonlight = lunarNightLight(night, this.moonDir.y, this.moonIllumination, moonTransmission);
    const moonLight = this.moonlight * 0.14;
    const cloudX = this.phys.pos.x + this.windDir.x * realTime * V.wind * 14;
    const cloudZ = this.phys.pos.y + this.windDir.z * realTime * V.wind * 14;
    const overheadCloud = clamp(0.5 + Math.sin(cloudX * 0.0017 + cloudZ * 0.0008) * 0.28 + Math.sin(cloudX * -0.0006 + cloudZ * 0.0021 + 1.7) * 0.18);
    this.cloudLight = 1 - smooth(V.cloud, V.cloud + 0.2, overheadCloud) * lerp(0.12, 0.045, V.storm);
    this.rainbowMoisture = rainbowMoistureStep(this.rainbowMoisture, V.rain, step);
    const rainbowTarget = this.rainbowOverride ?? rainbowPotential({ moisture: this.rainbowMoisture, rain: V.rain, storm: V.storm, daylight, sunAltitude: this.sunDir.y, cloudLight: this.cloudLight });
    this.rainbow = rainbowResponse(this.rainbow, rainbowTarget, step);
    const sunBase = daylight * smooth(-0.01, 0.055, sunY) * lerp(3.15, 2.6, horizon) * stormShade * this.cloudLight;
    const useMoon = moonLight > sunBase;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);

    this.flash *= Math.exp(-dt * 12);
    if (V.lightning > 0.05 && !paused) { this.lightningT -= step; if (this.lightningT <= 0) this.triggerLightning(camera); }
    if (this.boltT > 0) {
      lightningSkyDirection(this.flashDirection, camera, this.thunderX, this.lightningCloudY, this.thunderZ);
      const stroke = lightningStrokeEnvelope(this.boltAge);
      this.bolt.material.opacity = stroke; this.bolt.visible = stroke > 0.012;
      this.flash = Math.max(this.flash, stroke * 0.72);
      this.boltAge += dt; this.boltT = Math.max(0, this.boltT - dt);
      if (this.boltT <= 0) this.bolt.visible = false;
    }
    if (this.thunderT >= 0) { this.thunderT -= dt; if (this.thunderT < 0) this.thunder(0.65 + V.storm * 0.35); }

    this.sun.intensity = Math.max(moonLight, sunBase) + this.flash * 4.5;
    this.sun.color.copy(useMoon ? this.sunNight : this.sunDay);
    if (!useMoon) this.sun.color.lerp(this.sunWarm, horizon * daylight * (1 - V.storm * 0.6));
    this.sun.color.lerp(this.flashColor, this.flash);
    this.hemi.intensity = lerp(0.09, 0.46, daylight) * lerp(1, 0.48, V.storm) + this.flash * 0.9;
    this.hemi.color.set(daylight > 0.1 ? 0x9fc3e8 : 0x203659); this.hemi.groundColor.set(daylight > 0.1 ? 0x3f4a2a : 0x07100c);
    this.scene.environmentIntensity = lerp(0.025, 0.42, daylight) * lerp(1, 0.42, V.storm);

    // Snap to the active shadow texel. Adaptive quality can resize the map, and using the old 4096-grid on a 1K map
    // makes the shadow projection crawl even though the lower-resolution map itself is stable.
    const shadowSnap = 240 / Math.max(1, this.sun.shadow.mapSize.x);
    this.sun.target.position.set(Math.round(this.phys.pos.x / shadowSnap) * shadowSnap, 0, Math.round(this.phys.pos.y / shadowSnap) * shadowSnap);
    this.sun.position.copy(this.lightDir).multiplyScalar(420).add(this.sun.target.position); this.sun.target.updateMatrixWorld();
    this.sky.uniforms.sunDir.value.copy(this.sunDir); this.sky.uniforms.moonDir.value.copy(this.moonDir);
    this.sky.uniforms.lightDir.value.copy(this.lightDir); this.sky.uniforms.windDir.value.set(this.windDir.x, this.windDir.z); this.sky.uniforms.windSpeed.value = V.wind;
    this.sky.uniforms.daylight.value = daylight; this.sky.uniforms.storm.value = V.storm; this.sky.uniforms.flash.value = this.flash; this.sky.uniforms.flashDir.value.copy(this.flashDirection);
    this.sky.uniforms.rain.value = V.rain; this.sky.uniforms.cover.value = V.cloud; this.sky.uniforms.rainbow.value = this.rainbow;

    this.water.setConditions({ level: this.waterLevel, seaState: V.sea, windAngle: this.localWindAngle, rain: V.rain, hail: V.hail, wind: V.wind });
    this.water.uniforms.sunDir.value.copy(this.lightDir);
    this.water.uniforms.sunIntensity.value = Math.max(0.025, useMoon ? moonLight * 2.1 : daylight * 1.55 * stormShade) + this.flash * 2;
    this.water.uniforms.sunColor.value.copy(this.sun.color);
    const foamLight = this.water.uniforms.foamLight.value, foamSun = this.sun.intensity * 0.32 * Math.max(0, this.lightDir.y);
    foamLight.setRGB(this.hemi.color.r * this.hemi.intensity * 1.1 + this.sun.color.r * foamSun,
      this.hemi.color.g * this.hemi.intensity * 1.1 + this.sun.color.g * foamSun,
      this.hemi.color.b * this.hemi.intensity * 1.1 + this.sun.color.b * foamSun);
    this.water.uniforms.rippleStrength.value = 0.13 + V.sea * 0.075 + V.rain * 0.08;

    const fog = this.pipeline.grade.material.uniforms;
    if (daylight > 0.001) { this.camera.getWorldDirection(this.viewDir); this.sunGaze = this.viewDir.dot(this.sunDir); }
    else this.sunGaze = -1;
    this.eyeExposureTarget = eyeExposureTarget({
      baseExposure: V.exposure, daylight, night, sunAltitude: this.sunDir.y, viewSunDot: this.sunGaze,
      cloud: V.cloud, cloudLight: this.cloudLight, rain: V.rain, fog: V.fog, storm: V.storm, flash: this.flash,
      spotlight: this.spotOn, restrictedVisibility: this.restrictedVisibility,
    });
    this.eyeExposure = eyeExposureStep(this.eyeExposure, this.eyeExposureTarget, dt);
    fog.exposure.value = this.eyeExposure;
    const dawnHaze = Math.exp(-Math.pow((this.hour - 6.5) / 1.8, 2)) * (1 - smooth(5, 19, V.wind));
    fog.fogDensity.value = V.fog * lerp(1.28, 1, daylight) * (1 + dawnHaze * 0.3);
    fog.fogColor.value.copy(this.fogNight).lerp(this.fogDay, daylight).lerp(this.fogStorm, V.storm * 0.78);
    this.fogMist.setRGB(lerp(0.20, 0.72, daylight), lerp(0.27, 0.75, daylight), lerp(0.31, 0.73, daylight));
    fog.fogColor.value.lerp(this.fogMist, this.restrictedVisibility * 0.82);
    fog.fogMax.value = lerp(0.6, 0.94, this.restrictedVisibility);
    fog.bloomAmt.value = lerp(0.18, 0.1, daylight) + V.rain * 0.03 + this.restrictedVisibility * (this.spotOn ? 0.065 : 0.022);
    fog.sunDir.value.copy(this.lightDir);
    this.cloudShadowAmount = cloudShadowPotential(V.cloud, daylight, this.sunDir.y, V.storm);
    fog.cloudShadowAmount.value = this.cloudShadowAmount;
    fog.cloudShadowOffset.value.copy(this.cloudShadowOffset);
    this.heatHazeTarget = heatHazePotential(this.hour, daylight, this.sunDir.y, V.cloud, V.rain, V.wind * this.gust, V.storm, V.fog);
    if (step) this.heatHaze += (this.heatHazeTarget - this.heatHaze) * (1 - Math.exp(-step * 0.42));
    fog.heatAmount.value = this.heatHaze;
    fog.mistAmount.value = surfaceMistEnvelope({ hour: this.hour, fog: V.fog, rain: V.rain, wind: V.wind * this.gust, storm: V.storm });
    fog.mistLevel.value = this.waterLevel;
    fog.mistHeight.value = lerp(2.35, 4.1, this.restrictedVisibility) + V.rain * 0.35;
    fog.mistTime.value = realTime;
    fog.mistWind.value.set(this.windDir.x, this.windDir.z).multiplyScalar(V.wind * 0.12);

    this.precip.update(dt, camera, this.windDir, V.rain, V.hail, this.waterLevel);
    if (this.audio && this.audio.weather) this.audio.weather(V.wind * this.gust, V.rain, night, V.storm);
    this.nav.visible = night > 0.03 || this.restrictedVisibility > 0.25 || this.spotOn;
    if (this.nav.visible) {
      const dx = camera.x - this.phys.pos.x, dz = camera.z - this.phys.pos.y, c = Math.cos(this.phys.heading), s = Math.sin(this.phys.heading);
      const visible = navigationLightVisibility(dx * c - dz * s, dx * s + dz * c, this.navVisibility);
      this.port.visible = visible.port; this.starboard.visible = visible.starboard; this.stern.visible = visible.stern;
    }
    this.cockpitLight.intensity = night * 15; this.spotlight.intensity = this.spotOn ? lerp(350, 1250, night) : 0;
    this.spotlightVolume.update(realTime, this.spotOn, night, this.restrictedVisibility, V.rain, V.storm);
    this.updateSettlementLights(dt, realTime, night);

    if (this.alertT > 0) { this.alertT -= dt; if (this.alertT <= 0 && this.alertEl) this.alertEl.classList.remove('on'); }
    if (step) { this.persistT -= step; if (this.persistT <= 0) { this.persistT = 10; this.persistState(true); } }
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.18; this.renderHud(); }
  }

  renderHud() {
    if (!this.el) return;
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60), ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
    const from = ((this.localWindAngle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), dirs = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const dir = dirs[Math.round(from / (Math.PI * 2) * 8) % 8];
    const tide = this.tideLabel();
    const lunarRange = this.tideRange > 0.94 ? ' · spring tide' : this.tideRange < 0.76 ? ' · neap tide' : '';
    const pressure = this.key === 'hurricane' ? ` · ${this.hurricane.pressureHpa} hPa` : '';
    const surge = this.values.surge > 0.14 ? ` · surge +${(this.values.surge * FT).toFixed(1)} ft` : '';
    const current = this.currentField ? ` · ${this.currentField.hud()}` : '';
    this.el.innerHTML = `<div class="world-clock">${hh}:${String(m).padStart(2, '0')} <small>${ap}</small></div><div class="world-weather">${this.weatherLabel()}</div><div class="world-detail">${tide}${lunarRange} · wind ${dir} ${Math.round(this.values.wind * this.gust * MPS_TO_MPH)} mph${pressure}${surge}${current}</div>`;
  }
}
