import * as THREE from 'three';
import { WORLD_HALF } from './terrain.js';
import { emitMapMarker } from './mapmarkers.js';

export const MAX_MARSH_FIRES = 3;
const MPH = 2.23694;
const SAVE_VERSION = 1;
const SCAR_REALTIME_MS = 15 * 60 * 1000;
const FIRE_REALTIME_MS = 20 * 60 * 1000;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = (a, b, value) => {
  const t = clamp((Number(value) - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const whole = value => Math.max(0, Math.min(999999, Math.floor(finite(value))));
const fract = value => value - Math.floor(value);
const slotNoise = (seed, index, salt = 0) => fract(Math.sin(seed * 91.713 + index * 37.119 + salt * 17.173) * 43758.5453);
const fmtDist = metres => metres < 305 ? `${Math.max(1, Math.round(metres * 3.28084))} ft` : `${(metres / 1609.344).toFixed(2)} mi`;

// Fuel is a landscape property and a moisture property. The low-bank term prevents flames from appearing in open
// water, while the high-bank taper keeps this system on marsh, sawgrass and cypress litter rather than pine upland.
export function marshFireFuel({ ground = 0, waterLevel = 0, openness = 0, wetness = 0, rain = 0, blocked = false } = {}) {
  const elevation = finite(ground) - finite(waterLevel);
  if (blocked || elevation <= 0.075 || elevation >= 3.4) return 0;
  const bank = smooth(0.075, 0.32, elevation) * (1 - smooth(2.35, 3.4, elevation));
  const vegetation = 0.3 + clamp(openness) * 0.7;
  const moisture = clamp(clamp(wetness) * 0.72 + clamp(rain) * 0.74);
  return clamp(bank * vegetation * (0.18 + (1 - moisture) * 0.82));
}

export function marshFireIgnitionChance(input = {}) {
  if (input.water) return 0;
  const fuel = marshFireFuel(input);
  if (fuel <= 0.04) return 0;
  const rain = clamp(input.rain), wetness = clamp(input.wetness);
  const dry = 1 - clamp(wetness * 0.86 + rain * 0.82);
  const wind = Math.max(0, finite(input.wind));
  const airflow = 0.72 + smooth(2, 22, wind) * 0.43;
  return clamp(fuel * (0.012 + dry * dry * 0.58) * airflow * (1 - rain * 0.48));
}

// A small pure step keeps weather balancing testable. Runtime callers reuse an output object so this never creates
// garbage in the frame loop.
export function marshFireDynamics(input = {}, dt = 0, out = {}) {
  const seconds = clamp(dt, 0, 1), intensity = clamp(input.intensity, 0, 1.25), fuel = clamp(input.fuel);
  const rain = clamp(input.rain), wetness = clamp(input.wetness), suppression = clamp(input.suppression);
  const wind = Math.max(0, finite(input.wind)), airflow = smooth(2, 25, wind), fan = clamp(input.fan);
  const maxLife = Math.max(30, finite(input.maxLife, 150)), age = Math.max(0, finite(input.age));
  const maturity = clamp(1 - intensity / 1.25);
  const growth = (0.012 + airflow * 0.024) * fuel * maturity + fan * 0.095;
  const loss = rain * 0.22 + wetness * 0.028 + suppression * 0.19 + clamp(input.flooded) * 0.55 + smooth(maxLife * 0.72, maxLife, age) * 0.05;
  out.intensity = clamp(intensity + (growth - loss) * seconds, 0, 1.25);
  out.radius = clamp(finite(input.radius, 3.2) + out.intensity * fuel * (0.018 + wind * 0.002) * seconds, 2.5, 24);
  out.advance = Math.max(0, out.intensity * fuel * (0.012 + wind * 0.006) + fan * 0.15);
  out.growth = growth;
  out.loss = loss;
  return out;
}

export function normalizeMarshFireLedger(value, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const rawStats = source.stats && typeof source.stats === 'object' ? source.stats : {};
  const stats = {
    ignitions: whole(rawStats.ignitions), spotFires: whole(rawStats.spotFires), contained: whole(rawStats.contained),
    weatherOut: whole(rawStats.weatherOut), burnedOut: whole(rawStats.burnedOut), propFanned: whole(rawStats.propFanned),
    pumpSeconds: Math.round(clamp(rawStats.pumpSeconds, 0, 999999) * 10) / 10,
  };
  const patches = [];
  for (const item of Array.isArray(source.patches) ? source.patches : []) {
    if (patches.length >= MAX_MARSH_FIRES) break;
    if (!item || typeof item !== 'object') continue;
    const state = item.state === 'burning' ? 'burning' : item.state === 'scar' ? 'scar' : '';
    const x = finite(item.x, NaN), z = finite(item.z, NaN), expiresAt = finite(item.expiresAt, 0);
    if (!state || !Number.isFinite(x) || !Number.isFinite(z) || Math.max(Math.abs(x), Math.abs(z)) >= WORLD_HALF || expiresAt <= now) continue;
    patches.push({
      state, x, z,
      originX: clamp(finite(item.originX, x), -WORLD_HALF, WORLD_HALF), originZ: clamp(finite(item.originZ, z), -WORLD_HALF, WORLD_HALF),
      intensity: state === 'burning' ? clamp(item.intensity, 0.03, 1.25) : 0,
      radius: clamp(item.radius, 2.5, 24), age: clamp(item.age, 0, 900), maxLife: clamp(item.maxLife, 30, 420),
      seed: clamp(item.seed), source: item.source === 'ember' ? 'ember' : 'lightning',
      pumpSeconds: clamp(item.pumpSeconds, 0, 9999), fanned: Boolean(item.fanned), savedAt: finite(item.savedAt, now), expiresAt,
    });
  }
  return { version: SAVE_VERSION, stats, patches };
}

function flameGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.18, 1, 0, -0.18, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.18, 0, 1, -0.18,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeBoundingSphere();
  return geometry;
}

function scarGeometry(segments = 28) {
  const count = Math.max(12, Math.floor(segments));
  const positions = [0, 0, 0], uvs = [0.5, 0.5], indices = [];
  for (let index = 0; index <= count; index++) {
    const angle = index / count * Math.PI * 2;
    const radius = 0.88 + Math.sin(angle * 3 + 0.7) * 0.055 + Math.sin(angle * 7 - 1.2) * 0.035 + Math.sin(angle * 11 + 2.4) * 0.022;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    positions.push(x, y, 0); uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
    if (index < count) indices.push(0, index + 1, index + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

const FLAME_VERTEX = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = fract(abs(instanceMatrix[3].x * 0.0171 + instanceMatrix[3].z * 0.0237));
    vec3 p = position;
    float sway = sin(uTime * (5.1 + vSeed * 2.7) + p.y * 5.7 + vSeed * 19.0) * p.y;
    p.x += sway * 0.13;
    p.z += cos(uTime * 4.3 + p.y * 4.9 + vSeed * 23.0) * p.y * 0.08;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`;

const FLAME_FRAGMENT = `
  uniform float uTime, uOpacity;
  uniform vec3 uBase, uTip;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    float y = clamp(vUv.y, 0.0, 1.0);
    float phase = uTime * (5.4 + vSeed * 2.2) + vSeed * 41.0;
    float x = vUv.x * 2.0 - 1.0;
    float centre = (sin(phase + y * 5.8) * 0.09 + sin(phase * 0.63 + y * 12.7) * 0.045) * y;
    float ripple = sin(y * 17.0 - phase * 1.17) * 0.075 + sin(y * 31.0 + phase * 0.74) * 0.034;
    float taper = mix(0.98, 0.055, pow(y, 0.68)) + ripple * (0.28 + y * 0.72);
    float side = abs(x - centre);
    float body = 1.0 - smoothstep(max(0.015, taper - 0.13), taper, side);
    float lickNoise = sin((x + vSeed) * 10.7 + phase * 0.68 + y * 9.0) + sin(x * 19.3 - phase * 0.44 - y * 15.0) * 0.55;
    float licks = smoothstep(-0.78, 0.2, lickNoise + (1.0 - y) * 0.85);
    body *= mix(1.0, licks, smoothstep(0.46, 0.94, y));
    float foot = smoothstep(0.0, 0.06, y);
    float tip = 1.0 - smoothstep(0.9, 1.025, y + ripple * 0.4);
    float pulse = 0.84 + 0.16 * sin(phase * 1.43 + y * 8.0);
    float alpha = body * foot * tip * pulse * uOpacity;
    if (alpha < 0.018) discard;
    vec3 colour = mix(uBase, uTip, smoothstep(0.03, 0.94, y));
    colour *= 0.88 + pulse * 0.18;
    gl_FragColor = vec4(colour, alpha);
  }
`;

function flameMaterial(base, tip, opacity, blending = THREE.NormalBlending) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: opacity }, uBase: { value: new THREE.Color(base) }, uTip: { value: new THREE.Color(tip) } },
    vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true, blending, side: THREE.DoubleSide, toneMapped: true,
  });
}

function blankPatch(index) {
  return {
    index, state: 'idle', x: 0, z: 0, originX: 0, originZ: 0, intensity: 0, radius: 3.2, age: 0, maxLife: 150,
    seed: 0, source: 'lightning', ground: 0, spreadCarry: 0, spreadT: 0, emberT: 20, smokeCarry: 0, coolT: 0,
    damageT: 0, pumpSeconds: 0, fanned: false, fanNoticeT: 0, spreadWarned: false, pumpCalled: false,
    savedAt: 0, expiresAt: 0,
  };
}

export class MarshFireDirector {
  constructor(options = {}) {
    Object.assign(this, options); // scene, terrain, world, water, phys, game, audio, environment, condition, plume, spray, profile, ecology, waders, radio
    this.maxPatches = MAX_MARSH_FIRES;
    this.flamesPerPatch = this.profile?.id === 'fallback' ? 6 : this.profile?.id === 'performance' ? 8 : this.profile?.id === 'cinematic' ? 12 : 10;
    this.flameCapacity = this.flamesPerPatch * this.maxPatches;
    this.geometry = flameGeometry();
    this.outerMaterial = flameMaterial(0xff6b18, 0x7a170b, 0.72);
    this.coreMaterial = flameMaterial(0xffd36a, 0xff3a0d, 0.66);
    this.outer = new THREE.InstancedMesh(this.geometry, this.outerMaterial, this.flameCapacity);
    this.core = new THREE.InstancedMesh(this.geometry, this.coreMaterial, this.flameCapacity);
    for (const mesh of [this.outer, this.core]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.renderOrder = mesh === this.outer ? 4 : 5;
      mesh.castShadow = false; mesh.receiveShadow = false;
    }
    this.scarGeometry = scarGeometry();
    this.scarMaterial = new THREE.MeshStandardMaterial({ color: 0x21150f, roughness: 1, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.scars = new THREE.InstancedMesh(this.scarGeometry, this.scarMaterial, this.maxPatches);
    this.scars.count = 0; this.scars.frustumCulled = false; this.scars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scars.renderOrder = -1;
    this.light = new THREE.PointLight(0xff6a28, 0, 82, 2); this.light.castShadow = false;
    this.scene?.add(this.scars, this.outer, this.core, this.light);
    this.patches = Array.from({ length: this.maxPatches }, (_, index) => blankPatch(index));
    this._dummy = new THREE.Object3D(); this._dynamics = {}; this._wind = new THREE.Vector2(); this._forward = new THREE.Vector2();
    this.visualT = 0; this.hudT = 0; this.saveT = 6; this.clock = 0; this.renderedFlames = 0;
    this.pumpHeld = false; this.pumpActive = false; this.pumpCarry = 0; this.pumpMistT = 0; this.prompting = false; this.lastPromptHtml = '';
    this.interactivePatch = null; this.nearestPatch = null; this.enabled = false; this.disposed = false;
    this.el = globalThis.document?.getElementById?.('fireState') || null;
    const existing = normalizeMarshFireLedger(this.game?.save?.marshFire);
    this.ledger = existing; this.stats = existing.stats;
    if (this.game?.save) this.game.save.marshFire = this.ledger;
    this.restore(existing.patches);
    this.keyDown = event => {
      if (event.repeat || !this.capturesInput(event.code)) return;
      this.pumpHeld = true; event.preventDefault?.();
    };
    this.keyUp = event => { if (event.code === 'KeyE') this.pumpHeld = false; };
    this.blur = () => { this.pumpHeld = false; };
    globalThis.window?.addEventListener?.('keydown', this.keyDown);
    globalThis.window?.addEventListener?.('keyup', this.keyUp);
    globalThis.window?.addEventListener?.('blur', this.blur);
    this.updateVisuals(0);
  }

  restore(records) {
    const now = Date.now();
    for (let index = 0; index < Math.min(records.length, this.patches.length); index++) {
      const record = records[index], patch = this.patches[index], offline = Math.max(0, (now - record.savedAt) / 1000);
      Object.assign(patch, record);
      patch.ground = this.terrain?.heightAt?.(patch.x, patch.z) ?? 0;
      patch.spreadCarry = 0; patch.spreadT = 0; patch.emberT = 14 + slotNoise(patch.seed, 2) * 18; patch.smokeCarry = 0;
      patch.coolT = patch.state === 'scar' ? 0 : Math.max(0, 16 - offline); patch.damageT = 0; patch.fanNoticeT = 0;
      patch.spreadWarned = false; patch.pumpCalled = false;
      if (patch.state === 'burning') {
        patch.age += Math.min(120, offline * 0.18);
        patch.intensity *= Math.exp(-offline * 0.003);
        if (patch.intensity < 0.035 || offline > 420) { patch.state = 'scar'; patch.intensity = 0; patch.coolT = 0; patch.expiresAt = Math.min(patch.expiresAt, now + SCAR_REALTIME_MS); }
      }
    }
  }

  fuelAt(x, z, force = false) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.max(Math.abs(x), Math.abs(z)) >= WORLD_HALF - 45) return 0;
    const ground = this.terrain.heightAt(x, z), blocked = Boolean(this.world?.blockedAt?.(x, z));
    if (blocked || ground <= this.environment.waterLevel + 0.075 || ground >= this.environment.waterLevel + 3.4) return 0;
    const fuel = marshFireFuel({
      ground, waterLevel: this.environment.waterLevel, openness: this.terrain.openness?.(x, z) || 0,
      wetness: this.environment.surfaceWetness, rain: this.environment.values?.rain, blocked,
    });
    return force ? Math.max(0.68, fuel) : fuel;
  }

  acquirePatch() {
    let patch = this.patches.find(item => item.state === 'idle');
    if (!patch) patch = this.patches.filter(item => item.state === 'scar').sort((a, b) => a.expiresAt - b.expiresAt)[0];
    return patch || null;
  }

  overlapsFire(x, z, padding = 5) {
    return this.patches.some(patch => patch.state === 'burning' && Math.hypot(patch.x - x, patch.z - z) < patch.radius + padding);
  }

  igniteAt(x, z, { force = false, source = 'lightning', intensity, announce = true } = {}) {
    const fuel = this.fuelAt(x, z, force);
    if (fuel <= 0.04 || this.overlapsFire(x, z)) return false;
    const patch = this.acquirePatch(); if (!patch) return false;
    const now = Date.now(), ground = this.terrain.heightAt(x, z), initial = intensity == null ? (force ? 0.88 : 0.38 + fuel * 0.22) : intensity;
    Object.assign(patch, {
      state: 'burning', x, z, originX: x, originZ: z, intensity: clamp(initial, 0.12, 1.1), radius: 3 + fuel * 1.4,
      age: 0, maxLife: 125 + Math.random() * 95, seed: Math.random(), source: source === 'ember' ? 'ember' : 'lightning', ground,
      spreadCarry: 0, spreadT: 0, emberT: 13 + Math.random() * 20, smokeCarry: 0, coolT: 18, damageT: 0,
      pumpSeconds: 0, fanned: false, fanNoticeT: 0, spreadWarned: false, pumpCalled: false, savedAt: now, expiresAt: now + FIRE_REALTIME_MS,
    });
    this.stats.ignitions++;
    if (patch.source === 'ember') this.stats.spotFires++;
    this.waders?.flushNear?.(x, z, 180);
    const feeding = this.ecology?.feeding;
    if (feeding?.active && Math.hypot(feeding.x - x, feeding.z - z) < 220) this.ecology.scatterFeeding?.('fire');
    if (announce) this.announceIgnition(patch);
    this.visualT = 0; this.persist(true);
    return patch;
  }

  announceIgnition(patch) {
    const distance = Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y);
    this.audio?.warn?.();
    if (distance < 420) this.game.toast(patch.source === 'ember' ? 'Windborne spot fire' : 'Dry-lightning fire', 'Sawgrass is burning on the bank. Stay on the water and approach at idle.', 4.2);
    if (patch.source === 'lightning') this.radio?.transmit?.({
      channel: 'FWC TAC', speaker: 'FWC FIRE',
      text: 'Lightning has lit a low bank in the tower boat’s cut. Stay on open water, approach from the wet edge, and do not put prop wash into the grass.',
      priority: 4, key: `marsh-fire:${this.environment.day}:${Math.round(patch.x / 50)}:${Math.round(patch.z / 50)}`, cooldown: 35,
    });
  }

  lightning(strike) {
    if (!strike || strike.water) return false;
    const ground = this.terrain.heightAt(strike.x, strike.z), openness = this.terrain.openness?.(strike.x, strike.z) || 0;
    const chance = marshFireIgnitionChance({
      water: strike.water, ground, waterLevel: this.environment.waterLevel, openness,
      wetness: this.environment.surfaceWetness, rain: this.environment.values?.rain,
      wind: (this.environment.values?.wind || 0) * (this.environment.gust || 1), blocked: this.world?.blockedAt?.(strike.x, strike.z),
    });
    if (Math.random() >= chance) return false;
    return this.igniteAt(strike.x, strike.z, { source: 'lightning' });
  }

  findBankNear() {
    const px = this.phys.pos.x, pz = this.phys.pos.y, fx = -Math.sin(this.phys.heading), fz = -Math.cos(this.phys.heading);
    const base = Math.atan2(fz, fx); let best = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < 140; attempt++) {
      const ring = 18 + (attempt % 14) * 7.5, sweep = (attempt * 2.399963229728653) % (Math.PI * 2);
      const angle = base + sweep, x = px + Math.cos(angle) * ring, z = pz + Math.sin(angle) * ring, fuel = this.fuelAt(x, z, true);
      if (fuel <= 0 || this.overlapsFire(x, z, 12)) continue;
      const forwardBias = Math.cos(sweep) * 0.28, score = fuel + forwardBias - ring * 0.0015;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best;
  }

  igniteNear() {
    const at = this.findBankNear();
    return at ? this.igniteAt(at.x, at.z, { force: true, source: 'lightning', intensity: 0.94 }) : false;
  }

  trySpotFire(parent) {
    if (parent.state !== 'burning' || parent.intensity < 0.72 || this.environment.surfaceWetness > 0.62 || (this.environment.values?.wind || 0) < 7) return false;
    const wind = this.environment.windDir, distance = 16 + Math.random() * 26, side = (Math.random() - 0.5) * 16;
    const x = parent.x + wind.x * distance - wind.z * side, z = parent.z + wind.z * distance + wind.x * side;
    if (Math.random() > 0.34 || this.fuelAt(x, z) < 0.24) return false;
    const patch = this.igniteAt(x, z, { source: 'ember', intensity: 0.25 + parent.intensity * 0.18, announce: false });
    if (patch && Math.hypot(x - this.phys.pos.x, z - this.phys.pos.y) < 300) this.game.toast('Spot fire', 'An ember crossed the wet edge and found dry grass downwind.', 3.2);
    return patch;
  }

  nearestBurning(maxDistance = Infinity) {
    let best = null, distance = maxDistance;
    for (const patch of this.patches) {
      if (patch.state !== 'burning') continue;
      const d = Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y);
      if (d < distance) { best = patch; distance = d; }
    }
    if (best) best.playerDistance = distance;
    return best;
  }

  interactionFree() {
    const prompt = this.game.el?.prompt;
    const anotherPrompt = prompt?.classList?.contains?.('on') && prompt.innerHTML !== this.lastPromptHtml;
    return !anotherPrompt && !this.game.state && !this.game.paused && !this.game.inputLock && !this.game.menuOpen && !this.game.mapOpen && !this.game.resultOpen
      && !this.game.dockJob && !this.game.dockCamp && !this.game.atBoard && !this.encounters?.active
      && !this.story?.blocking?.() && !this.aftermath?.blocking?.() && !this.fishing?.blocking?.()
      && !this.incidents?.prompting && !this.discoveries?.prompting && !this.navigationAids?.prompting;
  }

  canSuppress(patch) {
    if (!patch || patch.playerDistance > 27 || !this.interactionFree()) return false;
    return !this.phys.airborne && this.phys.wet > 0.25 && this.phys.speed * MPH < 5.5 && this.phys.rpm < 0.42;
  }

  setPrompt(patch) {
    const element = this.game.el?.prompt; if (!element) { this.prompting = true; return; }
    if (element.classList.contains('on') && element.innerHTML !== this.lastPromptHtml) { this.prompting = false; return; }
    const html = `<b>E</b> hold bank-water pump <i>· ${Math.round(patch.intensity / 1.25 * 100)}% flame · keep the prop at idle</i>`;
    element.innerHTML = html; element.classList.add('on'); this.lastPromptHtml = html; this.prompting = true;
  }

  clearPrompt() {
    const element = this.game.el?.prompt;
    if (element && element.innerHTML === this.lastPromptHtml) element.classList.remove('on');
    this.prompting = false; this.pumpHeld = false;
  }

  capturesInput(code) {
    if (code !== 'KeyE' || !this.prompting) return false;
    const element = this.game.el?.prompt;
    return !element || (element.classList.contains('on') && element.innerHTML === this.lastPromptHtml);
  }

  fanStrength(patch) {
    const dx = patch.x - this.phys.pos.x, dz = patch.z - this.phys.pos.y, distance = Math.hypot(dx, dz);
    if (distance >= 36 || distance <= 0.001 || this.phys.rpm < 0.42) return 0;
    const fx = -Math.sin(this.phys.heading), fz = -Math.cos(this.phys.heading);
    const stern = -(dx / distance * fx + dz / distance * fz);
    return smooth(0.38, 0.88, stern) * smooth(0.42, 0.92, this.phys.rpm) * smooth(36, 10, distance);
  }

  updatePatch(patch, dt) {
    patch.age += dt; patch.damageT = Math.max(0, patch.damageT - dt); patch.fanNoticeT = Math.max(0, patch.fanNoticeT - dt);
    const rain = clamp(this.environment.values?.rain), wetness = clamp(this.environment.surfaceWetness);
    const ground = this.terrain.heightAt(patch.x, patch.z), fuel = this.fuelAt(patch.x, patch.z), windSpeed = Math.max(0, (this.environment.values?.wind || 0) * (this.environment.gust || 1));
    const flooded = ground <= this.environment.waterLevel + 0.04 ? 1 : 0;
    const fan = this.fanStrength(patch), suppression = this.pumpActive && patch === this.interactivePatch ? 1 : 0;
    if (fan > 0.22 && !patch.fanned) {
      patch.fanned = true; this.stats.propFanned++; this.game.toast('Prop wash fanned the line', 'Turn the bow toward the fire and bring the prop to idle.', 3.2); this.persist(true);
    }
    marshFireDynamics({ intensity: patch.intensity, radius: patch.radius, age: patch.age, maxLife: patch.maxLife, fuel, rain, wetness, wind: windSpeed, suppression, fan, flooded }, dt, this._dynamics);
    patch.intensity = this._dynamics.intensity; patch.radius = this._dynamics.radius; patch.ground = ground;
    patch.spreadCarry += this._dynamics.advance * dt; patch.spreadT -= dt;
    if (patch.spreadT <= 0 && patch.spreadCarry > 0.035) {
      patch.spreadT = 0.35; const wind = this.environment.windDir, nx = patch.x + wind.x * patch.spreadCarry, nz = patch.z + wind.z * patch.spreadCarry;
      if (this.fuelAt(nx, nz) > 0.08 && !this.world?.blockedAt?.(nx, nz)) { patch.x = nx; patch.z = nz; patch.ground = this.terrain.heightAt(nx, nz); }
      patch.spreadCarry = 0;
    }
    patch.emberT -= dt;
    if (patch.emberT <= 0) { patch.emberT = 17 + Math.random() * 28; this.trySpotFire(patch); }
    if (!patch.spreadWarned && patch.intensity > 0.84 && patch.radius > 7.5) {
      patch.spreadWarned = true;
      this.radio?.transmit?.({ channel: 'FWC TAC', speaker: 'FWC FIRE', text: 'The head fire is moving with the wind. Work only the wet flank from the water; do not cross the smoke column.', priority: 3, key: `marsh-fire-spread:${Math.round(patch.originX / 50)}:${Math.round(patch.originZ / 50)}`, cooldown: 60 });
    }
    this.emitSmoke(patch, dt, windSpeed);
    this.applyHeat(patch);
    if (suppression) { patch.pumpSeconds += dt; this.stats.pumpSeconds += dt; }
    if (patch.intensity <= 0.022) this.finishPatch(patch, patch.pumpSeconds >= 0.8 ? 'contained' : rain > 0.38 || flooded ? 'weather' : 'burned-out');
  }

  emitSmoke(patch, dt, windSpeed) {
    const distance = Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y);
    if (distance > 520 || !this.plume?.emit) return;
    patch.smokeCarry += dt * patch.intensity * (4.5 + Math.min(8, windSpeed * 0.24));
    let amount = Math.min(4, Math.floor(patch.smokeCarry)); patch.smokeCarry -= amount;
    while (amount-- > 0) {
      const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * patch.radius * 0.78;
      const x = patch.x + Math.cos(angle) * radius, z = patch.z + Math.sin(angle) * radius, y = this.terrain.heightAt(x, z) + 0.55 + Math.random() * 1.2;
      const wind = this.environment.windDir, drift = 0.65 + windSpeed * 0.055;
      this.plume.emit(x, y, z, wind.x * drift + (Math.random() - 0.5) * 0.4, 0.75 + Math.random() * 0.65, wind.z * drift + (Math.random() - 0.5) * 0.4, 0.62 + Math.random() * 0.72, 0.42 + Math.random() * 0.38, 3 + Math.random() * 2, 0.3 + patch.intensity * 0.18, true);
    }
  }

  applyHeat(patch) {
    const distance = Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y), reach = patch.radius + 5.5;
    if (distance >= reach || patch.damageT > 0 || patch.intensity < 0.22) return;
    const heat = clamp((reach - distance) / Math.max(3, reach)) * patch.intensity;
    if (heat <= 0.04) return;
    patch.damageT = 0.85; this.condition?.damage?.(0.04 + heat * 0.16, 0.02 + heat * 0.11);
    this.game.shake = Math.max(this.game.shake || 0, heat * 0.09);
    if (patch.fanNoticeT <= 0) { patch.fanNoticeT = 5; this.game.toast('Radiant heat on the hull', 'Back out of the flame edge and work it from the water.', 2.4); }
  }

  emitPump(dt, patch) {
    const dx = patch.x - this.phys.pos.x, dz = patch.z - this.phys.pos.y, distance = Math.hypot(dx, dz) || 1;
    const ux = dx / distance, uz = dz / distance, startX = this.phys.pos.x + ux * 2.4, startZ = this.phys.pos.y + uz * 2.4;
    this.pumpCarry += dt * (this.profile?.id === 'fallback' ? 42 : this.profile?.id === 'performance' ? 54 : 68);
    let count = Math.min(5, Math.floor(this.pumpCarry)); this.pumpCarry -= count;
    while (count-- > 0) {
      const travel = clamp(distance / 17, 0.55, 1.6), speed = distance / travel;
      this.spray?.emit?.(startX + (Math.random() - 0.5) * 0.28, this.water.level + 1.25, startZ + (Math.random() - 0.5) * 0.28,
        ux * speed + (Math.random() - 0.5) * 0.8, 5.8 + distance * 0.055 + Math.random() * 0.6, uz * speed + (Math.random() - 0.5) * 0.8,
        0.013 + Math.random() * 0.012, travel, 0.82);
    }
    this.pumpMistT -= dt;
    if (this.pumpMistT <= 0) {
      this.pumpMistT = 0.12;
      this.plume?.emit?.(patch.x + (Math.random() - 0.5) * 1.4, patch.ground + 0.35, patch.z + (Math.random() - 0.5) * 1.4,
        this.environment.windDir.x * 0.45, 0.7 + Math.random() * 0.5, this.environment.windDir.z * 0.45, 0.26 + Math.random() * 0.2, 0.55, 0.72 + Math.random() * 0.3, 0.26, false);
    }
    if (!patch.pumpCalled) {
      patch.pumpCalled = true;
      this.radio?.transmit?.({ channel: 'CH 16', speaker: 'MARA KEENE · TOWER', text: 'Bank-water pump is flowing. Sweep the wet edge, keep the prop at idle, and leave yourself a clean reverse line.', priority: 3, key: 'marsh-fire:pumping', cooldown: 45 });
    }
  }

  finishPatch(patch, reason) {
    if (patch.state !== 'burning') return;
    patch.state = 'scar'; patch.intensity = 0; patch.coolT = 18; patch.savedAt = Date.now(); patch.expiresAt = Date.now() + SCAR_REALTIME_MS;
    if (reason === 'contained') {
      this.stats.contained++; this.game.bounties?.event?.('marshfire', 1);
      this.game.toast('Fire line contained', 'No visible flame. Hold off the black edge and watch for smoke.', 4);
      this.radio?.transmit?.({ channel: 'FWC TAC', speaker: 'FWC FIRE', text: 'Tower Boat has visible flame knocked down from the water. Marking the bank for an infrared pass and mop-up crew.', priority: 3, key: `marsh-fire-contained:${this.stats.contained}`, cooldown: 30 });
      this.reputation?.change?.('fwc', 0.34, 'marsh-fire-contained', 'You held the wet edge and stopped a bank fire without putting the boat ashore.', true);
      this.reputation?.change?.('locals', 0.22, 'marsh-fire-contained', 'The tower boat kept a grass fire out of the camps and rookery.', false);
    } else if (reason === 'weather') {
      this.stats.weatherOut++;
      if (Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y) < 170) this.game.toast('Rain took the fire', 'Steam is lifting off the black edge. It can still hold hot spots.', 3.2);
    } else this.stats.burnedOut++;
    this.persist(true); this.visualT = 0;
  }

  expireScars(dt) {
    const now = Date.now(); let changed = false;
    for (const patch of this.patches) {
      if (patch.state !== 'scar') continue;
      patch.coolT = Math.max(0, patch.coolT - dt);
      if (patch.expiresAt <= now) { Object.assign(patch, blankPatch(patch.index)); changed = true; }
    }
    if (changed) this.persist(true);
  }

  updateInteraction() {
    const patch = this.nearestBurning(42); this.nearestPatch = patch; this.interactivePatch = patch;
    const canPump = this.canSuppress(patch);
    if (canPump) this.setPrompt(patch); else this.clearPrompt();
    this.pumpActive = Boolean(canPump && this.pumpHeld);
    if (this.pumpActive) this.emitPump(this.lastDt, patch); else { this.pumpCarry = 0; this.pumpMistT = 0; }
  }

  updateLight() {
    const patch = this.nearestBurning(180);
    if (!patch) { this.light.intensity = 0; return; }
    const night = 1 - clamp(this.environment.daylight), distanceFade = clamp((180 - patch.playerDistance) / 130);
    this.light.position.set(patch.x, patch.ground + 3.2, patch.z);
    this.light.intensity = patch.intensity * distanceFade * (42 + night * 120);
    this.light.distance = 48 + patch.radius * 2.2;
  }

  updateVisuals(time) {
    let flameIndex = 0, scarIndex = 0;
    const dummy = this._dummy, waterLevel = this.environment?.waterLevel || 0, wind = this.environment?.windDir || { x: 1, z: 0 };
    for (const patch of this.patches) {
      if (patch.state === 'idle') continue;
      const trailX = patch.x - patch.originX, trailZ = patch.z - patch.originZ, trail = Math.hypot(trailX, trailZ);
      const midX = (patch.x + patch.originX) * 0.5, midZ = (patch.z + patch.originZ) * 0.5;
      dummy.position.set(midX, this.terrain.heightAt(midX, midZ) + 0.035, midZ);
      dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(trailZ, trailX), 'XYZ');
      dummy.scale.set(patch.radius + trail * 0.52, patch.radius * 0.72, 1); dummy.updateMatrix(); this.scars.setMatrixAt(scarIndex++, dummy.matrix);
      if (patch.state !== 'burning') continue;
      const count = Math.max(3, Math.round(this.flamesPerPatch * clamp(0.42 + patch.intensity * 0.54, 0.35, 1)));
      for (let local = 0; local < count && flameIndex < this.flameCapacity; local++) {
        const angle = slotNoise(patch.seed, local, 1) * Math.PI * 2;
        const radius = patch.radius * (0.12 + Math.sqrt(slotNoise(patch.seed, local, 2)) * 0.82);
        let x = patch.x + Math.cos(angle) * radius + wind.x * patch.radius * 0.12;
        let z = patch.z + Math.sin(angle) * radius + wind.z * patch.radius * 0.12;
        let ground = this.terrain.heightAt(x, z);
        if (ground <= waterLevel + 0.04) { x = patch.x + Math.cos(angle) * patch.radius * 0.35; z = patch.z + Math.sin(angle) * patch.radius * 0.35; ground = this.terrain.heightAt(x, z); }
        const pulse = 0.76 + slotNoise(patch.seed, local, 3) * 0.58, height = (0.92 + patch.intensity * 1.95) * pulse;
        const width = (0.48 + patch.intensity * 0.46) * (0.72 + slotNoise(patch.seed, local, 4) * 0.5);
        dummy.position.set(x, ground + 0.04, z); dummy.rotation.set(0, slotNoise(patch.seed, local, 5) * Math.PI * 2, 0); dummy.scale.set(width, height, width); dummy.updateMatrix(); this.outer.setMatrixAt(flameIndex, dummy.matrix);
        dummy.position.y += 0.03; dummy.scale.set(width * 0.48, height * 0.68, width * 0.48); dummy.updateMatrix(); this.core.setMatrixAt(flameIndex, dummy.matrix);
        flameIndex++;
      }
    }
    this.outer.count = flameIndex; this.core.count = flameIndex; this.scars.count = scarIndex;
    this.outer.visible = flameIndex > 0; this.core.visible = flameIndex > 0; this.scars.visible = scarIndex > 0;
    if (flameIndex > 0) { this.outer.instanceMatrix.needsUpdate = true; this.core.instanceMatrix.needsUpdate = true; }
    if (scarIndex > 0) this.scars.instanceMatrix.needsUpdate = true;
    this.outerMaterial.uniforms.uTime.value = time; this.coreMaterial.uniforms.uTime.value = time; this.renderedFlames = flameIndex;
  }

  publishMarkers() {
    for (const patch of this.patches) {
      if (patch.state !== 'burning') continue;
      const distance = Math.hypot(patch.x - this.phys.pos.x, patch.z - this.phys.pos.y);
      emitMapMarker(this.game, patch.x, patch.z, 'hazard', '#ff6b32', 0, distance < 620, '', false, false, true, false, 5 + patch.radius * 0.24);
    }
  }

  renderHud() {
    if (!this.el) return;
    const patch = this.nearestBurning(620);
    if (!patch) { this.el.classList.remove('on'); this.el.innerHTML = ''; return; }
    const wind = this.environment.windDir, angle = (Math.atan2(wind.x, -wind.z) * 180 / Math.PI + 360) % 360;
    const direction = angle < 22.5 || angle >= 337.5 ? 'north' : angle < 67.5 ? 'northeast' : angle < 112.5 ? 'east' : angle < 157.5 ? 'southeast' : angle < 202.5 ? 'south' : angle < 247.5 ? 'southwest' : angle < 292.5 ? 'west' : 'northwest';
    let line = `${fmtDist(patch.playerDistance)} · spreading ${direction}`;
    if (this.pumpActive && patch === this.interactivePatch) line = `pumping · flame ${Math.round(patch.intensity / 1.25 * 100)}%`;
    else if (patch.playerDistance < 32 && this.phys.speed * MPH >= 5.5) line = 'idle below 5 mph to use bank water';
    else if (patch.playerDistance < 32 && this.phys.rpm >= 0.42) line = 'prop wash is feeding the fire';
    else if (this.canSuppress(patch)) line = 'hold E · bank-water pump ready';
    this.el.classList.add('on'); this.el.innerHTML = `<span>${patch.source === 'ember' ? 'Spot fire' : 'Marsh fire'}</span><small>${line}</small>`;
  }

  persist(force = false) {
    if (!this.game?.save || (!force && this.saveT > 0)) return false;
    if (!force) {
      let active = false;
      for (const patch of this.patches) if (patch.state !== 'idle') { active = true; break; }
      if (!active) { this.saveT = 6; return false; }
    }
    const now = Date.now(); this.saveT = 6; this.ledger.version = SAVE_VERSION; this.ledger.stats = this.stats;
    this.ledger.patches = this.patches.filter(patch => patch.state !== 'idle').map(patch => ({
      state: patch.state, x: patch.x, z: patch.z, originX: patch.originX, originZ: patch.originZ, intensity: patch.intensity,
      radius: patch.radius, age: patch.age, maxLife: patch.maxLife, seed: patch.seed, source: patch.source,
      pumpSeconds: patch.pumpSeconds, fanned: patch.fanned, savedAt: now,
      expiresAt: patch.state === 'burning' ? now + FIRE_REALTIME_MS : patch.expiresAt,
    }));
    this.game.save.marshFire = this.ledger; this.game.persist?.(); return true;
  }

  update(dt, time, enabled = true) {
    this.enabled = enabled; this.lastDt = clamp(dt, 0, 0.1);
    this.outerMaterial.uniforms.uTime.value = time; this.coreMaterial.uniforms.uTime.value = time;
    if (!enabled) {
      this.clearPrompt(); this.pumpActive = false; this.audio?.marshFire?.(0, 0); if (this.el) this.el.classList.remove('on'); return;
    }
    this.clock += this.lastDt; this.saveT -= this.lastDt;
    this.updateInteraction();
    for (const patch of this.patches) if (patch.state === 'burning') this.updatePatch(patch, this.lastDt);
    this.expireScars(this.lastDt); this.updateLight(); this.publishMarkers();
    const audible = this.nearestBurning(260);
    if (audible) this.audio?.marshFire?.(clamp((250 - audible.playerDistance) / 220) * audible.intensity, this.pumpActive ? 1 : 0, audible.x, audible.z);
    else this.audio?.marshFire?.(0, this.pumpActive ? 1 : 0);
    this.visualT -= this.lastDt;
    if (this.visualT <= 0) { this.visualT = 1 / 15; this.updateVisuals(time); }
    this.hudT -= this.lastDt;
    if (this.hudT <= 0) { this.hudT = 0.12; this.renderHud(); }
    this.persist(false);
  }

  resourceStats() {
    let burning = 0, scars = 0;
    for (const patch of this.patches) { if (patch.state === 'burning') burning++; else if (patch.state === 'scar') scars++; }
    return { pool: this.patches.length, burning, scars, flameCapacity: this.flameCapacity, renderedFlames: this.renderedFlames, draws: 3, geometries: 2, materials: 3, lights: 1, savedPatches: this.ledger.patches.length };
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    globalThis.window?.removeEventListener?.('keydown', this.keyDown); globalThis.window?.removeEventListener?.('keyup', this.keyUp); globalThis.window?.removeEventListener?.('blur', this.blur);
    this.audio?.marshFire?.(0, 0); this.clearPrompt();
    this.scars.removeFromParent(); this.outer.removeFromParent(); this.core.removeFromParent(); this.light.removeFromParent();
    this.geometry.dispose(); this.scarGeometry.dispose(); this.outerMaterial.dispose(); this.coreMaterial.dispose(); this.scarMaterial.dispose();
  }
}
