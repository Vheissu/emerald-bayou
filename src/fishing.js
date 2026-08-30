import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { regionAt } from './regions.js';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / Math.max(1e-6, high - low));
  return t * t * (3 - 2 * t);
};
const hourDistance = (hour, target) => {
  const distance = Math.abs((((Number(hour) || 0) % 24) + 24) % 24 - target);
  return Math.min(distance, 24 - distance);
};
const whole = (value, high = 999999) => Math.max(0, Math.min(high, Math.floor(Number(value) || 0)));

export const FISHING_LIMITS = Object.freeze({ recent: 12, linePoints: 20, maxCount: 999999 });

export const FISH_SPECIES = Object.freeze([
  Object.freeze({ id: 'florida-bass', name: 'Florida bass', color: 0x6e7a42, belly: 0xd8d4a3, minIn: 11, maxIn: 27, power: 0.52, jump: 0.38, depth: [0.75, 4.8] }),
  Object.freeze({ id: 'bluegill', name: 'Bluegill', color: 0x557d72, belly: 0xd79b55, minIn: 5, maxIn: 11.5, power: 0.25, jump: 0.05, depth: [0.55, 3.3] }),
  Object.freeze({ id: 'bowfin', name: 'Bowfin', color: 0x59634a, belly: 0xb8a67c, minIn: 16, maxIn: 31, power: 0.74, jump: 0.16, depth: [0.65, 3.8] }),
  Object.freeze({ id: 'common-snook', name: 'Common snook', color: 0xa7aaa1, belly: 0xe4ded0, minIn: 18, maxIn: 44, power: 0.86, jump: 0.72, depth: [1.05, 6.4] }),
  Object.freeze({ id: 'juvenile-tarpon', name: 'Juvenile tarpon', color: 0xaab8bb, belly: 0xe3e9e5, minIn: 20, maxIn: 42, power: 1, jump: 0.92, depth: [1.25, 7.2] }),
  Object.freeze({ id: 'red-drum', name: 'Red drum', color: 0xa96c44, belly: 0xe0c7a4, minIn: 16, maxIn: 35, power: 0.8, jump: 0.22, depth: [0.85, 5.5] }),
]);

const SPECIES_BY_ID = new Map(FISH_SPECIES.map(species => [species.id, species]));
const REGION_WEIGHTS = Object.freeze({
  blackwater: { 'florida-bass': 2.5, bluegill: 1.7, bowfin: 2.9 },
  sawgrass: { 'florida-bass': 2.4, bluegill: 2.8, bowfin: 0.65 },
  mangrove: { 'common-snook': 3.2, 'juvenile-tarpon': 1.25, 'red-drum': 2.2 },
  cypress: { 'florida-bass': 2.9, bluegill: 1.5, bowfin: 2.15 },
  emerald: { 'florida-bass': 2.6, bluegill: 2.1, bowfin: 1.2, 'common-snook': 0.24 },
  broad: { 'common-snook': 2.65, 'juvenile-tarpon': 1.9, 'red-drum': 3.05 },
  rookery: { 'florida-bass': 2.45, bluegill: 2.35, bowfin: 0.8 },
  prairie: { 'florida-bass': 2.1, bluegill: 2.6, bowfin: 1.1 },
  'dead-river': { 'florida-bass': 1.8, bluegill: 0.75, bowfin: 3.4 },
});

export function fishingBitePotential(input = {}) {
  const depth = Math.max(0, Number(input.depth) || 0), speed = Math.max(0, Number(input.boatSpeed) || 0);
  const storm = clamp(input.storm), rain = clamp(input.rain), wind = Math.max(0, Number(input.wind) || 0);
  if (depth < 0.52 || depth > 8.5 || speed > 1.45 || storm > 0.86 || wind > 23) return 0;
  const hour = (((Number(input.hour) || 0) % 24) + 24) % 24;
  const twilight = Math.max(Math.exp(-Math.pow(hourDistance(hour, 6.55) / 1.55, 2)), Math.exp(-Math.pow(hourDistance(hour, 19.25) / 1.65, 2)));
  const daylight = smooth(5.55, 6.55, hour) * (1 - smooth(19.1, 20.1, hour));
  const time = daylight ? 0.62 + twilight * 0.38 : 0.55 + twilight * 0.34;
  const tideMotion = smooth(0.018, 0.25, Math.abs(Number(input.tideRate) || 0));
  const estuary = input.regionId === 'mangrove' || input.regionId === 'broad';
  const movingWater = estuary ? 0.6 + tideMotion * 0.4 : 0.78 + tideMotion * 0.22;
  const current = 0.84 + smooth(0.025, 0.42, Number(input.currentSpeed) || 0) * (estuary ? 0.16 : 0.08);
  const depthWindow = smooth(0.52, 0.95, depth) * (1 - smooth(estuary ? 6.2 : 4.8, estuary ? 8.5 : 6.8, depth));
  const quiet = 1 - smooth(0.22, 1.45, speed);
  const settled = 0.46 + smooth(0, 7.5, Number(input.settleSeconds) || 0) * 0.54;
  const weather = (1 - smooth(8, 23, wind) * 0.72) * (1 - smooth(0.45, 1, rain) * 0.34) * (1 - smooth(0.34, 0.86, storm) * 0.94);
  const food = clamp((Number(input.fishActivity) || 1) / 1.22, 0.35, 1.15);
  return clamp(depthWindow * quiet * settled * weather * time * movingWater * current * food);
}

export function fishingSpeciesWeights(input = {}) {
  const base = REGION_WEIGHTS[input.regionId] || REGION_WEIGHTS.emerald, depth = Math.max(0, Number(input.depth) || 0), murk = clamp(input.murk);
  const moving = smooth(0.02, 0.24, Math.abs(Number(input.tideRate) || 0)), hour = (((Number(input.hour) || 0) % 24) + 24) % 24;
  const twilight = Math.max(Math.exp(-Math.pow(hourDistance(hour, 6.55) / 1.7, 2)), Math.exp(-Math.pow(hourDistance(hour, 19.25) / 1.8, 2)));
  const weights = {};
  for (const species of FISH_SPECIES) {
    let weight = Number(base[species.id]) || 0;
    const [minimum, maximum] = species.depth;
    if (depth < minimum || depth > maximum) weight = 0;
    else weight *= smooth(minimum, minimum + 0.35, depth) * (1 - smooth(maximum - 0.75, maximum, depth));
    if (species.id === 'bowfin') weight *= 0.72 + murk * 0.85;
    if (species.id === 'bluegill') weight *= 1.15 - smooth(2.1, 3.3, depth) * 0.38;
    if (species.id === 'common-snook') weight *= 0.78 + moving * 0.55 + twilight * 0.12;
    if (species.id === 'juvenile-tarpon') weight *= 0.68 + moving * 0.42 + twilight * 0.42;
    if (species.id === 'red-drum') weight *= 0.82 + moving * 0.32;
    weights[species.id] = Math.max(0, weight);
  }
  return weights;
}

export function selectFishingSpecies(input = {}, random = Math.random) {
  const weights = fishingSpeciesWeights(input); let total = 0;
  for (const species of FISH_SPECIES) total += weights[species.id] || 0;
  if (total <= 0) return SPECIES_BY_ID.get(input.regionId === 'mangrove' || input.regionId === 'broad' ? 'red-drum' : 'florida-bass');
  let roll = clamp(random(), 0, 0.999999) * total;
  for (const species of FISH_SPECIES) {
    roll -= weights[species.id] || 0;
    if (roll <= 0) return species;
  }
  return FISH_SPECIES[0];
}

export function fishingCatchLength(speciesOrId, potential = 0.5, random = Math.random) {
  const species = typeof speciesOrId === 'string' ? SPECIES_BY_ID.get(speciesOrId) : speciesOrId;
  if (!species) return 0;
  const rarity = Math.pow(clamp(random(), 0, 0.999999), 2.35), habitat = clamp((potential - 0.18) / 0.72);
  const quality = clamp(rarity * 0.86 + habitat * 0.14);
  return Math.round((species.minIn + (species.maxIn - species.minIn) * quality) * 10) / 10;
}

export function fishingFightStep(state, input = {}, random = Math.random) {
  const dt = clamp(input.dt, 0, 0.08), reeling = Boolean(input.reeling), power = clamp(input.power, 0.12, 1.2);
  state.startedRun = false;
  if (state.runT > 0) state.runT = Math.max(0, state.runT - dt);
  else {
    state.restT = Math.max(0, (Number(state.restT) || 0) - dt);
    if (state.restT <= 0) {
      state.runT = 0.42 + clamp(random()) * 0.7;
      state.restT = 1.05 + clamp(random()) * 2.15;
      state.runStrength = 0.76 + clamp(random()) * 0.34;
      state.startedRun = true;
    }
  }
  const running = state.runT > 0, stamina = clamp(state.stamina);
  const pull = power * (running ? (Number(state.runStrength) || 1) : 0.42) * (0.48 + stamina * 0.52);
  const tensionTarget = clamp(0.16 + pull * 0.65 + (reeling ? 0.36 : -0.08), 0.015, 1.18);
  state.tension = clamp((Number(state.tension) || 0) + (tensionTarget - (Number(state.tension) || 0)) * (1 - Math.exp(-dt * (reeling ? 5.2 : 3.2))), 0, 1.2);
  const retrieve = reeling ? Math.max(0.34, 1.72 - pull * 0.68) : 0;
  state.distance = clamp((Number(state.distance) || 0) + (pull * (running ? 1.22 : 0.58) - retrieve) * dt, 0, Number(state.lineLimit) || 42);
  if (state.tension > 0.23 && state.tension < 0.9) {
    const work = 0.027 + state.tension * 0.052 + (reeling ? 0.026 : 0);
    state.stamina = clamp(stamina - dt * work / (0.74 + power * 0.72));
  } else state.stamina = clamp(stamina + dt * 0.012);
  state.strain = clamp((Number(state.strain) || 0) + dt * (state.tension > 0.94 ? 1.25 + (state.tension - 0.94) * 5 : -1.75));
  state.slack = clamp((Number(state.slack) || 0) + dt * (state.tension < 0.085 ? 1 : -1.5));
  if (state.strain >= 0.62) return 'snapped';
  if (state.slack >= 1 || state.distance >= (Number(state.lineLimit) || 42) - 0.05) return 'lost';
  if (state.distance <= 2.7 && state.stamina <= 0.17) return 'landed';
  return '';
}

export function ensureFishingSave(save) {
  const raw = save?.fishing && typeof save.fishing === 'object' ? save.fishing : {}, rawSpecies = raw.species && typeof raw.species === 'object' ? raw.species : {};
  const species = {}; let speciesTotal = 0;
  for (const definition of FISH_SPECIES) {
    const record = rawSpecies[definition.id] && typeof rawSpecies[definition.id] === 'object' ? rawSpecies[definition.id] : {};
    const caught = whole(record.caught, FISHING_LIMITS.maxCount), bestIn = clamp(record.bestIn, 0, definition.maxIn + 2);
    species[definition.id] = { caught, bestIn: Math.round(bestIn * 10) / 10 }; speciesTotal += caught;
  }
  const recent = [];
  for (const record of Array.isArray(raw.recent) ? raw.recent : []) {
    const definition = SPECIES_BY_ID.get(record?.species); if (!definition) continue;
    recent.push({
      species: definition.id,
      lengthIn: Math.round(clamp(record.lengthIn, definition.minIn * 0.5, definition.maxIn + 2) * 10) / 10,
      region: typeof record.region === 'string' ? record.region.slice(0, 32) : '',
      day: whole(record.day, 99999), hour: Math.round(clamp(record.hour, 0, 24) * 100) / 100,
    });
    if (recent.length >= FISHING_LIMITS.recent) break;
  }
  const journal = {
    total: Math.max(speciesTotal, whole(raw.total, FISHING_LIMITS.maxCount)), released: whole(raw.released, FISHING_LIMITS.maxCount),
    missed: whole(raw.missed, FISHING_LIMITS.maxCount), snapped: whole(raw.snapped, FISHING_LIMITS.maxCount), gatorLosses: whole(raw.gatorLosses, FISHING_LIMITS.maxCount), species, recent,
  };
  if (save && typeof save === 'object') save.fishing = journal;
  return journal;
}

function mergedFishGeometry() {
  const originals = [];
  const body = new THREE.SphereGeometry(0.5, 14, 9); body.scale(0.34, 0.42, 1); originals.push(body);
  const tail = new THREE.ConeGeometry(0.38, 0.48, 3); tail.rotateX(Math.PI / 2); tail.translate(0, 0, 0.74); originals.push(tail);
  const dorsal = new THREE.ConeGeometry(0.18, 0.34, 3); dorsal.scale(0.5, 1, 0.62); dorsal.rotateX(-0.18); dorsal.translate(0, 0.33, -0.05); originals.push(dorsal);
  const parts = originals.map(geometry => geometry.toNonIndexed()), merged = mergeGeometries(parts, false);
  for (const geometry of originals) geometry.dispose(); for (const geometry of parts) geometry.dispose();
  merged.computeVertexNormals(); return merged;
}

function mergedRodGeometry() {
  const originals = [];
  const blank = new THREE.CylinderGeometry(0.016, 0.033, 2.45, 7); blank.translate(0, 1.225, 0); originals.push(blank);
  const grip = new THREE.CylinderGeometry(0.052, 0.044, 0.42, 8); grip.translate(0, 0.21, 0); originals.push(grip);
  const parts = originals.map(geometry => geometry.toNonIndexed()), merged = mergeGeometries(parts, false);
  for (const geometry of originals) geometry.dispose(); for (const geometry of parts) geometry.dispose();
  merged.computeVertexNormals(); return merged;
}

function geometryBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength || 0;
  for (const attribute of Object.values(geometry.attributes || {})) bytes += attribute.array?.byteLength || 0;
  return bytes;
}

export class Fishing {
  constructor(options) {
    Object.assign(this, options); // scene, boat, terrain, world, water, phys, game, audio, environment, currents, regions, life, gators
    this.regionAtFn = options.regionAtFn || regionAt; this.random = options.random || Math.random;
    this.store = ensureFishingSave(this.game.save); this.state = 'idle'; this.dirty = false; this.reeling = false; this.releaseSplash = false; this.quietWaterT = 0;
    this.session = {
      t: 0, x: 0, z: 0, startX: 0, startZ: 0, waitT: 0, biteT: 0, potential: 0, species: null, lengthIn: 0,
      distance: 0, lineLimit: 42, stamina: 1, tension: 0.35, strain: 0, slack: 0, runT: 0, restT: 1, runStrength: 1,
      startedRun: false, runAngle: 0, turnDirection: 1, jumpT: 0, jumpDuration: 0.82, jumpStartY: 0, regionId: '', regionName: '', isBest: false,
      alligator: null, alligatorDistance: Infinity,
    };
    this.snapshot = {}; this.fightInput = { dt: 0, reeling: false, power: 0.5 };
    this.tip = new THREE.Vector3(); this.lurePos = new THREE.Vector3(); this.sidePos = new THREE.Vector3(); this.forward = new THREE.Vector2(); this.right = new THREE.Vector2(); this.flow = new THREE.Vector2();
    this.fishQuaternion = new THREE.Quaternion(); this.localFishQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    this.makeVisuals();
    this.keyupHandler = event => { if (event.code === 'KeyC') this.reeling = false; };
    this.blurHandler = () => { this.reeling = false; };
    globalThis.window?.addEventListener?.('keyup', this.keyupHandler); globalThis.window?.addEventListener?.('blur', this.blurHandler);
  }

  makeVisuals() {
    this.rodRoot = new THREE.Group(); this.rodRoot.name = 'player fishing rod'; this.rodRoot.position.set(-0.82, 0.9, -0.46); this.rodRoot.rotation.set(-0.46, 0.05, 0.34, 'YXZ');
    this.rodMaterial = new THREE.MeshStandardMaterial({ color: 0x202522, roughness: 0.55, metalness: 0.42 });
    this.rodMesh = new THREE.Mesh(mergedRodGeometry(), this.rodMaterial); this.rodMesh.castShadow = false; this.rodRoot.add(this.rodMesh);
    this.reelMaterial = new THREE.MeshStandardMaterial({ color: 0x9b8d69, roughness: 0.34, metalness: 0.78 });
    this.reelMesh = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.034, 6, 13), this.reelMaterial); this.reelMesh.position.set(0.07, 0.42, 0); this.reelMesh.rotation.y = Math.PI / 2; this.rodRoot.add(this.reelMesh);
    this.rodTip = new THREE.Object3D(); this.rodTip.position.y = 2.45; this.rodRoot.add(this.rodTip); this.rodRoot.visible = false; this.boat.add(this.rodRoot);

    this.linePositions = new Float32Array(FISHING_LIMITS.linePoints * 3); this.lineGeometry = new THREE.BufferGeometry();
    const lineAttribute = new THREE.BufferAttribute(this.linePositions, 3); lineAttribute.setUsage(THREE.DynamicDrawUsage); this.lineGeometry.setAttribute('position', lineAttribute);
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xd8ddd3, transparent: true, opacity: 0.78, depthWrite: false });
    this.line = new THREE.Line(this.lineGeometry, this.lineMaterial); this.line.name = 'fishing line'; this.line.frustumCulled = false; this.line.visible = false; this.line.renderOrder = 44; this.scene.add(this.line);
    this.lureMaterial = new THREE.MeshStandardMaterial({ color: 0xf05f38, emissive: 0x4a0d03, emissiveIntensity: 0.35, roughness: 0.45 });
    this.lure = new THREE.Mesh(new THREE.SphereGeometry(0.065, 9, 7), this.lureMaterial); this.lure.name = 'topwater lure'; this.lure.castShadow = false; this.lure.visible = false; this.scene.add(this.lure);
    this.fishMaterial = new THREE.MeshStandardMaterial({ color: 0x7d866c, roughness: 0.4, metalness: 0.22 });
    this.catchMesh = new THREE.Mesh(mergedFishGeometry(), this.fishMaterial); this.catchMesh.name = 'landed fish'; this.catchMesh.castShadow = false; this.catchMesh.visible = false; this.scene.add(this.catchMesh);
  }

  blocking() { return this.state !== 'idle'; }

  capturesInput(event) {
    const code = typeof event === 'string' ? event : event?.code;
    if (code !== 'KeyC' && code !== 'KeyX') return false;
    event?.preventDefault?.();
    if (code === 'KeyX') { if (this.state === 'fight') this.cutLine(); else if (this.blocking()) this.cancel('Line reeled in', true); return true; }
    if (this.state === 'idle') this.start();
    else if (this.state === 'bite' && !event?.repeat) this.setHook();
    else if (this.state === 'fight') this.reeling = true;
    else if (this.state === 'landed' && !event?.repeat) this.release();
    return true;
  }

  canStart() {
    const game = this.game, phys = this.phys, weather = this.environment.values || {};
    if (!game.playing || game.paused || game.state || game.menuOpen || game.mapOpen || game.resultOpen) return { ok: false, reason: 'Finish the current work first.' };
    if (game.story?.blocking?.() || game.aftermath?.blocking?.() || game.encounters?.active || game.incidents?.active || game.discoveries?.active?.known || game.law?.pursuit || game.life?.traffic?.activeCollision?.()) return { ok: false, reason: 'This is not quiet water.' };
    if (phys.airborne || phys.wipeT > 0 || phys.wet < 0.62 || phys.landFac > 0.25) return { ok: false, reason: 'The hull needs to be floating cleanly.' };
    if (phys.speed > 0.9 || Math.abs(phys.throttle) > 0.16) return { ok: false, reason: 'Bring the hull to idle first.' };
    if ((weather.storm || 0) > 0.78 || (weather.wind || 0) * (this.environment.gust || 1) > 20 || (weather.hail || 0) > 0.35) return { ok: false, reason: 'The deck is moving too hard to cast.' };
    const target = this.findCastTarget();
    if (!target) return { ok: false, reason: 'No clear water off the bow.' };
    return { ok: true, target };
  }

  findCastTarget() {
    const phys = this.phys, attempts = [[15, -7], [18, -3], [14, 5], [21, 3], [12, -10], [24, 0]];
    phys.forward(this.forward); phys.right(this.right);
    for (const [ahead, side] of attempts) {
      const x = phys.pos.x + this.forward.x * ahead + this.right.x * side, z = phys.pos.y + this.forward.y * ahead + this.right.y * side;
      if (this.world?.blockedAt?.(x, z) || this.environment.waterLevel - this.terrain.heightAt(x, z) < 0.72) continue;
      let clear = true;
      for (let step = 0.25; step < 1; step += 0.25) {
        const sx = phys.pos.x + (x - phys.pos.x) * step, sz = phys.pos.y + (z - phys.pos.y) * step;
        if (this.world?.blockedAt?.(sx, sz) || this.environment.waterLevel - this.terrain.heightAt(sx, sz) < 0.5) { clear = false; break; }
      }
      if (clear) return { x, z };
    }
    return null;
  }

  readSnapshot(x = this.session.x, z = this.session.z) {
    const environment = this.environment, values = environment.values || {}, current = this.currents?.flowAt ? this.currents.flowAt(x, z, this.flow) : this.flow.set(0, 0);
    const region = this.regionAtFn(x, z), snapshot = this.snapshot;
    snapshot.regionId = region.id; snapshot.regionName = region.name; snapshot.depth = environment.waterLevel - this.terrain.heightAt(x, z);
    snapshot.murk = this.water.murkAt?.(x, z) || 0; snapshot.hour = environment.hour; snapshot.day = environment.day;
    snapshot.tideRate = environment.tideRate; snapshot.currentSpeed = current.length(); snapshot.wind = (values.wind || 0) * (environment.gust || 1);
    snapshot.rain = values.rain || 0; snapshot.storm = values.storm || 0; snapshot.fishActivity = region.ecology?.fish || 1; snapshot.boatSpeed = this.phys.speed; snapshot.settleSeconds = this.quietWaterT;
    snapshot.potential = fishingBitePotential(snapshot); return snapshot;
  }

  start() {
    const check = this.canStart();
    if (!check.ok) { this.game.toast('Cannot cast', check.reason, 2.1); return false; }
    const session = this.session, target = check.target, snapshot = this.readSnapshot(target.x, target.z);
    Object.assign(session, {
      t: 0, x: target.x, z: target.z, startX: target.x, startZ: target.z, waitT: 4.8 + (1 - snapshot.potential) * 12 + this.random() * 6,
      biteT: 0, potential: snapshot.potential, species: null, lengthIn: 0, distance: Math.hypot(target.x - this.phys.pos.x, target.z - this.phys.pos.y),
      lineLimit: 42, stamina: 1, tension: 0.34, strain: 0, slack: 0, runT: 0, restT: 0.85 + this.random() * 0.75, runStrength: 1,
      startedRun: false, runAngle: Math.atan2(target.z - this.phys.pos.y, target.x - this.phys.pos.x), turnDirection: this.random() < 0.5 ? -1 : 1,
      jumpT: 0, regionId: snapshot.regionId, regionName: snapshot.regionName, isBest: false, alligator: null, alligatorDistance: Infinity,
    });
    this.state = 'casting'; this.reeling = false; this.releaseSplash = false; this.rodRoot.visible = true; this.line.visible = true; this.lure.visible = true; this.catchMesh.visible = false;
    this.rodRoot.rotation.set(-0.76, 0.02, 0.34, 'YXZ'); this.updateVisuals(0, 0); return true;
  }

  setHook() {
    const session = this.session;
    if (this.state !== 'bite' || session.biteT <= 0) return false;
    this.state = 'fight'; this.reeling = true; session.t = 0; session.stamina = 1; session.tension = 0.38; session.strain = 0; session.slack = 0;
    session.distance = clamp(Math.hypot(session.x - this.phys.pos.x, session.z - this.phys.pos.y), 7, 30); session.restT = 0.72 + this.random() * 0.58;
    this.audio?.tone?.(720, 0.055, 0.09, 'square'); this.life?.fish?.splash?.(session.x, session.z, 0.65, this.phys.pos.x, this.phys.pos.y);
    this.attractAlligator(0.48 + (session.species?.power || 0.5) * 0.25); return true;
  }

  attractAlligator(splash = 0.5) {
    if (this.state !== 'fight' || !this.session.species) return null;
    const session = this.session, first = !session.alligator;
    const gator = this.gators?.attractToHookedFish?.(this, session.x, session.z, splash, this.environment.waterLevel) || null;
    if (!gator) return null;
    session.alligator = gator; session.alligatorDistance = Math.hypot(gator.pos.x - session.x, gator.pos.z - session.z);
    if (first) { this.audio?.warn?.(); this.game.toast('Alligator on the fish', 'Pull it clear, or press X to cut the line.', 3.2); }
    return gator;
  }

  trackAlligatorThreat(gator, distance) {
    if (this.state !== 'fight') return;
    this.session.alligator = gator; this.session.alligatorDistance = Math.max(0, Number(distance) || 0);
  }

  clearAlligatorThreat(gator) {
    if (this.session.alligator !== gator) return;
    this.session.alligator = null; this.session.alligatorDistance = Infinity;
  }

  cutLine() {
    if (this.state !== 'fight') return false;
    const threatened = Boolean(this.session.alligator); this.store.missed = whole(this.store.missed + 1); this.dirty = true;
    this.cancel('', false); this.game.toast('Line cut', threatened ? 'The fish is gone, but the gator is off the boat.' : 'The fish is gone. Cast again when the water settles.', 2.4); return true;
  }

  alligatorTake(gator) {
    if (this.state !== 'fight' || (this.session.alligator && this.session.alligator !== gator)) return false;
    const session = this.session, name = session.species?.name || 'fish', x = session.x, z = session.z;
    this.store.missed = whole(this.store.missed + 1); this.store.gatorLosses = whole(this.store.gatorLosses + 1); this.dirty = true;
    this.life?.fish?.splash?.(x, z, 1.15, this.phys.pos.x, this.phys.pos.y); this.cancel('', false);
    this.game.toast('Alligator took the fish', `${name} gone in one strike.`, 3.1); return true;
  }

  missedBite() {
    const session = this.session; this.store.missed = whole(this.store.missed + 1); this.dirty = true; session.species = null; session.biteT = 0;
    session.waitT = 6 + (1 - session.potential) * 8 + this.random() * 7; this.state = 'waiting'; this.audio?.plip?.(0.12); this.game.toast('Missed it', 'Leave the lure still. The water will settle.', 1.7);
  }

  beginBite() {
    const session = this.session, snapshot = this.readSnapshot(); session.potential = snapshot.potential;
    session.species = selectFishingSpecies(snapshot, this.random); session.lengthIn = fishingCatchLength(session.species, session.potential, this.random);
    session.biteT = 1.28 + this.random() * 0.28; this.state = 'bite'; this.audio?.plip?.(0.3); this.life?.fish?.splash?.(session.x, session.z, 0.42, this.phys.pos.x, this.phys.pos.y);
  }

  updateWaiting(dt) {
    const session = this.session, snapshot = this.readSnapshot(); session.potential = snapshot.potential;
    if (snapshot.storm > 0.86 || snapshot.wind > 23) { this.cancel('Weather took the line', true); return; }
    this.currents?.flowAt?.(session.x, session.z, this.flow); session.x += this.flow.x * dt * 0.72; session.z += this.flow.y * dt * 0.72;
    if (Math.hypot(session.x - this.phys.pos.x, session.z - this.phys.pos.y) > session.lineLimit) { this.cancel('Line reeled in', false); return; }
    session.waitT -= dt * (0.58 + snapshot.potential * 0.9);
    if (session.waitT <= 0) this.beginBite();
  }

  updateFight(dt) {
    const session = this.session, species = session.species; if (!species) { this.cancel('', false); return; }
    this.fightInput.dt = dt; this.fightInput.reeling = this.reeling; this.fightInput.power = species.power;
    const outcome = fishingFightStep(session, this.fightInput, this.random);
    if (session.startedRun) {
      session.turnDirection = this.random() < 0.5 ? -1 : 1; this.audio?.tone?.(155 + species.power * 70, 0.075, 0.055 + species.power * 0.035, 'square');
      if (this.random() < species.jump) { session.jumpT = session.jumpDuration; session.jumpStartY = this.water.waveHeight(session.x, session.z, session.t); this.life?.fish?.splash?.(session.x, session.z, 0.58 + species.power * 0.2, this.phys.pos.x, this.phys.pos.y); }
      this.attractAlligator(0.62 + species.power * 0.3);
    }
    session.runAngle += session.turnDirection * dt * (session.runT > 0 ? 0.42 + species.power * 0.32 : 0.08);
    session.x = this.phys.pos.x + Math.cos(session.runAngle) * session.distance; session.z = this.phys.pos.y + Math.sin(session.runAngle) * session.distance;
    if (session.jumpT > 0) {
      const before = session.jumpT; session.jumpT = Math.max(0, session.jumpT - dt);
      if (before > 0 && session.jumpT === 0) this.life?.fish?.splash?.(session.x, session.z, 0.68 + species.power * 0.2, this.phys.pos.x, this.phys.pos.y);
    }
    this.audio?.fishingReel?.(this.reeling ? 1 : 0, session.tension);
    if (outcome === 'landed') this.landCatch();
    else if (outcome === 'snapped') this.loseFish(true);
    else if (outcome === 'lost') this.loseFish(false);
  }

  landCatch() {
    const session = this.session, species = session.species, record = this.store.species[species.id];
    this.gators?.releaseHookedFish?.(this); session.alligator = null; session.alligatorDistance = Infinity;
    const previous = record.bestIn; record.caught = whole(record.caught + 1); record.bestIn = Math.max(previous, session.lengthIn); this.store.total = whole(this.store.total + 1);
    session.isBest = session.lengthIn > previous; this.store.recent.unshift({ species: species.id, lengthIn: session.lengthIn, region: session.regionName, day: whole(this.environment.day, 99999), hour: Math.round(clamp(this.environment.hour, 0, 24) * 100) / 100 });
    this.store.recent.length = Math.min(this.store.recent.length, FISHING_LIMITS.recent); this.dirty = true; this.game.persist(); this.dirty = false;
    this.state = 'landed'; this.reeling = false; this.audio?.fishingReel?.(0, 0); this.audio?.tone?.(490, 0.08, 0.075, 'triangle');
    this.game.bounties?.event?.('fishspecies', species.id);
    this.game.toast(session.isBest ? 'New boat record' : species.name, `${session.lengthIn.toFixed(1)} in total length · release it when ready`, 3.2);
  }

  loseFish(snapped) {
    if (snapped) this.store.snapped = whole(this.store.snapped + 1); else this.store.missed = whole(this.store.missed + 1);
    this.dirty = true; this.audio?.fishingReel?.(0, 0); this.audio?.warn?.(); this.cancel(snapped ? 'Line broke' : 'Hook thrown', true);
  }

  release() {
    if (this.state !== 'landed') return false;
    this.state = 'release'; this.session.t = 0; this.releaseSplash = false; this.store.released = whole(this.store.released + 1); this.dirty = true; this.game.persist(); this.dirty = false;
    this.game.bounties?.event?.('catch', 1); return true;
  }

  cancel(message = '', announce = false) {
    this.gators?.releaseHookedFish?.(this); this.session.alligator = null; this.session.alligatorDistance = Infinity;
    this.audio?.fishingReel?.(0, 0); this.state = 'idle'; this.reeling = false; this.rodRoot.visible = false; this.line.visible = false; this.lure.visible = false; this.catchMesh.visible = false;
    if (this.dirty) { this.game.persist(); this.dirty = false; }
    if (announce && message) this.game.toast(message, 'C casts again when the hull is back at idle.', 1.8);
  }

  interruption() {
    return Boolean(this.game.state || this.game.story?.blocking?.() || this.game.aftermath?.blocking?.() || this.game.encounters?.active || this.game.incidents?.active || this.game.law?.pursuit || this.game.life?.traffic?.activeCollision?.()
      || this.phys.airborne || this.phys.wipeT > 0 || this.phys.hit > 2.4 || this.phys.speed > 2.2);
  }

  update(dt, time, enabled = true) {
    if (enabled) {
      if (this.phys.speed > 1.8 || Math.abs(this.phys.throttle) > 0.28) this.quietWaterT = 0;
      else this.quietWaterT = Math.min(20, this.quietWaterT + dt);
    }
    if (!this.blocking()) return;
    if (!enabled) { this.reeling = false; this.audio?.fishingReel?.(0, 0); return; }
    if (this.interruption()) { this.cancel('Line abandoned', true); return; }
    const session = this.session; session.t += dt;
    if (this.state === 'casting' && session.t >= 0.82) { this.state = 'waiting'; session.t = 0; this.life?.fish?.splash?.(session.x, session.z, 0.22, this.phys.pos.x, this.phys.pos.y); }
    else if (this.state === 'waiting') this.updateWaiting(dt);
    else if (this.state === 'bite') { session.biteT -= dt; if (session.biteT <= 0) this.missedBite(); }
    else if (this.state === 'fight') this.updateFight(dt);
    else if (this.state === 'release') {
      if (!this.releaseSplash && session.t >= 0.48) { this.releaseSplash = true; this.life?.fish?.splash?.(this.sidePos.x, this.sidePos.z, 0.7, this.phys.pos.x, this.phys.pos.y); this.audio?.plip?.(0.24); }
      if (session.t >= 1.05) this.cancel('', false);
    }
    this.updateVisuals(dt, time);
  }

  updateVisuals(dt, time) {
    if (!this.blocking()) return;
    const session = this.session, cast = this.state === 'casting' ? smooth(0, 0.82, session.t) : 1;
    const targetX = this.phys.pos.x + (session.x - this.phys.pos.x) * cast, targetZ = this.phys.pos.y + (session.z - this.phys.pos.y) * cast;
    let targetY = this.water.waveHeight(targetX, targetZ, time) + 0.045;
    if (this.state === 'casting') targetY += Math.sin(cast * Math.PI) * 4.2;
    else if (this.state === 'bite') targetY -= 0.13 + Math.sin(session.biteT * 24) * 0.045;
    this.lurePos.set(targetX, targetY, targetZ); this.lure.position.copy(this.lurePos); this.lure.rotation.y += dt * 3;

    const fight = this.state === 'fight', bend = fight ? 0.42 + session.tension * 0.55 : this.state === 'bite' ? 0.58 : 0.22;
    const targetRodX = fight ? -0.44 - session.tension * 0.16 : this.state === 'casting' ? -0.76 + cast * 0.28 : -0.46;
    this.rodRoot.rotation.x += (targetRodX - this.rodRoot.rotation.x) * (1 - Math.exp(-dt * 9));
    this.rodRoot.rotation.z += ((fight ? 0.23 + Math.sin(time * 9) * session.tension * 0.035 : 0.34) - this.rodRoot.rotation.z) * (1 - Math.exp(-dt * 7));
    this.rodTip.getWorldPosition(this.tip); this.setLine(this.tip, this.lurePos, bend);

    this.catchMesh.visible = false;
    if (fight && session.jumpT > 0) {
      const progress = 1 - session.jumpT / session.jumpDuration, arc = Math.sin(progress * Math.PI);
      this.catchMesh.visible = true; this.catchMesh.position.set(session.x, this.water.waveHeight(session.x, session.z, time) + arc * (0.8 + session.species.power * 0.75), session.z);
      this.catchMesh.rotation.set(-0.25 + Math.sin(progress * Math.PI * 2) * 0.55, -session.runAngle + Math.PI / 2, session.turnDirection * arc * 0.35, 'YXZ'); this.setFishScaleAndColor();
      this.lurePos.copy(this.catchMesh.position); this.lurePos.y += 0.04; this.lure.position.copy(this.lurePos); this.setLine(this.tip, this.lurePos, 0.08);
    } else if (this.state === 'landed' || this.state === 'release') {
      this.sidePos.set(-1.62, this.state === 'release' ? 0.58 - smooth(0, 0.82, session.t) * 0.95 : 0.82, -0.72); this.boat.localToWorld(this.sidePos);
      this.catchMesh.visible = true; this.catchMesh.position.copy(this.sidePos); this.fishQuaternion.copy(this.boat.quaternion).multiply(this.localFishQuaternion); this.catchMesh.quaternion.copy(this.fishQuaternion);
      this.catchMesh.rotateZ(Math.sin(time * 4.5) * 0.035); this.setFishScaleAndColor();
      this.lurePos.copy(this.sidePos); this.lurePos.y += 0.2; this.lure.position.copy(this.lurePos); this.setLine(this.tip, this.lurePos, 0.12);
    }
  }

  setFishScaleAndColor() {
    const species = this.session.species; if (!species) return;
    const lengthMetres = this.session.lengthIn * 0.0254, scale = lengthMetres / 1.48;
    this.catchMesh.scale.setScalar(scale); if (this.fishMaterial.color.getHex() !== species.color) this.fishMaterial.color.setHex(species.color);
  }

  setLine(start, end, sag = 0.2) {
    const positions = this.linePositions, count = FISHING_LIMITS.linePoints;
    for (let index = 0; index < count; index++) {
      const amount = index / (count - 1), offset = index * 3;
      positions[offset] = start.x + (end.x - start.x) * amount; positions[offset + 1] = start.y + (end.y - start.y) * amount - Math.sin(amount * Math.PI) * sag; positions[offset + 2] = start.z + (end.z - start.z) * amount;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
  }

  waterLabel() {
    const session = this.session, hour = this.environment.hour, tide = Math.abs(this.environment.tideRate) < 0.035 ? 'slack water' : this.environment.tideRate > 0 ? 'rising water' : 'falling water';
    const light = hour < 5.6 || hour > 20.1 ? 'night' : hour < 8 ? 'first light' : hour > 17.6 ? 'last light' : 'daylight';
    const quality = session.potential > 0.67 ? 'good water' : session.potential > 0.38 ? 'fair water' : 'slow water';
    return `${light} · ${tide} · ${quality}`;
  }

  hud() {
    if (!this.blocking()) return null;
    const session = this.session, title = `Fishing · ${session.regionName || 'open water'}`;
    if (this.state === 'casting') return { title, obj: 'Casting off the starboard bow', sub: 'Let the topwater lure settle.', timer: '', warn: false };
    if (this.state === 'waiting') return { title, obj: 'Watch the lure', sub: `${this.waterLabel()} · C sets the hook when it goes under · X reels in`, timer: '', warn: false };
    if (this.state === 'bite') return { title, obj: 'Strike now', sub: 'C · set the hook', timer: `${Math.max(0, session.biteT).toFixed(1)}<small>seconds</small>`, warn: true };
    if (this.state === 'fight') {
      const danger = session.tension > 0.86, slack = session.tension < 0.14, alligator = session.alligator && Number.isFinite(session.alligatorDistance);
      const sub = alligator ? `Alligator ${Math.max(1, Math.round(session.alligatorDistance))} m off · pull the fish clear or X cuts the line` : danger ? 'Let go of C. The line is close to breaking.' : slack ? 'Hold C and take up the slack.' : `${this.reeling ? 'Reeling' : 'Fish running'} · hold C to reel · release it during a hard run · X cuts the line`;
      return { title, obj: session.species?.name || 'Fish on', sub, timer: `${Math.round(session.tension * 100)}%<small>line tension</small>`, warn: Boolean(alligator) || danger || slack };
    }
    if (this.state === 'landed') return { title, obj: `${session.species?.name || 'Catch'} · ${session.lengthIn.toFixed(1)} in`, sub: `${session.isBest ? 'New boat record · ' : ''}measured over the gunwale · C release`, timer: `${session.lengthIn.toFixed(1)}<small>in total length</small>`, warn: false };
    return { title, obj: `Releasing ${session.species?.name || 'the catch'}`, sub: 'Head first, back into the current.', timer: '', warn: false };
  }

  menuEntries() {
    return FISH_SPECIES.map(species => ({ ...species, ...this.store.species[species.id] }));
  }

  resourceStats() {
    const roots = [this.rodRoot, this.line, this.lure, this.catchMesh], geometries = new Set(), materials = new Set(); let objects = 0, meshes = 0, visibleDraws = 0;
    for (const root of roots) root.traverse(object => {
      objects++; if (object.isMesh || object.isLine) { meshes++; if (object.visible && root.visible) visibleDraws++; }
      if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material);
    });
    let bytes = 0; for (const geometry of geometries) bytes += geometryBytes(geometry);
    return { state: this.state, predator: this.session.alligator ? 'alligator' : '', objects, meshes, geometries: geometries.size, materials: materials.size, geometryBytes: bytes, linePoints: FISHING_LIMITS.linePoints, visibleDraws };
  }

  dispose() {
    this.cancel('', false); globalThis.window?.removeEventListener?.('keyup', this.keyupHandler); globalThis.window?.removeEventListener?.('blur', this.blurHandler);
    this.boat.remove(this.rodRoot); this.scene.remove(this.line, this.lure, this.catchMesh);
    const geometries = new Set(), materials = new Set();
    for (const root of [this.rodRoot, this.line, this.lure, this.catchMesh]) root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  }
}
