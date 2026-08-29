import * as THREE from 'three';
import { lunarAgeAt, lunarIllumination, lunarPhaseAt, lunarPhaseName, lunarTideRange } from './lunar.js';
import { updateAttributePrefix } from './cache.js';
import { navigationLightVisibility, PLAYER_NAV_LIGHT_LAYOUT } from './navigationrules.js';

const FT = 3.28084;
const MPS_TO_MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export function surfaceMistEnvelope({ hour = 12, fog = 0, rain = 0, wind = 0, storm = 0 } = {}) {
  const dawnCooling = Math.exp(-Math.pow((hour - 6.35) / 1.75, 2));
  const calm = 1 - smooth(5, 18, wind);
  const weatherFog = smooth(0.0006, 0.0031, fog) * 0.88;
  const rainCooling = smooth(0.22, 0.86, rain) * calm * (1 - smooth(0.52, 1, storm)) * 0.2;
  return clamp(weatherFog + dawnCooling * calm * 0.58 + rainCooling);
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
    const savedMinutes = Number(saved.minutes), savedRemaining = Number(saved.remaining), savedWind = Number(saved.windAngle), savedMix = Number(saved.mix);
    this.minutes = Number.isFinite(savedMinutes) && savedMinutes >= 0 ? Math.min(savedMinutes, 1440 * 36500) : 17 * 60 + 5; // a full day takes thirty real minutes
    this.minutesPerSecond = 0.8;
    this.key = WEATHER[saved.key] ? saved.key : 'fair';
    this.from = weatherSnapshot(saved.from, WEATHER[this.key]); this.to = { ...WEATHER[this.key] };
    this.mix = Number.isFinite(savedMix) ? clamp(savedMix) : 1; this.transition = 24;
    this.values = {}; mixedWeather(this.values, this.from, this.to, this.mix);
    this.restrictedVisibility = smooth(0.00085, 0.0029, this.values.fog);
    this.remaining = Number.isFinite(savedRemaining) ? clamp(savedRemaining, 0, 600) : 95;
    this.windAngle = Number.isFinite(savedWind) ? Math.atan2(Math.sin(savedWind), Math.cos(savedWind)) : 0.7;
    this.gust = 1; this.waterLevel = 0; this.tideRate = 0; this.daylight = 0; this.night = 1; this.syncClockAndTide(); this.persistT = 10;
    this.rainbowMoisture = smooth(0.08, 0.72, this.values.rain); this.rainbow = 0; this.rainbowOverride = null;
    this.navVisibility = { port: true, starboard: true, stern: true }; this.hornCooldown = 0;
    this.precip = new Precipitation(this.fxScene, this.effectBudget);
    this.windDir = new THREE.Vector3(1, 0, 0); this.moonDir = new THREE.Vector3();
    this.lightDir = this.sunDir.clone();
    this.sunWarm = new THREE.Color(0xff9a62); this.sunDay = new THREE.Color(0xfff1d6); this.sunNight = new THREE.Color(0x91a8d5); this.flashColor = new THREE.Color(0xeaf5ff);
    this.fogDay = new THREE.Color(0x94aebc); this.fogStorm = new THREE.Color(0x263a40); this.fogNight = new THREE.Color(0x07111a); this.fogMist = new THREE.Color();
    this.flash = 0; this.boltT = 0; this.lightningT = 16; this.thunderT = -1; this.thunderX = 0; this.thunderZ = 0; this.hailKick = 0;
    this.makeLightning(); this.makeBoatLights(); this.makeSettlementLights();
    this.el = document.getElementById('worldState'); this.alertEl = document.getElementById('weatherAlert'); this.alertT = 0; this.hudT = 0;
    this.keyHandler = (e) => this.onKey(e); window.addEventListener('keydown', this.keyHandler);
    this.pagehideHandler = () => this.persistState(true); window.addEventListener('pagehide', this.pagehideHandler);
    this.persistState(false);
  }

  makeLightning() {
    const p = new Float32Array(22 * 3); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0, depthWrite: false });
    this.bolt = new THREE.Line(g, m); this.bolt.visible = false; this.bolt.frustumCulled = false; this.scene.add(this.bolt);
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
    this.boat.add(g); this.nav = g;
  }

  makeSettlementLights() {
    this.settlementLights = [];
    const bulbGeo = new THREE.SphereGeometry(0.09, 8, 6);
    for (let i = 0; i < 5; i++) {
      const group = new THREE.Group(); const mat = new THREE.MeshBasicMaterial({ color: 0xffbd73, toneMapped: false });
      const bulb = new THREE.Mesh(bulbGeo, mat); const light = new THREE.PointLight(0xffa95f, 0, 42, 2); group.add(bulb, light); group.visible = false;
      this.scene.add(group); this.settlementLights.push({ group, light });
    }
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
    this.tideRate = (Math.cos(tidePhase) * 0.34 + Math.cos(tidePhase * 0.5 + 0.8) * 0.04) * this.tideRange;
  }
  clockLabel() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60), ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  }
  weatherLabel() { return WEATHER[this.key].label; }
  tideLabel() {
    const tideFt = this.waterLevel * FT;
    return `${this.tideRate >= 0 ? 'Rising' : 'Falling'} ${tideFt >= 0 ? '+' : ''}${tideFt.toFixed(1)} ft`;
  }
  lunarSnapshot() { return { age: this.lunarAge, phase: this.lunarPhase, name: lunarPhaseName(this.lunarPhase), illumination: this.moonIllumination, tideRange: this.tideRange, altitude: this.moonDir?.y || 0 }; }
  persistState(write = true) {
    this.game.save.environment = {
      minutes: this.minutes,
      key: this.key,
      from: weatherSnapshot(this.from, WEATHER[this.key]),
      mix: this.mix,
      remaining: this.remaining,
      windAngle: this.windAngle,
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
  setWeather(key, instant = false, announce = true) {
    if (!WEATHER[key]) return;
    const surgeStep = instant ? WEATHER[key].surge - (this.values.surge || 0) : 0;
    this.from = { ...this.values }; this.to = { ...WEATHER[key] }; this.key = key; this.mix = instant ? 1 : 0;
    const [a, b] = WEATHER[key].duration; this.remaining = a + Math.random() * (b - a);
    // F8 is a visual test hook. Carry a floating hull with an instantaneous debug surge so the
    // one-frame water-level jump is not misread as a five-foot stunt; natural transitions stay gradual.
    if (instant && this.phys && Math.abs(surgeStep) > 0.001 && this.phys.wet > 0.15) { this.phys.y += surgeStep; this.phys.prevFloor = null; this.phys.vy *= 0.35; }
    if (instant) { mixedWeather(this.values, this.from, this.to, 1); this.syncClockAndTide(); }
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
    const p = this.bolt.geometry.attributes.position.array;
    let px = x, pz = z;
    for (let i = 0; i < 22; i++) {
      const k = i / 21, wander = (1 - k) * 8 + 0.8;
      if (i) { px += (Math.random() - 0.5) * wander; pz += (Math.random() - 0.5) * wander; }
      p[i * 3] = px; p[i * 3 + 1] = y0 + k * top; p[i * 3 + 2] = pz;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true; this.bolt.material.opacity = 1; this.bolt.visible = true; this.boltT = 0.14;
    this.flash = 1; this.thunderT = dist / 343; this.thunderX = x; this.thunderZ = z; this.lightningT = lerp(7, 28, Math.random()) / Math.max(0.35, this.values.lightning);
    if (this.onLightning) this.onLightning({ x, z, y: y0, distance: dist, water: ground < this.waterLevel + 0.12 });
  }

  thunder(strength = 1) {
    this.audio?.thunder?.(strength, this.thunderX, this.thunderZ);
  }

  updateSettlementLights(dt, night) {
    this.settlementT -= dt; if (this.settlementT > 0) return; this.settlementT = 0.6;
    const bx = this.phys.pos.x, bz = this.phys.pos.y, cands = [];
    if (this.world) {
      for (const l of this.world.liveSites.values()) {
        const s = l.site; if (s.kind !== 'house' && s.kind !== 'boathouse') continue;
        cands.push({ x: s.x, z: s.z, y: s.kind === 'house' ? s.h + 2.7 : 2.5, d: Math.hypot(s.x - bx, s.z - bz) });
      }
      for (const key of this.world.liveCamps.keys()) { const c = this.world.campCells.get(key); if (c) cands.push({ x: c.x, z: c.z, y: c.h + 2.1, d: Math.hypot(c.x - bx, c.z - bz) }); }
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.settlementLights.length; i++) {
      const l = this.settlementLights[i], c = cands[i];
      l.group.visible = !!c && night > 0.05;
      if (c) { l.group.position.set(c.x, c.y, c.z); l.light.intensity = night * 85; }
    }
  }

  applyPhysics(dt) {
    if (!dt || this.game.paused) return;
    const p = this.phys, wind = this.values.wind * this.gust;
    const exposure = 0.45 + 0.55 * (1 - p.wet) + Math.min(0.25, p.speed * 0.015);
    const accel = wind * 0.0045 * exposure;
    p.vel.x += this.windDir.x * accel * dt; p.vel.y += this.windDir.z * accel * dt;
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
      mixedWeather(this.values, this.from, this.to, this.mix);
    }
    this.syncClockAndTide();

    const V = this.values;
    this.restrictedVisibility = smooth(0.00085, 0.0029, V.fog);
    this.windAngle += step * (0.003 + V.wind * 0.00016) + Math.sin(realTime * 0.019) * step * 0.0015;
    this.gust = 0.78 + 0.22 * Math.sin(realTime * 0.37) + 0.13 * Math.sin(realTime * 1.11 + 1.7) + 0.07 * Math.sin(realTime * 2.73);
    this.gust = clamp(this.gust, 0.58, 1.18);
    this.windDir.set(Math.cos(this.windAngle), 0, Math.sin(this.windAngle));
    this.wind.set(this.windDir.x, clamp(0.32 + V.wind * this.gust / 16, 0.35, 2.65), this.windDir.z);

    const solar = (this.hour - 6) / 24 * Math.PI * 2;
    const sunY = Math.sin(solar), sunX = -Math.cos(solar) * 0.86;
    this.sunDir.set(sunX, sunY, -0.42).normalize();
    const lunar = solar - this.lunarPhase;
    this.moonDir.set(-Math.cos(lunar) * 0.86, Math.sin(lunar), -0.42 * Math.cos(this.lunarPhase)).normalize();
    const daylight = smooth(-0.08, 0.16, sunY), night = 1 - smooth(-0.04, 0.18, sunY);
    this.daylight = daylight; this.night = night;
    const horizon = 1 - smooth(0.04, 0.52, Math.max(0, sunY));
    const stormShade = 1 - V.storm * 0.7;
    const moonLight = night * smooth(0.01, 0.68, this.moonDir.y) * lerp(0, 0.14, Math.pow(this.moonIllumination, 0.72)) * lerp(1, 0.34, V.storm);
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
    if (this.boltT > 0) { this.boltT -= dt; this.bolt.material.opacity = clamp(this.boltT / 0.14); if (this.boltT <= 0) this.bolt.visible = false; }
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
    this.sky.uniforms.daylight.value = daylight; this.sky.uniforms.storm.value = V.storm; this.sky.uniforms.flash.value = this.flash; this.sky.uniforms.cover.value = V.cloud; this.sky.uniforms.rainbow.value = this.rainbow;

    this.water.setConditions({ level: this.waterLevel, seaState: V.sea, windAngle: this.windAngle, rain: V.rain, hail: V.hail, wind: V.wind });
    this.water.uniforms.sunDir.value.copy(this.lightDir);
    this.water.uniforms.sunIntensity.value = Math.max(0.025, useMoon ? moonLight * 2.1 : daylight * 1.55 * stormShade) + this.flash * 2;
    this.water.uniforms.sunColor.value.copy(this.sun.color);
    this.water.uniforms.rippleStrength.value = 0.13 + V.sea * 0.075 + V.rain * 0.08;

    const fog = this.pipeline.grade.material.uniforms;
    fog.exposure.value = lerp(0.54, V.exposure, daylight) + this.flash * 0.25;
    const dawnHaze = Math.exp(-Math.pow((this.hour - 6.5) / 1.8, 2)) * (1 - smooth(5, 19, V.wind));
    fog.fogDensity.value = V.fog * lerp(1.28, 1, daylight) * (1 + dawnHaze * 0.3);
    fog.fogColor.value.copy(this.fogNight).lerp(this.fogDay, daylight).lerp(this.fogStorm, V.storm * 0.78);
    this.fogMist.setRGB(lerp(0.20, 0.72, daylight), lerp(0.27, 0.75, daylight), lerp(0.31, 0.73, daylight));
    fog.fogColor.value.lerp(this.fogMist, this.restrictedVisibility * 0.82);
    fog.fogMax.value = lerp(0.6, 0.94, this.restrictedVisibility);
    fog.bloomAmt.value = lerp(0.18, 0.1, daylight) + V.rain * 0.03 + this.restrictedVisibility * (this.spotOn ? 0.065 : 0.022);
    fog.sunDir.value.copy(this.lightDir);
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
    this.updateSettlementLights(dt, night);

    if (this.alertT > 0) { this.alertT -= dt; if (this.alertT <= 0 && this.alertEl) this.alertEl.classList.remove('on'); }
    if (step) { this.persistT -= step; if (this.persistT <= 0) { this.persistT = 10; this.persistState(true); } }
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.18; this.renderHud(); }
  }

  renderHud() {
    if (!this.el) return;
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60), ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
    const from = (this.windAngle + Math.PI) % (Math.PI * 2), dirs = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const dir = dirs[Math.round(from / (Math.PI * 2) * 8) % 8];
    const tideFt = this.waterLevel * FT, tide = `${this.tideRate >= 0 ? 'Rising' : 'Falling'} ${tideFt >= 0 ? '+' : ''}${tideFt.toFixed(1)} ft`;
    const lunarRange = this.tideRange > 0.94 ? ' · spring tide' : this.tideRange < 0.76 ? ' · neap tide' : '';
    const current = this.currentField ? ` · ${this.currentField.hud()}` : '';
    const html = `<div class="world-clock">${hh}:${String(m).padStart(2, '0')} <small>${ap}</small></div><div class="world-weather">${WEATHER[this.key].label}</div><div class="world-detail">${tide}${lunarRange} · wind ${dir} ${Math.round(this.values.wind * this.gust * MPS_TO_MPH)} mph${current}</div>`;
    if (html !== this.hudHtml) { this.hudHtml = html; this.el.innerHTML = html; } // skip the DOM re-parse when nothing on the panel changed
  }
}
