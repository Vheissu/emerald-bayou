import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wreck } from './markers.js';
import { regionAt } from './regions.js';
import { WORLD_HALF } from './heightfield.js';
import { emitMapMarker } from './mapmarkers.js';
import { emitWakeStamp } from './wakestamps.js';

const MPH = 2.23694;
export const PYTHON_SEGMENT_COUNT = 18;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const FIELD_DISCOVERIES = Object.freeze([
  Object.freeze({
    id: 'roseate-roost', kind: 'roost', name: 'Roseate spoonbill roost', short: 'Roseate roost', region: 'rookery', place: 'Rookery Lakes',
    color: '#ed91ab', reward: 225, hold: 7, minDistance: 20, maxDistance: 54, maxMph: 4.8,
    hint: 'Rookery Lakes · calm water around first or last light',
    intro: 'Nine roseates are settled on the inside bank. Keep the wake off them.',
    success: 'Seven adults and two juveniles logged without flushing the roost.',
    rumor: 'Roseates dropped into the west rookery at first light. If you find the pink birds, bring the prop down before your wake gets there.',
    followup: 'Bird Crew copied nine roseates from the tower boat log. That roost had two juveniles in it, so the inside bank is closed to sampling today.',
  }),
  Object.freeze({
    id: 'tagged-sawfish', kind: 'sawfish', name: 'Tagged smalltooth sawfish', short: 'Tagged sawfish', region: 'mangrove', place: 'Mangrove Reach',
    color: '#71c9be', reward: 340, hold: 9, minDistance: 14, maxDistance: 42, maxMph: 6,
    hint: 'Mangrove Reach · a rising tide near dawn or dusk',
    intro: 'The receiver is catching an acoustic tag. Track the ping and leave room around the animal.',
    success: 'Tag, length and moving position logged without crowding the animal.',
    rumor: 'The sawfish receiver woke up in Mangrove Reach on the flood. It is a live tag, not a loose transmitter. Follow the ping at idle.',
    followup: 'The sawfish fix matched a female tagged off the Gulf three years ago. The biologists have her back on the nursery-water map.',
  }),
  Object.freeze({
    id: 'python-crossing', kind: 'python', name: 'Swimming Burmese python', short: 'Python crossing', region: 'cypress', place: 'Cypress Reach',
    color: '#c8a56c', reward: 275, hold: 7.5, minDistance: 13, maxDistance: 38, maxMph: 4.5,
    hint: 'Cypress Reach · warm, still water around dusk or dawn',
    intro: 'Long tan body on the surface. Idle wide and hold it in frame while the field camera resolves.',
    success: 'Photo, heading and position sent to FWC. No capture attempt made.',
    rumor: 'A tan-backed python crossed the Cypress Reach cut twice this week. If it swims out again, hold off the wake, get a clean photo and call the position. Keep your hands in the boat.',
    followup: 'Photo is clean. The invasives crew has the heading and a fresh search box. Keep your hands in the boat.',
  }),
  Object.freeze({
    id: 'logging-skiff', kind: 'wreck', name: 'Hammond logging skiff', short: 'Logging skiff', region: 'cypress', place: 'Cypress Reach',
    color: '#d6b16d', reward: 180,
    hint: 'Cypress Reach · falling water below the old cypress knees',
    intro: 'Low water has uncovered a timber skiff and a stamped builder plate.',
    success: 'Hammond Cypress Company hull 14 added to the chart.',
    rumor: 'Old aluminium is showing below the cypress knees. If the falling water uncovers a builder plate, copy it before the flood takes it back.',
    followup: 'That builder number belonged to Hammond hull fourteen, missing since 1962. The county archive finally has a position for it.',
  }),
]);

const DISCOVERY_BY_ID = new Map(FIELD_DISCOVERIES.map(discovery => [discovery.id, discovery]));

function hourIn(hour, start, end) {
  const h = ((Number(hour) % 24) + 24) % 24;
  return start <= end ? h >= start && h <= end : h >= start || h <= end;
}

export function fieldDiscoveryEligible(discovery, snapshot) {
  const definition = typeof discovery === 'string' ? DISCOVERY_BY_ID.get(discovery) : discovery;
  if (!definition || snapshot.region !== definition.region) return false;
  const storm = Number(snapshot.storm) || 0, rain = Number(snapshot.rain) || 0, wind = Number(snapshot.wind) || 0;
  if (definition.kind === 'roost') {
    const lightWindow = hourIn(snapshot.hour, 5.25, 8.4) || hourIn(snapshot.hour, 17.15, 20.35);
    return lightWindow && storm < 0.34 && rain < 0.42 && wind < 11.5;
  }
  if (definition.kind === 'sawfish') {
    const feedingWindow = hourIn(snapshot.hour, 4.6, 9.5) || hourIn(snapshot.hour, 16.1, 22.15);
    return feedingWindow && Number(snapshot.tideRate) > 0.025 && Number(snapshot.waterLevel) > -0.18 && storm < 0.46 && wind < 14;
  }
  if (definition.kind === 'python') {
    const crossingWindow = hourIn(snapshot.hour, 17.35, 8.15);
    return crossingWindow && storm < 0.36 && rain < 0.48 && wind < 9.5 && Number(snapshot.waterLevel) > -0.3;
  }
  return Number(snapshot.waterLevel) < -0.13 && Number(snapshot.tideRate) < -0.025 && storm < 0.56;
}

export function eligibleFieldDiscoveries(snapshot, found = [], excluded = []) {
  const done = new Set(Array.isArray(found) ? found : []), blocked = new Set(Array.isArray(excluded) ? excluded : []);
  return FIELD_DISCOVERIES.filter(discovery => !done.has(discovery.id) && !blocked.has(discovery.id) && fieldDiscoveryEligible(discovery, snapshot));
}

export function observationStep(discovery, state) {
  const definition = typeof discovery === 'string' ? DISCOVERY_BY_ID.get(discovery) : discovery;
  if (!definition || !definition.hold) return { progress: 0, qualifies: false, complete: false };
  const distance = Number(state.distance), speedMph = Number(state.speedMph), wake = Math.abs(Number(state.wake) || 0), dt = Math.max(0, Number(state.dt) || 0);
  const visible = state.visible !== false;
  const wakeSafe = definition.kind === 'roost' ? wake < 0.018 : definition.kind === 'python' ? wake < 0.024 : true;
  const qualifies = visible && distance >= definition.minDistance && distance <= definition.maxDistance && speedMph <= definition.maxMph && wakeSafe;
  const previous = clamp(Number(state.progress) || 0, 0, definition.hold);
  const progress = clamp(previous + (qualifies ? dt : -dt * 1.35), 0, definition.hold);
  return { progress, qualifies, complete: progress >= definition.hold };
}

function fieldObservationTrunkBlocked(blockers, x, z) {
  const grid = blockers?.trunkGrid;
  if (!grid?.get) return false;
  const cell = Math.max(2, Number(blockers.cell) || 10), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  for (let offsetX = -1; offsetX <= 1; offsetX++) for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
    const trunks = grid.get(`${cx + offsetX},${cz + offsetZ}`); if (!trunks) continue;
    for (const trunk of trunks) {
      const dx = x - trunk.x, dz = z - trunk.z, clearance = (Number(trunk.r) || 0) + 0.22;
      if (dx * dx + dz * dz < clearance * clearance) return true;
    }
  }
  return false;
}

export function fieldObservationSightline(terrain, waterLevel, fromX, fromZ, toX, toZ, samples = 8, blockers = null) {
  if (!terrain?.heightAt || ![waterLevel, fromX, fromZ, toX, toZ].every(Number.isFinite)) return false;
  const count = Math.max(3, Math.min(18, Math.round(Number(samples) || 8)));
  for (let index = 1; index <= count; index++) {
    const ratio = index / count, x = fromX + (toX - fromX) * ratio, z = fromZ + (toZ - fromZ) * ratio, height = terrain.heightAt(x, z);
    if (!Number.isFinite(height) || height > waterLevel - 0.08 || fieldObservationTrunkBlocked(blockers, x, z)) return false;
  }
  return true;
}

export function ensureDiscoverySave(save) {
  const source = save.discoveries && typeof save.discoveries === 'object' ? save.discoveries : {};
  const found = [...new Set(Array.isArray(source.found) ? source.found.filter(id => DISCOVERY_BY_ID.has(id)) : [])];
  const records = source.records && typeof source.records === 'object' ? source.records : {};
  const missed = source.missed && typeof source.missed === 'object' ? source.missed : {};
  save.discoveries = { found, records, missed };
  return save.discoveries;
}

export function discoverySnapshot(environment, regions) {
  return {
    region: regions?.current?.id || '', hour: Number(environment?.hour) || 0, day: Math.max(1, Number(environment?.day) || 1),
    waterLevel: Number(environment?.waterLevel) || 0, tideRate: Number(environment?.tideRate) || 0,
    storm: Number(environment?.values?.storm) || 0, rain: Number(environment?.values?.rain) || 0, wind: Number(environment?.values?.wind) || 0,
  };
}

function coloredGeometry(geometry, color) {
  const result = geometry.toNonIndexed(), count = result.getAttribute('position').count, values = new Float32Array(count * 3), tint = new THREE.Color(color);
  for (let index = 0; index < count; index++) { values[index * 3] = tint.r; values[index * 3 + 1] = tint.g; values[index * 3 + 2] = tint.b; }
  result.setAttribute('color', new THREE.BufferAttribute(values, 3)); return result;
}

function makeSpoonbillGeometry() {
  const parts = [];
  const add = (geometry, color) => { parts.push(coloredGeometry(geometry, color)); };
  const body = new THREE.SphereGeometry(0.19, 12, 8); body.scale(1, 0.78, 1.8); body.translate(0, 0.72, 0); add(body, 0xdf89a2);
  const wing = new THREE.SphereGeometry(0.17, 10, 7); wing.scale(1.1, 0.43, 1.8); wing.translate(0, 0.77, 0.02); add(wing, 0xf0a8b7);
  const neck = new THREE.CylinderGeometry(0.035, 0.047, 0.52, 7); neck.rotateX(0.44); neck.translate(0, 1.01, -0.18); add(neck, 0xdf89a2);
  const neckTop = new THREE.CylinderGeometry(0.03, 0.035, 0.32, 7); neckTop.rotateX(-0.38); neckTop.translate(0, 1.31, -0.15); add(neckTop, 0xdf89a2);
  const head = new THREE.SphereGeometry(0.065, 9, 7); head.scale(1, 0.86, 1.42); head.translate(0, 1.48, -0.23); add(head, 0xe8b0b4);
  const bill = new THREE.BoxGeometry(0.07, 0.035, 0.5); bill.translate(0, 1.46, -0.51); add(bill, 0x716b68);
  const spoon = new THREE.SphereGeometry(0.07, 8, 6); spoon.scale(0.9, 0.26, 1.45); spoon.translate(0, 1.46, -0.79); add(spoon, 0x716b68);
  for (const x of [-0.055, 0.055]) { const leg = new THREE.CylinderGeometry(0.012, 0.014, 0.72, 5); leg.translate(x, 0.35, 0.04); add(leg, 0x9e6971); }
  const geometry = mergeGeometries(parts, false); geometry.computeBoundingSphere(); return geometry;
}

function makeRoostRig() {
  const root = new THREE.Group(); root.name = 'pooled roseate spoonbill roost'; root.visible = false;
  const birds = [], offsets = [
    [-3.8, -1.1], [-2.3, 1.4], [-0.9, -0.6], [0.8, 1.6], [2.2, -1.3], [3.8, 0.8], [-1.8, -2.5], [1.1, -2.7], [3.1, 2.5],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const [x, z] = offsets[i]; birds.push({ x, z, heading: 0.35 + i * 1.71, scale: 0.92 + (i % 4) * 0.045, flyX: Math.cos(i * 1.37), flyZ: Math.sin(i * 1.37) });
  }
  const mesh = new THREE.InstancedMesh(makeSpoonbillGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88 }), birds.length);
  mesh.name = 'nine instanced roseate spoonbills'; mesh.castShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh);
  return { root, birds, mesh, dummy: new THREE.Object3D() };
}

function triangleGeometry(points) {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.computeVertexNormals(); return geometry;
}

function makeSawfishRig() {
  const root = new THREE.Group(); root.name = 'pooled tagged smalltooth sawfish'; root.visible = false;
  const hide = new THREE.MeshStandardMaterial({ color: 0x697a78, roughness: 0.75, metalness: 0.06 });
  const fin = new THREE.MeshStandardMaterial({ color: 0x5d6d6b, roughness: 0.82, side: THREE.DoubleSide });
  const tagMaterial = new THREE.MeshStandardMaterial({ color: 0xe27a32, roughness: 0.42, emissive: 0x351305, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), hide); body.scale.set(1, 0.48, 2.8); root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8), hide); head.scale.set(1.45, 0.45, 1.25); head.position.set(0, -0.01, -1.15); root.add(head);
  const rostrum = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 1.75), hide); rostrum.position.set(0, -0.01, -2.05); root.add(rostrum);
  const toothPositions = [];
  for (let i = 0; i < 11; i++) {
    const z = -1.27 - i * 0.145, width = 0.12 + i * 0.008;
    toothPositions.push(-0.07, -0.005, z, -width, -0.005, z - 0.035, 0.07, -0.005, z, width, -0.005, z - 0.035);
  }
  const toothGeometry = new THREE.BufferGeometry(); toothGeometry.setAttribute('position', new THREE.Float32BufferAttribute(toothPositions, 3));
  const teeth = new THREE.LineSegments(toothGeometry, new THREE.LineBasicMaterial({ color: 0xc0c5bf, transparent: true, opacity: 0.86 })); root.add(teeth);
  const fins = new THREE.Mesh(triangleGeometry([-0.15, 0, -0.62, -1.1, -0.05, 0.22, -0.2, 0, 0.58, 0.15, 0, -0.62, 1.1, -0.05, 0.22, 0.2, 0, 0.58]), fin); root.add(fins);
  const dorsal = new THREE.Mesh(triangleGeometry([-0.13, 0.02, 0.08, 0, 0.72, 0.42, 0.13, 0.02, 0.65]), fin); root.add(dorsal);
  const tail = new THREE.Group(); tail.position.z = 1.35;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.27, 1.4, 9), hide); stem.rotation.x = Math.PI / 2; stem.position.z = 0.65; tail.add(stem);
  const caudal = new THREE.Mesh(triangleGeometry([0, 0, 1.22, -0.15, 0.02, 0.92, 0, 0.82, 1.55, 0, 0, 1.22, 0.15, 0.02, 0.92, 0, -0.62, 1.52]), fin); tail.add(caudal); root.add(tail);
  const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), tagMaterial); tag.rotation.z = Math.PI / 2; tag.position.set(0.34, 0.08, 0.12); root.add(tag);
  root.traverse(object => { if (object.isMesh) object.castShadow = true; });
  return { root, tail, tag };
}

function makePythonSegmentGeometry() {
  const geometry = new THREE.SphereGeometry(1, 12, 8).toNonIndexed(), position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3), tan = new THREE.Color(0xa98553), blotch = new THREE.Color(0x3d3424), underside = new THREE.Color(0xcbb78c), color = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const patch = Math.sin(x * 5.7 + z * 3.3) + Math.cos(z * 6.1 - y * 2.8) + Math.sin((x - z) * 4.2);
    color.copy(y < -0.3 ? underside : patch > 0.38 ? blotch : tan);
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeBoundingSphere(); return geometry;
}

function makePythonRig() {
  const root = new THREE.Group(); root.name = 'pooled swimming Burmese python'; root.visible = false;
  const mesh = new THREE.InstancedMesh(makePythonSegmentGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0.02 }), PYTHON_SEGMENT_COUNT);
  mesh.name = 'one 18-segment instanced Burmese python'; mesh.castShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh);
  return { root, mesh, dummy: new THREE.Object3D() };
}

function makeWreckRig() {
  const root = wreck(); root.name = 'pooled Hammond logging skiff'; root.visible = false;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.2), new THREE.MeshStandardMaterial({ color: 0xaa8548, roughness: 0.38, metalness: 0.78, emissive: 0x251704, emissiveIntensity: 0.16 }));
  plate.position.set(-0.08, 0.09, -1.48); plate.rotation.set(0.08, 0.38, 1.24); root.add(plate);
  return { root, plate };
}

function siteDepthAllowed(kind, depth) {
  if (kind === 'sawfish') return depth >= 1.3 && depth <= 4.8;
  if (kind === 'python') return depth >= 0.24 && depth <= 3.2;
  if (kind === 'roost') return depth >= -0.06 && depth <= 0.42;
  return depth >= -0.12 && depth <= 0.34;
}

export function findFieldDiscoverySite(discovery, context, nearby = false, random = Math.random) {
  const definition = typeof discovery === 'string' ? DISCOVERY_BY_ID.get(discovery) : discovery;
  if (!definition) return null;
  const { phys, terrain, world, environment } = context, forward = phys.forward(new THREE.Vector2()), right = phys.right(new THREE.Vector2());
  const min = nearby ? 42 : 105, max = nearby ? 68 : 190, sideMax = nearby ? 44 : 125;
  for (let attempt = 0; attempt < 120; attempt++) {
    const ahead = min + random() * (max - min), side = (random() - 0.5) * sideMax * 2;
    const x = phys.pos.x + forward.x * ahead + right.x * side, z = phys.pos.y + forward.y * ahead + right.y * side;
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 180 || regionAt(x, z).id !== definition.region || world?.blockedAt(x, z)) continue;
    const ground = terrain.heightAt(x, z), depth = environment.waterLevel - ground;
    if (definition.kind === 'python' && (ground > -1.48 || fieldObservationTrunkBlocked(phys, x, z))) continue;
    if (siteDepthAllowed(definition.kind, depth)) return { x, z, ground, heading: random() * Math.PI * 2 };
  }
  return null;
}

export class FieldDiscoveryDirector {
  constructor(options) {
    Object.assign(this, options); // scene, terrain, world, water, phys, game, audio, environment, regions, life, law, reputation, encounters
    this.store = ensureDiscoverySave(this.game.save); this.active = null; this.next = 38 + Math.random() * 34; this.interact = false; this.prompting = false;
    this.rigs = { 'roseate-roost': makeRoostRig(), 'tagged-sawfish': makeSawfishRig(), 'python-crossing': makePythonRig(), 'logging-skiff': makeWreckRig() };
    for (const rig of Object.values(this.rigs)) this.scene.add(rig.root);
    this.keyHandler = event => {
      if (event.code === 'KeyE' && !event.repeat) this.interact = true;
      if (import.meta.env.DEV && event.code === 'F12' && event.shiftKey && !event.ctrlKey && !event.repeat) {
        event.preventDefault();
        const restoreDebug = restore => {
          this.close(0); this.environment.minutes = restore.minutes; this.environment.minutesPerSecond = restore.minutesPerSecond; this.environment.persistT = restore.environmentPersistT; this.environment.syncClockAndTide();
          if (this.story?.state) { this.story.state.stage = restore.storyStage; this.story.offerT = restore.storyOfferT; }
          this.game.save.cash = restore.cash; this.store.found = restore.found; this.store.records = restore.records; this.store.missed = restore.missed;
          this.game.save.environment = restore.environmentSave;
          if (window.__dbg) { if (restore.freeCam === undefined) delete window.__dbg.freeCam; else window.__dbg.freeCam = restore.freeCam; }
          this.phys.reset(restore.x, restore.z, restore.heading); this.debugRestore = null; this.game.persist();
        };
        if (this.debugRestore) {
          restoreDebug(this.debugRestore); return;
        }
        this.debugRestore = {
          x: this.phys.pos.x, z: this.phys.pos.y, heading: this.phys.heading, minutes: this.environment.minutes, minutesPerSecond: this.environment.minutesPerSecond,
          environmentPersistT: this.environment.persistT, environmentSave: JSON.parse(JSON.stringify(this.game.save.environment || {})),
          storyStage: this.story?.state?.stage || 'dormant', storyOfferT: this.story?.offerT || 0, cash: this.game.save.cash,
          freeCam: window.__dbg?.freeCam,
          found: [...this.store.found], records: JSON.parse(JSON.stringify(this.store.records)), missed: JSON.parse(JSON.stringify(this.store.missed)),
        };
        if (this.story?.state) { this.story.state.stage = 'dormant'; this.story.offerT = 999; }
        this.environment.minutes = (this.environment.day - 1) * 1440 + 18.7 * 60; this.environment.minutesPerSecond = 0; this.environment.persistT = Number.MAX_SAFE_INTEGER; this.environment.syncClockAndTide(); this.phys.reset(-4120.23, -1225.17, 1.9635);
        if (this.start('python-crossing', true, true)) {
          const active = this.active, offsets = [-Math.PI / 2, Math.PI / 2, -1.2, 1.2, -0.85, 0.85]; let boatX = active.x, boatZ = active.z, foundBoat = false;
          outer: for (const distance of [14, 17, 20]) for (const offset of offsets) {
            const bearing = active.heading + offset, candidateX = active.x + Math.sin(bearing) * distance, candidateZ = active.z + Math.cos(bearing) * distance;
            const depth = this.environment.waterLevel - this.terrain.heightAt(candidateX, candidateZ);
            const clear = fieldObservationSightline(this.terrain, this.environment.waterLevel, candidateX, candidateZ, active.x, active.z, Math.ceil(distance / 4), this.phys);
            if (depth > 0.42 && depth < 4.2 && clear && !this.world?.blockedAt(candidateX, candidateZ)) { boatX = candidateX; boatZ = candidateZ; foundBoat = true; break outer; }
          }
          if (!foundBoat) { restoreDebug(this.debugRestore); return; }
          const lookHeading = Math.atan2(-(active.x - boatX), -(active.z - boatZ)); active.debugInspect = true; active.life = 999;
          this.phys.reset(boatX, boatZ, lookHeading); active.distance = Math.hypot(active.x - boatX, active.z - boatZ); active.visible = true; active.sightT = 0.18;
          if (window.__dbg) {
            const centerX = active.x + Math.sin(active.heading) * 1.9, centerZ = active.z + Math.cos(active.heading) * 1.9;
            window.__dbg.freeCam = { x: centerX + Math.cos(active.heading) * 7.2, y: this.environment.waterLevel + 2.45, z: centerZ - Math.sin(active.heading) * 7.2, tx: centerX, ty: this.environment.waterLevel - 0.02, tz: centerZ };
          }
          this.reveal(active); return;
        }
        restoreDebug(this.debugRestore);
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  snapshot() { return discoverySnapshot(this.environment, this.regions); }

  busy() {
    if (this.active?.debugInspect) return false;
    return Boolean(this.game.state || this.game.paused || this.game.resultOpen || this.game.menuOpen || this.game.mapOpen || this.story?.blocking?.() || this.aftermath?.blocking?.()
      || this.encounters?.active || this.incidents?.active || this.law?.pursuit || this.life?.traffic?.activeCollision?.());
  }

  start(id = '', nearby = false, forced = false) {
    if (this.active) this.close(30);
    const snapshot = this.snapshot();
    const failedToday = Object.entries(this.store.missed).filter(([, record]) => Number(record?.day) === snapshot.day).map(([key]) => key);
    const choices = forced && id ? [DISCOVERY_BY_ID.get(id)].filter(Boolean) : eligibleFieldDiscoveries(snapshot, this.store.found, failedToday);
    const definition = id ? choices.find(choice => choice.id === id) : choices[Math.floor(Math.random() * choices.length)];
    if (!definition) { this.next = 34 + Math.random() * 38; return false; }
    const site = findFieldDiscoverySite(definition, this, nearby); if (!site) { this.next = 18 + Math.random() * 18; return false; }
    const rig = this.rigs[definition.id]; rig.root.visible = true;
    const active = this.active = {
      definition, x: site.x, z: site.z, centerX: site.x, centerZ: site.z, ground: site.ground, heading: site.heading,
      state: 'unnoticed', known: false, hold: 0, life: 210, resolveT: 0, pingT: 0.4, spookT: 0, orbit: site.heading, orbitDirection: Math.random() < 0.5 ? -1 : 1,
      desiredHeading: site.heading, turnT: 7 + Math.random() * 6, sightT: 0, visible: false,
    };
    if (definition.kind === 'roost') {
      rig.root.position.set(site.x, Math.max(site.ground, this.environment.waterLevel - 0.08), site.z); rig.root.rotation.y = site.heading;
      this.animateRoost(active, 0, 0);
    } else if (definition.kind === 'wreck') {
      rig.root.position.set(site.x, site.ground + 0.66, site.z); rig.root.rotation.set(0.02, site.heading, 0.04);
    } else if (definition.kind === 'python') this.placePython(active, 0);
    else this.placeSawfish(active, 0);
    const fieldTeam = definition.kind === 'sawfish' || definition.kind === 'python';
    this.radio?.transmit({ channel: fieldTeam ? 'FWC TAC' : 'CH 68', speaker: fieldTeam ? 'GLADES FIELD TEAM' : 'MARA KEENE · TOWER', text: definition.rumor, priority: 1, key: `discovery:rumor:${definition.id}:${snapshot.day}`, cooldown: 99999 });
    return true;
  }

  reveal(active) {
    if (active.known) return;
    active.known = true; active.state = 'observing'; this.game.wpTarget = null;
    this.game.toast(active.definition.name, active.definition.intro, 4.2);
  }

  setPrompt(text) {
    if (this.game.dockCamp || this.game.dockJob || this.game.atBoard) { this.prompting = false; delete this.game.el.prompt.dataset.discovery; return; }
    this.game.el.prompt.innerHTML = `<b>E</b> ${text}`; this.game.el.prompt.classList.add('on'); this.game.el.prompt.dataset.discovery = this.active?.definition.id || '';
    this.prompting = true;
  }

  clearPrompt(preserveGamePrompt = false) {
    if (!this.prompting && !this.game.el.prompt.dataset.discovery) return;
    if (!preserveGamePrompt && this.game.el.prompt.dataset.discovery) this.game.el.prompt.classList.remove('on');
    delete this.game.el.prompt.dataset.discovery; this.prompting = false;
  }

  playerWakeAt(x, z, t) {
    const sample = this.life?.traffic?.playerWakeAt; if (!sample) return 0;
    return Math.max(Math.abs(sample.call(this.life.traffic, x, z, t)), Math.abs(sample.call(this.life.traffic, x, z, t + 0.28)));
  }

  animateRoost(active, dt, t) {
    const rig = this.rigs[active.definition.id], flushed = active.state === 'failed', flight = flushed ? clamp(1 - active.resolveT / 5.5) : 0;
    for (let index = 0; index < rig.birds.length; index++) {
      const bird = rig.birds[index], lift = flight * (2.2 + (index % 3) * 0.55);
      const birdMesh = rig.dummy; birdMesh.position.set(bird.x + bird.flyX * flight * 13, Math.sin(t * 1.4 + index) * 0.018 + lift, bird.z + bird.flyZ * flight * 13);
      birdMesh.rotation.set(flushed ? -0.32 + Math.sin(t * 12 + index) * 0.14 : 0, bird.heading, flushed ? Math.sin(t * 10 + index) * 0.28 : Math.sin(t * 0.8 + index) * 0.018);
      birdMesh.scale.setScalar(bird.scale); birdMesh.updateMatrix(); rig.mesh.setMatrixAt(index, birdMesh.matrix);
    }
    rig.mesh.instanceMatrix.needsUpdate = true;
  }

  placeSawfish(active, t) {
    const rig = this.rigs[active.definition.id], surface = Math.sin(t * 0.42 + active.orbit) * 0.11;
    rig.root.position.set(active.x, this.water.waveHeight(active.x, active.z, t) - 0.53 + surface, active.z);
    rig.root.rotation.set(-0.04 + surface * 0.3, active.heading, Math.sin(t * 0.65) * 0.035);
    rig.tail.rotation.y = Math.sin(t * (active.spookT > 0 ? 8 : 4.2) + active.orbit) * (active.spookT > 0 ? 0.36 : 0.16);
    rig.tag.material.emissiveIntensity = 0.15 + Math.max(0, Math.sin(t * 4)) * 0.28;
  }

  moveSawfish(active, dt, t) {
    const px = this.phys.pos.x, pz = this.phys.pos.y;
    active.spookT = Math.max(0, active.spookT - dt); active.orbit += dt * 0.14 * active.orbitDirection;
    let targetX = active.centerX + Math.cos(active.orbit) * 18, targetZ = active.centerZ + Math.sin(active.orbit) * 13, speed = 0.78;
    if (active.spookT > 0) {
      const dx = active.x - px, dz = active.z - pz, distance = Math.hypot(dx, dz) || 1;
      targetX = active.x + dx / distance * 40; targetZ = active.z + dz / distance * 40; speed = 2.25;
    }
    const targetHeading = Math.atan2(-(targetX - active.x), -(targetZ - active.z));
    active.heading += clamp(angleDelta(active.heading, targetHeading), -dt * 0.85, dt * 0.85);
    const nx = active.x - Math.sin(active.heading) * speed * dt, nz = active.z - Math.cos(active.heading) * speed * dt;
    const depth = this.environment.waterLevel - this.terrain.heightAt(nx, nz);
    if (depth > 1.05 && !this.world?.blockedAt(nx, nz)) { active.x = nx; active.z = nz; }
    else { active.orbitDirection *= -1; active.heading += dt * 1.4; }
    this.placeSawfish(active, t);
  }

  placePython(active, t) {
    const rig = this.rigs[active.definition.id], phase = t * 2.45 + active.orbit;
    const dive = active.state === 'failed' ? clamp(1 - active.resolveT / 5.5) : 0;
    rig.root.position.set(active.x, this.water.waveHeight(active.x, active.z, t) - 0.025 - dive * 1.25, active.z); rig.root.rotation.set(0, active.heading, 0);
    for (let index = 0; index < PYTHON_SEGMENT_COUNT; index++) {
      const along = index / (PYTHON_SEGMENT_COUNT - 1), amplitude = 0.07 + along * 0.24;
      const lateral = Math.sin(phase - index * 0.7) * amplitude, nextLateral = Math.sin(phase - (index + 1) * 0.7) * amplitude;
      const segment = rig.dummy, radius = index === 0 ? 0.205 : 0.18 * (1 - along * 0.68);
      segment.position.set(lateral, -along * 0.022, index * 0.235); segment.rotation.set(0, Math.atan2(nextLateral - lateral, 0.235), Math.sin(phase - index * 0.7) * 0.035);
      segment.scale.set(radius, radius * (index === 0 ? 0.58 : 0.66), index === 0 ? 0.31 : 0.235); segment.updateMatrix(); rig.mesh.setMatrixAt(index, segment.matrix);
    }
    rig.mesh.instanceMatrix.needsUpdate = true;
  }

  movePython(active, dt, t) {
    if (active.debugInspect) { this.placePython(active, t); return; }
    active.turnT -= dt;
    if (active.state === 'failed') {
      const dx = active.x - this.phys.pos.x, dz = active.z - this.phys.pos.y;
      active.desiredHeading = Math.atan2(-dx, -dz);
    } else if (active.turnT <= 0) {
      active.desiredHeading += (Math.random() - 0.5) * 0.78; active.turnT = 7 + Math.random() * 7;
    }
    const turnRate = active.state === 'failed' ? 1.3 : 0.42;
    active.heading += clamp(angleDelta(active.heading, active.desiredHeading), -dt * turnRate, dt * turnRate);
    const speed = active.state === 'failed' ? 1.55 : 0.62, nx = active.x - Math.sin(active.heading) * speed * dt, nz = active.z - Math.cos(active.heading) * speed * dt;
    const depth = this.environment.waterLevel - this.terrain.heightAt(nx, nz);
    if (depth > 0.18 && depth < 4.2 && !this.world?.blockedAt(nx, nz)) { active.x = nx; active.z = nz; }
    else { active.desiredHeading += Math.PI * (0.72 + Math.random() * 0.56); active.turnT = 3.2; }
    this.placePython(active, t);
  }

  complete(active) {
    if (active.state === 'logged') return;
    const definition = active.definition, snapshot = this.snapshot(); active.state = 'logged'; active.resolveT = 6.5; this.clearPrompt();
    if (!this.store.found.includes(definition.id)) this.store.found.push(definition.id);
    this.store.records[definition.id] = {
      day: snapshot.day, hour: Math.round(snapshot.hour * 10) / 10, region: definition.region,
      x: Math.round(active.x), z: Math.round(active.z), weather: this.environment.key,
      waterLevel: Math.round(snapshot.waterLevel * 1000) / 1000, tideRate: Math.round(snapshot.tideRate * 1000) / 1000,
    };
    this.game.addCash(definition.reward); this.game.bounties?.event('discover', 1); this.audio.complete();
    const faction = definition.kind === 'wreck' ? 'locals' : 'fwc';
    const reputation = definition.kind === 'sawfish' ? 0.5 : definition.kind === 'python' ? 0.4 : 0.3;
    this.reputation?.change(faction, reputation, `field-note:${definition.id}`, definition.success, false);
    this.game.toast(definition.name, `${definition.success} · +$${definition.reward}`, 5.2);
    this.radio?.transmit({ channel: definition.kind === 'wreck' ? 'CH 68' : 'FWC TAC', speaker: definition.kind === 'wreck' ? 'MARA KEENE · TOWER' : 'GLADES FIELD TEAM', text: definition.followup, priority: 2, key: `discovery:logged:${definition.id}`, cooldown: 99999 });
    this.game.persist();
  }

  fail(active, reason, strike = false) {
    if (active.state === 'failed') return;
    active.state = 'failed'; active.resolveT = 5.5; active.hold = 0; this.clearPrompt();
    const previous = this.store.missed[active.definition.id] || {};
    this.store.missed[active.definition.id] = { day: this.environment.day, count: Math.min(99, (Number(previous.count) || 0) + 1) };
    if (strike) {
      this.law?.violation(0.62, 'protected sawfish strike');
      this.reputation?.change('fwc', -0.7, 'sawfish-strike', 'The field team logged the tower hull after a protected-animal strike.', false);
      this.audio.thud(1.1);
    } else if (active.definition.kind === 'python') this.audio.splash(0.22);
    else this.audio.squawk(0.45, active.x, active.z);
    this.game.toast(active.definition.name, reason, 4.2); this.game.persist();
  }

  updateRoost(active, dt, t) {
    this.animateRoost(active, dt, t);
    const distance = Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y), speedMph = this.phys.speed * MPH, wake = this.playerWakeAt(active.x, active.z, t);
    active.distance = distance; active.wake = wake; if (distance < 96) this.reveal(active);
    if (!active.known) return;
    if ((wake > 0.026 && distance < 78) || (distance < 11 && speedMph > 7)) { this.fail(active, 'The wake reached the bank first. The roost lifted and scattered across the lake.'); return; }
    const step = observationStep(active.definition, { distance, speedMph, wake, dt, progress: active.hold }); active.hold = step.progress;
    if (step.complete) this.complete(active);
  }

  updateSawfish(active, dt, t) {
    this.moveSawfish(active, dt, t);
    const distance = Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y), speedMph = this.phys.speed * MPH;
    active.distance = distance; active.pingT -= dt;
    if (active.pingT <= 0 && distance < 240) {
      const closeness = 1 - clamp((distance - 12) / 228); this.audio.tagPing?.(0.06 + closeness * 0.24, closeness);
      active.pingT = 0.65 + (1 - closeness) * 2.8;
    }
    if (distance < 138) this.reveal(active); if (!active.known) return;
    if (distance < 3.4 && speedMph > 6) { this.fail(active, 'The hull crossed the animal. FWC logged a protected-species strike.', true); return; }
    if (distance < 13 && speedMph > 7.5) { active.spookT = Math.max(active.spookT, 5.5); active.hold = 0; }
    const step = observationStep(active.definition, { distance, speedMph, dt, progress: active.hold }); active.hold = step.progress;
    if (step.complete) this.complete(active);
  }

  updatePython(active, dt, t) {
    this.movePython(active, dt, t);
    const distance = Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y), speedMph = this.phys.speed * MPH, wake = this.playerWakeAt(active.x, active.z, t);
    active.distance = distance; active.wake = wake; active.sightT -= dt;
    if (active.sightT <= 0) {
      active.visible = fieldObservationSightline(this.terrain, this.environment.waterLevel, this.phys.pos.x, this.phys.pos.y, active.x, active.z, Math.ceil(Math.min(distance, 85) / 5), this.phys);
      active.sightT = distance < 112 ? 0.18 : 0.42;
    }
    if (distance < 112 && active.visible) this.reveal(active); if (!active.known) return;
    if ((wake > 0.034 && distance < 58) || (distance < 8 && speedMph > 5.5)) { this.fail(active, 'Prop wash broke the surface track. The python dropped under the tannin and vanished.'); return; }
    const step = observationStep(active.definition, { distance, speedMph, wake, visible: active.visible, dt, progress: active.hold }); active.hold = step.progress;
    if (active.debugInspect) { active.hold = Math.min(active.hold, active.definition.hold * 0.62); return; }
    if (step.complete) this.complete(active);
  }

  updateWreck(active) {
    const distance = Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y), speedMph = this.phys.speed * MPH; active.distance = distance;
    if (distance < 78) this.reveal(active); if (!active.known) return;
    if (this.environment.waterLevel > -0.025) { this.game.toast('The flood covered the plate', 'The wreck will show again on another falling tide.', 3.4); this.close(120); return; }
    if (distance < 14) {
      if (speedMph <= 4.5) { this.setPrompt("copy the skiff's builder plate"); if (this.interact) this.complete(active); }
      else this.setPrompt('idle below 4.5 mph to read the plate');
    } else this.clearPrompt(this.game.dockCamp || this.game.dockJob || this.game.atBoard);
  }

  updateActive(dt, t) {
    const active = this.active; if (!active) return;
    if (active.state === 'logged' || active.state === 'failed') {
      if (active.definition.kind === 'roost') this.animateRoost(active, dt, t);
      else if (active.definition.kind === 'sawfish') this.moveSawfish(active, dt, t);
      else if (active.definition.kind === 'python') this.movePython(active, dt, t);
      active.resolveT -= dt; if (active.resolveT <= 0) this.close(active.state === 'logged' ? 110 : 150); return;
    }
    active.life -= dt;
    if (active.life <= 0 || Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y) > 760) {
      if (active.known) this.game.toast('Field sign lost', 'The water moved on before the observation was complete.', 3.2);
      this.close(100); return;
    }
    if (active.definition.kind === 'roost') this.updateRoost(active, dt, t);
    else if (active.definition.kind === 'sawfish') this.updateSawfish(active, dt, t);
    else if (active.definition.kind === 'python') this.updatePython(active, dt, t);
    else this.updateWreck(active, dt, t);
  }

  close(cooldown = 80) {
    this.clearPrompt(this.game.dockCamp || this.game.dockJob || this.game.atBoard);
    for (const rig of Object.values(this.rigs)) rig.root.visible = false;
    this.active = null; this.next = cooldown + Math.random() * 38;
  }

  hud() {
    const active = this.active; if (!active?.known || this.busy()) return null;
    if (active.state === 'logged') return { title: 'Field note logged', obj: active.definition.name, sub: active.definition.success };
    if (active.state === 'failed') return { title: 'Field observation lost', obj: active.definition.name, sub: 'The same conditions may return another day.' };
    if (active.definition.kind === 'wreck') return { title: 'Low-water field note', obj: active.distance < 14 ? 'Idle alongside and read the builder plate' : 'Work in close before the flood covers it', sub: 'The plate stays on the wreck. Copy the hull number into the chart.' };
    const percent = Math.round(active.hold / active.definition.hold * 100), inRange = active.distance >= active.definition.minDistance && active.distance <= active.definition.maxDistance;
    if (active.definition.kind === 'roost') return { title: 'Roseate roost', obj: `Quiet observation · ${percent}%`, sub: inRange ? 'Hold below 4.8 mph and keep the wake off the bank' : 'Stay 20–54 m off the birds' };
    if (active.definition.kind === 'python') return { title: 'Python crossing', obj: `Photo sequence · ${percent}%`, sub: !active.visible ? 'A bank is blocking the camera. Work into the same cut.' : inRange ? 'Hold below 4.5 mph and keep the wake behind the hull' : 'Stay 13–38 m off. Do not attempt capture.' };
    return { title: 'Tagged sawfish', obj: `Receiver fix · ${percent}%`, sub: active.spookT > 0 ? 'Animal spooked. Open the distance and bring the prop down.' : inRange ? 'Hold below 6 mph while the receiver resolves the tag' : 'Track the ping from 14–42 m' };
  }

  stamps(out) {
    const active = this.active; if (!active || active.definition.kind !== 'python' || active.state === 'failed') return 0;
    const trailX = active.x + Math.sin(active.heading) * 1.55, trailZ = active.z + Math.cos(active.heading) * 1.55;
    return emitWakeStamp(out, trailX, trailZ, 0.92, -0.11, 0.16, 1.05) ? 1 : 0;
  }

  markers() {
    const markers = [];
    for (const definition of FIELD_DISCOVERIES) {
      const record = this.store.records[definition.id];
      if (this.store.found.includes(definition.id) && Number.isFinite(record?.x) && Number.isFinite(record?.z)) markers.push({ x: record.x, z: record.z, label: definition.short, color: definition.color, found: true });
    }
    const active = this.active;
    if (active?.known && !this.store.found.includes(active.definition.id)) markers.push({ x: active.x, z: active.z, label: active.definition.short, color: active.definition.color, live: true });
    return markers;
  }

  menuEntries() {
    return FIELD_DISCOVERIES.map(definition => {
      const record = this.store.records[definition.id], found = this.store.found.includes(definition.id);
      return { ...definition, found, record: found ? record : null };
    });
  }

  update(dt, t, enabled = true) {
    const pressed = this.interact; this.interact = false;
    if (!enabled) { this.clearPrompt(this.game.dockCamp || this.game.dockJob || this.game.atBoard); return; }
    this.interact = pressed;
    if (this.active) {
      if (!this.busy()) this.updateActive(dt, t);
      else {
        if (this.active.definition.kind === 'roost') this.animateRoost(this.active, dt, t);
        else if (this.active.definition.kind === 'sawfish') this.moveSawfish(this.active, dt, t);
        else if (this.active.definition.kind === 'python') this.movePython(this.active, dt, t);
        this.clearPrompt(this.game.dockCamp || this.game.dockJob || this.game.atBoard);
      }
      const active = this.active;
      if (active?.known && Math.hypot(active.x - this.phys.pos.x, active.z - this.phys.pos.y) < 900) emitMapMarker(this.game, active.x, active.z, 'dot', active.definition.color);
      this.interact = false; return;
    }
    if (this.busy()) return;
    this.next -= dt; if (this.next > 0) return;
    this.start();
  }

  resourceStats() {
    const geometries = new Set(), materials = new Set(); let objects = 0;
    for (const rig of Object.values(this.rigs)) rig.root.traverse(object => {
      objects++; if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material)); else if (object.material) materials.add(object.material);
    });
    return { rigs: Object.keys(this.rigs).length, objects, geometries: geometries.size, materials: materials.size, active: this.active?.definition.id || '' };
  }
}
