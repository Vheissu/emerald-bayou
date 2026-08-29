import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { HOME_X, HOME_Z, WORLD_HALF } from './heightfield.js';
import { regionAt } from './regions.js';

const MPH = 2.23694;
const CELL = 360;
const STREAM_RADIUS = 1720;
const CELL_RADIUS = Math.ceil(STREAM_RADIUS / CELL);
const MAX_AIDS = 36;
const MAX_DAMAGE = 12;
const MAX_REPORTS = 16;
const MAX_MARKER_NUMBER = 998;
const VALID_STATES = new Set(['normal', 'dim', 'dark', 'off-station', 'damaged']);
const SEVERE_WEATHER = new Set(['squall', 'thunderstorm', 'hail', 'tropical', 'hurricane']);
const SIDE_COLOR = { red: 0xd53a2f, green: 0x188653 };
const REGION_DENSITY = {
  emerald: 0.82, broad: 0.76, mangrove: 0.63, cypress: 0.54, blackwater: 0.48,
  rookery: 0.42, sawgrass: 0.38, prairie: 0.34, 'dead-river': 0.31,
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const hashText = value => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export const NAVIGATION_AID_LIMITS = Object.freeze({ cell: CELL, streamRadius: STREAM_RADIUS, active: MAX_AIDS, damage: MAX_DAMAGE, reports: MAX_REPORTS, drawCalls: 6 });

function boundedRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').slice(0, 64), state = VALID_STATES.has(raw.state) ? raw.state : '';
  if (!id || !state) return null;
  return {
    id, state, source: String(raw.source || 'weather').slice(0, 24),
    dx: clamp(finite(raw.dx), -18, 18), dz: clamp(finite(raw.dz), -18, 18), tilt: clamp(finite(raw.tilt), -0.8, 0.8),
    at: Math.max(0, finite(raw.at)), day: Math.max(1, Math.trunc(finite(raw.day, 1))),
    reported: Boolean(raw.reported), repairAt: Math.max(0, finite(raw.repairAt)), resolvedAt: Math.max(0, finite(raw.resolvedAt)),
  };
}

function boundedReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').slice(0, 64); if (!id) return null;
  return {
    id, number: clamp(Math.trunc(finite(raw.number, 1)), 1, MAX_MARKER_NUMBER), side: raw.side === 'red' ? 'red' : 'green',
    state: VALID_STATES.has(raw.state) ? raw.state : 'dark', x: clamp(finite(raw.x), -WORLD_HALF, WORLD_HALF), z: clamp(finite(raw.z), -WORLD_HALF, WORLD_HALF),
    region: String(raw.region || '').slice(0, 32), day: Math.max(1, Math.trunc(finite(raw.day, 1))), hour: clamp(finite(raw.hour), 0, 24),
  };
}

function uniqueLatest(list, limit) {
  const seen = new Set(), out = [];
  for (let index = list.length - 1; index >= 0 && out.length < limit; index--) {
    const entry = list[index]; if (!entry || seen.has(entry.id)) continue; seen.add(entry.id); out.push(entry);
  }
  return out.reverse();
}

export function ensureNavigationAidSave(save) {
  const source = save.navigationAids && typeof save.navigationAids === 'object' ? save.navigationAids : {};
  const damage = uniqueLatest((Array.isArray(source.damage) ? source.damage : []).map(boundedRecord).filter(Boolean), MAX_DAMAGE);
  const reports = uniqueLatest((Array.isArray(source.reports) ? source.reports : []).map(boundedReport).filter(Boolean), MAX_REPORTS);
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {};
  save.navigationAids = {
    version: 1, damage, reports,
    stats: {
      strikes: Math.max(0, Math.trunc(finite(stats.strikes))), reports: Math.max(0, Math.trunc(finite(stats.reports))),
      weatherFailures: Math.max(0, Math.trunc(finite(stats.weatherFailures))), repairs: Math.max(0, Math.trunc(finite(stats.repairs))),
    },
  };
  return save.navigationAids;
}

function stableAxis(computeBase, x, z) {
  let bestScore = -Infinity, bestX = 0, bestZ = 1;
  for (let axis = 0; axis < 8; axis++) {
    const angle = axis * Math.PI / 8, dx = Math.cos(angle), dz = Math.sin(angle);
    const h1 = computeBase(x + dx * 28, z + dz * 28).h, h2 = computeBase(x - dx * 28, z - dz * 28).h;
    const d1 = Math.max(0, -h1), d2 = Math.max(0, -h2), score = Math.min(d1, d2) * 1.35 + (d1 + d2) * 0.12;
    if (score > bestScore) { bestScore = score; bestX = dx; bestZ = dz; }
  }
  if (bestZ < -0.15 || (Math.abs(bestZ) <= 0.15 && bestX < 0)) { bestX = -bestX; bestZ = -bestZ; }
  return bestScore >= 2.35 ? { x: bestX, z: bestZ, score: bestScore } : null;
}

function baselineFault(region, roll) {
  if (region === 'dead-river') return roll < 0.18 ? 'dark' : roll < 0.26 ? 'off-station' : 'normal';
  if (region === 'mangrove') return roll < 0.055 ? 'off-station' : roll < 0.09 ? 'dim' : 'normal';
  if (region === 'blackwater' || region === 'cypress') return roll < 0.035 ? 'dim' : 'normal';
  return roll < 0.012 ? 'dim' : 'normal';
}

// Pure, seeded placement. The same cell always produces the same aid, and no render or save object is retained here.
export function navigationAidsForCell(ci, cj, { computeBase, blockedAt = () => false, regionAtFn = regionAt, seed = 7 } = {}) {
  if (typeof computeBase !== 'function') return [];
  const centerX = (ci + 0.5) * CELL, centerZ = (cj + 0.5) * CELL;
  if (Math.max(Math.abs(centerX), Math.abs(centerZ)) >= WORLD_HALF - 520) return [];
  const cellRegion = regionAtFn(centerX, centerZ), cellHash = (hash2(ci + 2311, cj + 7919) ^ (seed >>> 0)) >>> 0, random = mulberry32(cellHash);
  if (random() > (REGION_DENSITY[cellRegion?.id] ?? 0.42)) return [];

  for (let attempt = 0; attempt < 9; attempt++) {
    const x = (ci + 0.18 + random() * 0.64) * CELL, z = (cj + 0.18 + random() * 0.64) * CELL;
    if (Math.hypot(x - HOME_X, z - HOME_Z) < 220) continue;
    const center = computeBase(x, z, true);
    if (!center || center.s < 0.66 || center.lake > 0.58 || center.h > -1.25 || center.h < -6.8) continue;
    const axis = stableAxis(computeBase, x, z); if (!axis) continue;
    const side = ((cellHash >>> 9) & 1) ? 'red' : 'green', sign = side === 'red' ? 1 : -1;
    const normalX = -axis.z * sign, normalZ = axis.x * sign, targetDepth = 1.35 + random() * 1.25;
    let marker = null, markerScore = Infinity;
    for (let offset = 7; offset <= 34; offset += 3) {
      const px = x + normalX * offset, pz = z + normalZ * offset, sample = computeBase(px, pz, true);
      if (!sample || sample.s < 0.25 || sample.lake > 0.72 || sample.h > -0.68 || sample.h < -4.8) continue;
      const score = Math.abs(-sample.h - targetDepth) + Math.abs(offset - 20) * 0.012;
      if (score < markerScore) { markerScore = score; marker = { x: px, z: pz, h: sample.h }; }
    }
    if (!marker || blockedAt(marker.x, marker.z)) continue;
    const station = Math.round((marker.x * axis.x + marker.z * axis.z) / CELL), branch = Math.round((-marker.x * axis.z + marker.z * axis.x) / CELL);
    const regionOffset = hashText(cellRegion?.id || 'emerald') % 499, channelIndex = station + branch * 53 + regionOffset;
    const ordinal = 1 + ((channelIndex % 499) + 499) % 499, number = side === 'red' ? ordinal * 2 : ordinal * 2 - 1;
    const period = side === 'red' ? 4 : 2.5, fault = baselineFault(cellRegion?.id || '', random());
    const driftAngle = random() * Math.PI * 2, drift = fault === 'off-station' ? 4 + random() * 5 : 0;
    return [{
      id: `nav-${ci}-${cj}`, ci, cj, x: marker.x, z: marker.z, ground: marker.h, heading: Math.atan2(axis.x, axis.z),
      side, number, period, phase: random() * period, region: cellRegion?.id || 'emerald', baselineState: fault,
      baselineDx: Math.cos(driftAngle) * drift, baselineDz: Math.sin(driftAngle) * drift, baselineTilt: fault === 'off-station' ? (random() - 0.5) * 0.24 : 0,
    }];
  }
  return [];
}

export function navigationAidFlash(time, period, phase = 0, state = 'normal') {
  if (state === 'dark' || state === 'damaged') return 0;
  const cycle = ((finite(time) + finite(phase)) % Math.max(0.5, finite(period, 4)) + Math.max(0.5, finite(period, 4))) % Math.max(0.5, finite(period, 4));
  const pulse = cycle < 0.14 ? Math.sin(cycle / 0.14 * Math.PI) : 0;
  return pulse * (state === 'dim' ? 0.42 : state === 'off-station' ? 0.72 : 1);
}

export function stormFailureDecision(weather, seed, count) {
  const probabilities = { squall: 0.16, thunderstorm: 0.38, hail: 0.46, tropical: 0.78, hurricane: 1 };
  if (!Number.isFinite(count) || count <= 0 || !probabilities[weather]) return null;
  const random = mulberry32((seed >>> 0) ^ hashText(weather)); if (random() > probabilities[weather]) return null;
  let state = 'dim';
  if (weather === 'thunderstorm' || weather === 'hail') state = random() < 0.72 ? 'dark' : 'dim';
  else if (weather === 'tropical') state = random() < 0.72 ? 'off-station' : 'dark';
  else if (weather === 'hurricane') state = random() < 0.66 ? 'damaged' : 'off-station';
  const angle = random() * Math.PI * 2, drift = state === 'off-station' ? 4 + random() * 8 : state === 'damaged' ? 2 + random() * 5 : 0;
  return { index: Math.floor(random() * count) % count, state, dx: Math.cos(angle) * drift, dz: Math.sin(angle) * drift, tilt: state === 'damaged' ? 0.38 + random() * 0.28 : state === 'off-station' ? (random() - 0.5) * 0.28 : 0 };
}

function frameGeometry() {
  const pole = new THREE.CylinderGeometry(0.035, 0.052, 2.3, 7); pole.translate(0, 1.3, 0);
  const collar = new THREE.TorusGeometry(0.16, 0.025, 6, 12); collar.rotateX(Math.PI / 2); collar.translate(0, 2.38, 0);
  const panel = new THREE.BoxGeometry(0.58, 0.055, 0.32); panel.rotateX(-0.31); panel.translate(0, 2.08, 0);
  const geometry = mergeGeometries([pole, collar, panel], false); geometry.computeBoundingSphere(); return geometry;
}

function translated(geometry, y) { geometry.translate(0, y, 0); geometry.computeBoundingSphere(); return geometry; }

function statusText(state) {
  if (state === 'dim') return 'light dim';
  if (state === 'dark') return 'unlit';
  if (state === 'off-station') return 'off station';
  if (state === 'damaged') return 'down';
  return 'on station';
}

export class NavigationAids {
  constructor(options) {
    Object.assign(this, options); // scene, terrain, world, water, phys, game, audio, environment, currents, regions, radio, law, reputation, condition
    this.store = ensureNavigationAidSave(this.game.save);
    this.root = new THREE.Group(); this.root.name = 'streamed navigation aids'; this.scene.add(this.root);
    this.meshes = this.makeMeshes(); this.aids = Array.from({ length: MAX_AIDS }, (_, index) => this.makeSlot(index));
    this.candidates = []; this.obs = []; this.phys.addObs('navigation-aids', this.obs);
    this._dummy = new THREE.Object3D(); this._lantern = new THREE.Object3D(); this._flow = new THREE.Vector2();
    this._red = new THREE.Color(SIDE_COLOR.red); this._green = new THREE.Color(SIDE_COLOR.green);
    this.active = 0; this.cellX = Infinity; this.cellZ = Infinity; this.renderT = 0; this.maintenanceT = 2; this.enabled = false; this.interact = false; this.prompting = false; this.nearFault = null; this.boundsDirty = true;
    this.lastWeather = this.environment.key; this.refreshes = 0; this.weatherEvents = 0;
    this.keyHandler = event => { if (!event.repeat && event.code === 'KeyE' && this.enabled && this.prompting) this.interact = true; };
    window.addEventListener('keydown', this.keyHandler);
    this.game.navigationAids = this; this.radio.navigationAids = this;
    this.refresh(true); this.renderInstances(0);
  }

  makeMeshes() {
    const geometries = {
      body: translated(new THREE.CylinderGeometry(0.47, 0.58, 0.48, 12), 0.05),
      stripe: translated(new THREE.CylinderGeometry(0.49, 0.54, 0.15, 12), 0.08),
      frame: frameGeometry(),
      red: translated(new THREE.CircleGeometry(0.48, 3).rotateZ(Math.PI / 2), 1.72),
      green: translated(new THREE.PlaneGeometry(0.72, 0.72), 1.72),
      lantern: new THREE.SphereGeometry(0.085, 8, 6),
    };
    const materials = {
      body: new THREE.MeshStandardMaterial({ color: 0xdedccf, roughness: 0.76, metalness: 0.04 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.64, metalness: 0.05 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x59645f, roughness: 0.46, metalness: 0.72 }),
      red: new THREE.MeshStandardMaterial({ color: SIDE_COLOR.red, roughness: 0.68, side: THREE.DoubleSide }),
      green: new THREE.MeshStandardMaterial({ color: SIDE_COLOR.green, roughness: 0.68, side: THREE.DoubleSide }),
      lantern: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    };
    const meshes = [];
    for (const key of ['body', 'stripe', 'frame', 'red', 'green', 'lantern']) {
      const mesh = new THREE.InstancedMesh(geometries[key], materials[key], MAX_AIDS); mesh.name = `navigation aid ${key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = key !== 'lantern';
      this.root.add(mesh); meshes.push(mesh);
    }
    return { list: meshes, body: meshes[0], stripe: meshes[1], frame: meshes[2], red: meshes[3], green: meshes[4], lantern: meshes[5], geometries, materials };
  }

  makeSlot(index) {
    const slot = { index, active: false, id: '', hitCd: 0, state: 'normal', reported: false, actualX: 0, actualZ: 0 };
    slot.obstacle = { x: 0, z: 0, r: 0.58, tag: 'channel marker', aid: slot, onHit: (into, nx, nz) => this.hit(slot, into, nx, nz) };
    return slot;
  }

  capturesInput(code) { return code === 'KeyE' && this.prompting; }

  recordFor(id) { return this.store.damage.find(record => record.id === id) || null; }

  applyState(aid) {
    const record = this.recordFor(aid.id), state = record?.state || aid.baselineState || 'normal';
    aid.record = record; aid.state = state; aid.reported = Boolean(record?.reported);
    aid.actualX = aid.x + (record ? record.dx : aid.baselineDx || 0); aid.actualZ = aid.z + (record ? record.dz : aid.baselineDz || 0);
    aid.tilt = record ? record.tilt : aid.baselineTilt || 0;
    aid.obstacle.x = aid.actualX; aid.obstacle.z = aid.actualZ;
  }

  blocked(candidate) {
    if (this.world?.blockedAt(candidate.x, candidate.z)) return true;
    if (this.game.jobs?.some(job => Math.hypot(job.x - candidate.x, job.z - candidate.z) < 42)) return true;
    return false;
  }

  refresh(force = false) {
    const ci = Math.floor(this.phys.pos.x / CELL), cj = Math.floor(this.phys.pos.y / CELL);
    if (!force && ci === this.cellX && cj === this.cellZ) return false;
    this.cellX = ci; this.cellZ = cj; this.candidates.length = 0;
    const placement = { computeBase: (x, z, info) => this.terrain.hf.computeBase(x, z, info), blockedAt: (x, z) => this.world?.blockedAt(x, z), regionAtFn: regionAt, seed: this.terrain.hf.seed || 7 };
    for (let dz = -CELL_RADIUS; dz <= CELL_RADIUS; dz++) for (let dx = -CELL_RADIUS; dx <= CELL_RADIUS; dx++) {
      const list = navigationAidsForCell(ci + dx, cj + dz, placement);
      for (const candidate of list) {
        const distance = Math.hypot(candidate.x - this.phys.pos.x, candidate.z - this.phys.pos.y);
        if (distance <= STREAM_RADIUS && !this.blocked(candidate)) { candidate.distance = distance; this.candidates.push(candidate); }
      }
    }
    this.candidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    this.active = Math.min(MAX_AIDS, this.candidates.length); this.obs.length = 0;
    for (let index = 0; index < MAX_AIDS; index++) {
      const slot = this.aids[index], candidate = index < this.active ? this.candidates[index] : null;
      if (!candidate) { slot.active = false; continue; }
      Object.assign(slot, candidate); slot.active = true; this.applyState(slot);
    }
    this.refreshes++; this.renderT = 0; this.boundsDirty = true; return true;
  }

  updateObstacles() {
    this.obs.length = 0;
    for (let index = 0; index < this.active; index++) {
      const aid = this.aids[index];
      if (Math.abs(aid.actualX - this.phys.pos.x) < 96 && Math.abs(aid.actualZ - this.phys.pos.y) < 96) this.obs.push(aid.obstacle);
    }
  }

  writePose(aid, index, time) {
    const waterY = this.water.waveHeight(aid.actualX, aid.actualZ, time), flow = this.currents.flowAt(aid.actualX, aid.actualZ, this._flow);
    const currentLean = clamp(flow.length() * 0.055, 0, 0.055), waveLean = Math.sin(time * 0.72 + aid.phase) * (0.008 + this.environment.values.sea * 0.009);
    this._dummy.position.set(aid.actualX, waterY, aid.actualZ); this._dummy.rotation.set(currentLean + waveLean + aid.tilt * 0.3, aid.heading, aid.tilt + waveLean * 0.65, 'YXZ'); this._dummy.scale.set(1, 1, 1); this._dummy.updateMatrix();
    this.meshes.body.setMatrixAt(index, this._dummy.matrix); this.meshes.stripe.setMatrixAt(index, this._dummy.matrix); this.meshes.frame.setMatrixAt(index, this._dummy.matrix);
    const red = aid.side === 'red';
    this.meshes.red.setMatrixAt(index, red ? this._dummy.matrix : this.hiddenMatrix(this._dummy));
    this.meshes.green.setMatrixAt(index, red ? this.hiddenMatrix(this._dummy) : this._dummy.matrix);
    this.meshes.stripe.setColorAt(index, red ? this._red : this._green);

    const flash = navigationAidFlash(time, aid.period, aid.phase, aid.state), night = this.environment.hour < 6.2 || this.environment.hour > 19.2;
    const visibility = night || this.environment.restrictedVisibility > 0.18 || this.environment.values.storm > 0.36 ? 1 : 0.42;
    const scale = flash > 0 ? 0.72 + flash * 1.8 * visibility : 0.22;
    this._lantern.position.set(aid.actualX, waterY + 2.58, aid.actualZ); this._lantern.rotation.copy(this._dummy.rotation); this._lantern.scale.setScalar(scale); this._lantern.updateMatrix();
    this.meshes.lantern.setMatrixAt(index, this._lantern.matrix); this.meshes.lantern.setColorAt(index, red ? this._red : this._green);
  }

  hiddenMatrix(source) {
    this._lantern.position.copy(source.position); this._lantern.rotation.copy(source.rotation); this._lantern.scale.setScalar(0); this._lantern.updateMatrix(); return this._lantern.matrix;
  }

  renderInstances(time) {
    for (let index = 0; index < this.active; index++) this.writePose(this.aids[index], index, time);
    for (const mesh of this.meshes.list) {
      mesh.count = this.active; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (this.boundsDirty) { mesh.computeBoundingSphere(); if (mesh.boundingSphere) mesh.boundingSphere.radius += 4; }
    }
    this.boundsDirty = false;
  }

  addDamage(aid, state, source, dx = 0, dz = 0, tilt = 0) {
    let record = this.recordFor(aid.id);
    if (!record) { record = { id: aid.id }; this.store.damage.push(record); }
    Object.assign(record, {
      state, source, dx: clamp(dx, -18, 18), dz: clamp(dz, -18, 18), tilt: clamp(tilt, -0.8, 0.8),
      at: this.environment.minutes, day: this.environment.day, reported: false, repairAt: 0, resolvedAt: 0,
    });
    if (this.store.damage.length > MAX_DAMAGE) this.store.damage.splice(0, this.store.damage.length - MAX_DAMAGE);
    for (let index = 0; index < this.active; index++) if (this.aids[index].id === aid.id) this.applyState(this.aids[index]);
    this.renderT = 0; this.boundsDirty = true; return record;
  }

  hit(aid, into, nx, nz) {
    if (!aid.active || aid.hitCd > 0 || into < 1.8) return;
    aid.hitCd = 2.8; this.store.stats.strikes++; this.game.tricks?.bust('MARKER');
    if (into >= 4.4 && aid.state !== 'damaged') {
      this.addDamage(aid, 'damaged', 'collision', -nx * clamp(into * 0.62, 2, 7), -nz * clamp(into * 0.62, 2, 7), (nx - nz) * 0.28);
      this.law?.violation(0.42 + Math.min(0.42, into * 0.035), `marker ${aid.number} strike reported`, true);
      this.reputation?.change('fwc', -0.28, 'navigation-aid-strike', `FWC logged damage to marker ${aid.number}.`, false);
      this.radio?.transmit({ channel: 'FWC TAC', speaker: 'FWC DISPATCH', text: `Marker ${aid.number} is down after a vessel strike. Units copy the tower airboat in the cut.`, priority: 3, key: `nav-aid:strike:${aid.id}:${this.environment.day}`, cooldown: 90 });
      this.game.toast(`Marker ${aid.number} down`, 'FWC has the hull and position.', 3.2);
    } else this.game.toast(`Marker ${aid.number} struck`, 'The steel float did not move much.', 2.2);
    this.game.persist();
  }

  weatherFailure(weather, salt = 0) {
    const available = [];
    for (let index = 0; index < this.active; index++) if (this.aids[index].state === 'normal') available.push(this.aids[index]);
    const seed = (Math.floor(this.environment.minutes) * 2654435761 + this.environment.day * 40503 + salt * 7919) >>> 0;
    const failure = stormFailureDecision(weather, seed, available.length); if (!failure) return false;
    const aid = available[failure.index]; if (!aid) return false;
    this.addDamage(aid, failure.state, weather, failure.dx, failure.dz, failure.tilt); this.store.stats.weatherFailures++; this.weatherEvents++;
    const line = failure.state === 'off-station' ? 'dragged off station' : failure.state === 'damaged' ? 'knocked down' : failure.state === 'dark' ? 'lost its light' : 'is running dim';
    this.radio?.transmit({ channel: 'WX-3', speaker: 'MARINE WX-3', text: `Marker ${aid.number} ${line} in ${regionAt(aid.x, aid.z).name}. Give that side of the cut room.`, priority: weather === 'hurricane' ? 4 : 2, key: `nav-aid:weather:${aid.id}:${this.environment.day}`, cooldown: 90 });
    this.game.persist(); return true;
  }

  observeWeather() {
    const weather = this.environment.key; if (weather === this.lastWeather) return;
    this.lastWeather = weather; if (!SEVERE_WEATHER.has(weather)) return;
    this.weatherFailure(weather, 0); if (weather === 'hurricane') this.weatherFailure(weather, 1);
  }

  maintain() {
    let changed = false;
    for (const record of this.store.damage) {
      if (record.state === 'normal' || !record.repairAt || this.environment.minutes < record.repairAt) continue;
      const report = this.store.reports.find(entry => entry.id === record.id);
      // Maintenance happens outside the rendered working area. A marker never snaps upright in front of the player.
      if (report && Math.hypot(report.x - this.phys.pos.x, report.z - this.phys.pos.y) < 760) continue;
      record.state = 'normal'; record.dx = 0; record.dz = 0; record.tilt = 0; record.resolvedAt = this.environment.minutes; this.store.stats.repairs++; changed = true;
      if (report && Math.hypot(report.x - this.phys.pos.x, report.z - this.phys.pos.y) < 1800) this.radio?.transmit({ channel: 'FWC TAC', speaker: 'FWC MAINTENANCE', text: `Marker ${report.number} is back on station and showing its proper light.`, priority: 1, key: `nav-aid:repaired:${record.id}:${record.day}`, cooldown: 99999 });
    }
    if (!changed) return;
    for (let index = 0; index < this.active; index++) this.applyState(this.aids[index]);
    this.renderT = 0; this.boundsDirty = true; this.game.persist();
  }

  canPrompt() {
    if (!this.enabled || this.game.paused || this.game.state || this.phys.speed * MPH >= 5) return false;
    if (this.game.dockCamp || this.game.dockJob || this.game.atBoard || this.condition?.serviceHere) return false;
    if (this.game.story?.wantInput || this.game.story?.blocking?.() || this.game.aftermath?.interactiveNear || this.game.aftermath?.blocking?.()) return false;
    if (this.game.encounters?.active || this.game.incidents?.active || this.game.discoveries?.prompting || this.game.life?.traffic?.activeCollision?.()) return false;
    return true;
  }

  setPrompt(aid) {
    this.game.el.prompt.innerHTML = `<b>E</b> report marker ${aid.number} ${statusText(aid.state)}`; this.game.el.prompt.classList.add('on');
    this.game.el.prompt.dataset.navigationAid = aid.id; this.prompting = true; this.nearFault = aid;
  }

  clearPrompt() {
    if (this.game.el.prompt.dataset.navigationAid) this.game.el.prompt.classList.remove('on');
    delete this.game.el.prompt.dataset.navigationAid; this.prompting = false; this.nearFault = null;
  }

  report(aid) {
    let record = aid.record;
    if (!record) record = this.addDamage(aid, aid.state, 'legacy', aid.baselineDx, aid.baselineDz, aid.baselineTilt);
    if (record.reported || record.state === 'normal') return false;
    record.reported = true; record.repairAt = this.environment.minutes + 70 + ((hashText(aid.id) >>> 4) % 75);
    const report = { id: aid.id, number: aid.number, side: aid.side, state: record.state, x: Math.round(aid.actualX), z: Math.round(aid.actualZ), region: aid.region, day: this.environment.day, hour: Math.round(this.environment.hour * 10) / 10 };
    const previous = this.store.reports.findIndex(entry => entry.id === aid.id); if (previous >= 0) this.store.reports.splice(previous, 1);
    this.store.reports.push(report); if (this.store.reports.length > MAX_REPORTS) this.store.reports.shift();
    this.store.stats.reports++; this.applyState(aid); this.game.addCash(45); this.reputation?.change('fwc', 0.22, 'navigation-aid-report', `FWC copied the exact position for marker ${aid.number}.`, false);
    this.audio?.checkpoint?.(); this.game.toast(`Marker ${aid.number} reported`, 'Exact position copied · +$45', 3.4);
    this.radio?.transmit({ channel: 'FWC TAC', speaker: 'FWC DISPATCH', text: `Tower Boat, marker ${aid.number} ${statusText(record.state)} copied in ${regionAt(aid.x, aid.z).name}. Maintenance will work it on the next safe tide.`, priority: 2, key: `nav-aid:reported:${aid.id}:${this.environment.day}`, cooldown: 99999 });
    this.clearPrompt(); this.game.persist(); return true;
  }

  handlePrompt() {
    if (!this.canPrompt()) { this.interact = false; this.clearPrompt(); return; }
    let nearest = null, best = 11;
    for (let index = 0; index < this.active; index++) {
      const aid = this.aids[index]; if (aid.state === 'normal' || aid.reported) continue;
      const distance = Math.hypot(aid.actualX - this.phys.pos.x, aid.actualZ - this.phys.pos.y);
      if (distance < best) { best = distance; nearest = aid; }
    }
    if (!nearest) { this.interact = false; this.clearPrompt(); return; }
    this.setPrompt(nearest); if (this.interact) this.report(nearest); this.interact = false;
  }

  pushMapMarkers() {
    for (let index = 0; index < this.active; index++) {
      const aid = this.aids[index]; if (aid.state === 'normal') continue;
      const distance = Math.hypot(aid.actualX - this.phys.pos.x, aid.actualZ - this.phys.pos.y);
      if (distance < 420) this.game.mapMarkers.push({ x: aid.actualX, z: aid.actualZ, kind: 'hazard', color: aid.side === 'red' ? '#d84a3d' : '#49b878' });
    }
  }

  markers() {
    const out = [];
    for (const report of this.store.reports) {
      const record = this.recordFor(report.id); if (!record || record.state === 'normal') continue;
      out.push({ x: report.x, z: report.z, label: `marker ${report.number} · ${statusText(record.state)}`, color: report.side === 'red' ? '#d84a3d' : '#49b878' });
    }
    return out;
  }

  radioPool() {
    let nearest = null, best = 1200;
    for (let index = 0; index < this.active; index++) {
      const aid = this.aids[index]; if (aid.state === 'normal') continue;
      const distance = Math.hypot(aid.actualX - this.phys.pos.x, aid.actualZ - this.phys.pos.y); if (distance < best) { best = distance; nearest = aid; }
    }
    if (!nearest) return [];
    const place = regionAt(nearest.x, nearest.z).name, condition = statusText(nearest.state);
    return [['CH 16', nearest.reported ? 'FWC MAINTENANCE' : 'LOCAL SKIFF', nearest.reported ? `Marker ${nearest.number} is logged ${condition} in ${place}. Work boat will reach it when the weather opens.` : `Marker ${nearest.number} is ${condition} in ${place}. Stay off that side of the cut.`]];
  }

  update(dt, time, enabled = true) {
    this.enabled = enabled; this.root.visible = true;
    for (let index = 0; index < this.active; index++) this.aids[index].hitCd = Math.max(0, this.aids[index].hitCd - dt);
    if (enabled) { this.refresh(false); this.observeWeather(); }
    this.updateObstacles();
    this.maintenanceT -= dt; if (this.maintenanceT <= 0) { this.maintenanceT = 4; this.maintain(); }
    this.renderT -= dt; if (this.renderT <= 0) { this.renderT = enabled ? 0.075 : 0.25; this.renderInstances(time); }
    if (enabled) { this.handlePrompt(); this.pushMapMarkers(); } else { this.interact = false; this.clearPrompt(); }
  }

  resourceStats() {
    return { active: this.active, max: MAX_AIDS, obstacles: this.obs.length, drawCalls: this.meshes.list.length, geometries: Object.keys(this.meshes.geometries).length, materials: Object.keys(this.meshes.materials).length, damageRecords: this.store.damage.length, reports: this.store.reports.length, refreshes: this.refreshes, weatherEvents: this.weatherEvents };
  }
}
