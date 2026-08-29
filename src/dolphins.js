import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { regionAt } from './regions.js';
import { WORLD_HALF } from './terrain.js';
import { WakeStampPool } from './wakestamps.js';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const fract = value => value - Math.floor(value);

const POD_SLOTS = [
  { side: -1.7, back: 0, phase: 0.05, scale: 0.82 },
  { side: 1.9, back: 2.8, phase: 0.43, scale: 0.78 },
  { side: -3.1, back: 5.6, phase: 0.72, scale: 0.75 },
  { side: 3.5, back: 7.8, phase: 0.91, scale: 0.61 },
];

export function dolphinHabitatPotential({ regionId = '', depth = 0, storm = 0, wind = 0, rain = 0, fish = 1, tideRate = 0 } = {}) {
  if (regionId !== 'mangrove' && regionId !== 'broad') return 0;
  const navigable = smooth(1.9, 3.1, Number(depth) || 0);
  const weather = (1 - smooth(0.42, 0.78, Number(storm) || 0)) * (1 - smooth(11, 18, Number(wind) || 0)) * (1 - clamp(Number(rain) || 0) * 0.22);
  const prey = smooth(0.42, 1.18, Number(fish) || 0);
  const movingWater = 0.82 + smooth(0.03, 0.24, Math.abs(Number(tideRate) || 0)) * 0.18;
  const region = regionId === 'mangrove' ? 1 : 0.92;
  return clamp(navigable * weather * prey * movingWater * region);
}

// The pod elects to approach a predictable vessel. A player cannot manufacture a bow ride by turning after it.
export function dolphinVesselResponse({ state = 'travel', distance = Infinity, boatSpeed = 0, turnRate = 0, headingAlignment = 0, pursuitSeconds = 0 } = {}) {
  const d = Math.max(0, Number(distance) || 0), speed = Math.max(0, Number(boatSpeed) || 0), turn = Math.abs(Number(turnRate) || 0);
  if ((d < 19 && speed > 10.5) || (d < 34 && turn > 0.42) || (d < 82 && pursuitSeconds > 2.8)) return 'avoid';
  const predictable = speed >= 2.2 && speed <= 8.4 && turn < 0.22;
  if (state === 'ride') return predictable && headingAlignment > 0.58 ? 'ride' : 'observe';
  if (state === 'approach') return predictable ? 'approach' : 'observe';
  if (state === 'travel' && d >= 28 && d <= 165 && predictable && headingAlignment > 0.55) return 'approach';
  return 'observe';
}

function colored(geometry, hex) {
  const output = geometry.index ? geometry.toNonIndexed() : geometry;
  if (output !== geometry) geometry.dispose();
  output.deleteAttribute('uv');
  const color = new THREE.Color(hex), count = output.attributes.position.count, data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(data, i * 3);
  output.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return output;
}

function mergeColored(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function dolphinGeometries() {
  const skin = 0x66757b, pale = 0x9ba8a8, dark = 0x11191b;
  const body = new THREE.SphereGeometry(0.5, 22, 14); body.scale(0.82, 0.64, 2.65);
  const head = new THREE.SphereGeometry(0.5, 18, 12); head.scale(0.76, 0.61, 1.05); head.translate(0, 0.01, -1.23);
  const melon = new THREE.SphereGeometry(0.38, 16, 10); melon.scale(0.95, 0.82, 1.08); melon.translate(0, 0.13, -1.68);
  const rostrum = new THREE.CylinderGeometry(0.095, 0.18, 0.72, 12, 1); rostrum.rotateX(Math.PI / 2); rostrum.translate(0, -0.08, -1.98);
  const belly = new THREE.SphereGeometry(0.5, 18, 10); belly.scale(0.65, 0.26, 1.78); belly.translate(0, -0.38, -0.28);
  const dorsal = new THREE.ConeGeometry(0.34, 0.9, 3); dorsal.rotateY(Math.PI / 3); dorsal.translate(0, 0.55, 0.28);
  const finL = new THREE.SphereGeometry(0.5, 10, 5); finL.scale(0.92, 0.085, 0.34); finL.rotateY(-0.38); finL.translate(-0.58, -0.23, -0.42);
  const finR = new THREE.SphereGeometry(0.5, 10, 5); finR.scale(0.92, 0.085, 0.34); finR.rotateY(0.38); finR.translate(0.58, -0.23, -0.42);
  const eyeL = new THREE.SphereGeometry(0.055, 8, 6); eyeL.translate(-0.31, 0.13, -1.75);
  const eyeR = new THREE.SphereGeometry(0.055, 8, 6); eyeR.translate(0.31, 0.13, -1.75);
  const bodyGeometry = mergeColored([
    colored(body, skin), colored(head, skin), colored(melon, skin), colored(rostrum, skin), colored(belly, pale), colored(dorsal, skin),
    colored(finL, skin), colored(finR, skin), colored(eyeL, dark), colored(eyeR, dark),
  ]);

  const peduncle = new THREE.CylinderGeometry(0.17, 0.29, 1.05, 12, 1); peduncle.rotateX(Math.PI / 2); peduncle.translate(0, 0, 0.46);
  const flukeL = new THREE.SphereGeometry(0.5, 12, 6); flukeL.scale(0.92, 0.09, 0.38); flukeL.rotateY(-0.24); flukeL.translate(-0.45, 0, 0.96);
  const flukeR = new THREE.SphereGeometry(0.5, 12, 6); flukeR.scale(0.92, 0.09, 0.38); flukeR.rotateY(0.24); flukeR.translate(0.45, 0, 0.96);
  const tailGeometry = mergeColored([colored(peduncle, skin), colored(flukeL, skin), colored(flukeR, skin)]);
  return { bodyGeometry, tailGeometry };
}

function makeAnimal(bodyGeometry, tailGeometry, material, slot) {
  const group = new THREE.Group(); group.name = 'bottlenose-dolphin';
  const body = new THREE.Mesh(bodyGeometry, material); body.castShadow = true; body.receiveShadow = true;
  const tail = new THREE.Group(); tail.position.z = 1.22;
  const tailMesh = new THREE.Mesh(tailGeometry, material); tailMesh.castShadow = true; tailMesh.receiveShadow = true; tail.add(tailMesh);
  group.add(body, tail); group.scale.setScalar(slot.scale);
  return { group, tail, x: 0, z: 0, y: -2, surfaced: false, wasSurfaced: false, strikeT: 0, slot };
}

export class DolphinPod {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, game, audio, environment, regions, plume, spray, law, reputation, radio
    this.regionAtFn = o.regionAtFn || regionAt;
    this.rand = mulberry32(Number(o.seed) || 2604);
    const { bodyGeometry, tailGeometry } = dolphinGeometries();
    this.bodyGeometry = bodyGeometry; this.tailGeometry = tailGeometry;
    this.vertices = bodyGeometry.attributes.position.count + tailGeometry.attributes.position.count;
    this.geometryBytes = [bodyGeometry, tailGeometry].reduce((total, geometry) => total + Object.values(geometry.attributes).reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength || 0), 0);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, envMapIntensity: 0.42 });
    this.root = new THREE.Group(); this.root.name = 'bottlenose-pod'; this.root.visible = false;
    this.animals = POD_SLOTS.map(slot => makeAnimal(bodyGeometry, tailGeometry, this.material, slot));
    for (const animal of this.animals) this.root.add(animal.group);
    this.scene.add(this.root);

    this.wakePool = new WakeStampPool(8);
    this.active = false; this.state = 'idle'; this.stateT = 0; this.activeT = 0; this.cooldown = 18 + this.rand() * 24; this.spawnCheckT = 5;
    this.x = 0; this.z = 0; this.heading = 0; this.speed = 0; this.side = 1; this.pursuitT = 0; this.rideT = 0; this.unsteadyT = 0;
    this.prevDistance = Infinity; this.sighted = false; this.rideLogged = false; this.disturbed = false; this.nearMissed = false; this.strikeCd = 0; this.surfaceSoundT = 0;
    this._boatFwd = new THREE.Vector2(); this._boatRight = new THREE.Vector2(); this._podFwd = new THREE.Vector2(); this._toPod = new THREE.Vector2();
    this._responseInput = { state: 'travel', distance: Infinity, boatSpeed: 0, turnRate: 0, headingAlignment: 0, pursuitSeconds: 0 };
    this._habitatInput = { regionId: '', depth: 0, storm: 0, wind: 0, rain: 0, fish: 1, tideRate: 0 };
    this.nature = this.game.save.nature ||= {};
    for (const key of ['dolphinPodsSeen', 'dolphinPasses', 'dolphinDisturbances', 'dolphinStrikes']) this.nature[key] = Math.max(0, Math.floor(Number(this.nature[key]) || 0));
  }

  depthAt(x, z) { return (Number(this.environment.waterLevel) || 0) - this.terrain.heightAt(x, z); }

  potentialAt(x, z) {
    const region = this.regionAtFn(x, z), values = this.environment.values || {};
    const input = this._habitatInput;
    input.regionId = region.id; input.depth = this.depthAt(x, z); input.storm = values.storm || 0; input.wind = (values.wind || 0) * (this.environment.gust || 1);
    input.rain = values.rain || 0; input.fish = region.ecology?.fish || 1; input.tideRate = this.environment.tideRate || 0;
    return dolphinHabitatPotential(input);
  }

  blocked() {
    return Boolean(this.game.state || this.encounters?.active || this.incidents?.active || this.story?.blocking?.() || this.aftermath?.blocking?.() || this.game.life?.traffic?.activeCollision?.());
  }

  suitable(x, z, regionId = '') {
    if (Math.max(Math.abs(x), Math.abs(z)) >= WORLD_HALF - 160 || this.depthAt(x, z) < 2.2 || this.world?.blockedAt?.(x, z)) return false;
    const region = this.regionAtFn(x, z);
    return (!regionId || region.id === regionId) && (region.id === 'mangrove' || region.id === 'broad');
  }

  spawn(force = false) {
    if (this.active || (!force && (this.blocked() || this.potentialAt(this.phys.pos.x, this.phys.pos.y) <= 0.18))) return false;
    this.phys.forward(this._boatFwd); this.phys.right(this._boatRight);
    const current = this.regionAtFn(this.phys.pos.x, this.phys.pos.y), regionId = current.id;
    for (let attempt = 0; attempt < 28; attempt++) {
      const distance = 95 + this.rand() * 65, lateral = (28 + this.rand() * 42) * (this.rand() < 0.5 ? -1 : 1);
      const x = this.phys.pos.x + this._boatFwd.x * distance + this._boatRight.x * lateral;
      const z = this.phys.pos.y + this._boatFwd.y * distance + this._boatRight.y * lateral;
      if (!force && !this.suitable(x, z, regionId)) continue;
      if (force && (Math.max(Math.abs(x), Math.abs(z)) >= WORLD_HALF - 160 || this.depthAt(x, z) < 1.4)) continue;
      this.x = x; this.z = z; this.heading = this.phys.heading + (lateral < 0 ? -0.16 : 0.16); this.speed = 3.4 + this.rand() * 0.7; this.side = lateral < 0 ? -1 : 1;
      this.active = true; this.root.visible = true; this.state = 'travel'; this.stateT = 0; this.activeT = 0; this.pursuitT = 0; this.rideT = 0; this.unsteadyT = 0;
      this.prevDistance = Math.hypot(x - this.phys.pos.x, z - this.phys.pos.y); this.sighted = false; this.rideLogged = false; this.disturbed = false; this.nearMissed = false; this.strikeCd = 0; this.surfaceSoundT = 0;
      for (let i = 0; i < this.animals.length; i++) {
        const animal = this.animals[i]; animal.strikeT = 0; animal.surfaced = false; animal.wasSurfaced = false;
        animal.x = x + i * 0.2; animal.z = z - i * 0.3; animal.group.visible = true;
        animal.y = this.water.waveHeight(animal.x, animal.z, 0) - 1.6; animal.group.position.set(animal.x, animal.y, animal.z); animal.group.rotation.set(0, this.heading, 0);
      }
      return true;
    }
    return false;
  }

  debugStart() { return this.spawn(true); }

  transition(state) {
    if (state === this.state) return;
    this.state = state; this.stateT = 0; this.unsteadyT = 0;
    if (state === 'avoid') {
      const dx = this.x - this.phys.pos.x, dz = this.z - this.phys.pos.y;
      this.heading = Math.atan2(-dx, -dz) + this.side * 0.18; this.speed = Math.max(this.speed, 6.8);
    }
  }

  finish() {
    this.active = false; this.state = 'idle'; this.root.visible = false; this.wakePool.reset();
    this.cooldown = 190 + this.rand() * 250; this.spawnCheckT = 7 + this.rand() * 5;
  }

  sight() {
    if (this.sighted) return;
    this.sighted = true; this.nature.dolphinPodsSeen++; this.game.toast('Bottlenose pod', "Hold course. Don't turn in after them.", 3.2);
    const day = Number(this.environment.day) || 1;
    if (this.nature.dolphinAdvisoryDay !== day) {
      this.nature.dolphinAdvisoryDay = day;
      this.radio?.transmit?.({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: 'Bottlenose pod in the river. Give them fifty yards. If they take the bow, hold course and ease back.', priority: 1, key: `dolphins:${day}`, cooldown: 99999 });
    }
    this.game.persist();
  }

  logRide() {
    if (this.rideLogged) return;
    this.rideLogged = true; this.nature.dolphinPasses++; this.game.bounties?.event?.('dolphinpass', 1);
    this.game.toast('Clean dolphin pass', 'Steady course. The pod left on its own.', 3); this.audio?.pickup?.(); this.game.persist();
  }

  disturb(reason) {
    if (this.disturbed) { this.transition('avoid'); return; }
    this.disturbed = true; this.nature.dolphinDisturbances++;
    const fast = reason === 'high-speed pass';
    this.game.tricks?.bust?.('WILDLIFE'); this.audio?.warn?.();
    this.game.toast('Pod diving', fast ? 'High-speed pass reported to FWC.' : 'Break off. Do not chase or circle them.', 3.1);
    this.law?.add?.(fast ? 0.62 : 0.45, `marine mammal harassment · ${reason}`, false);
    this.reputation?.change?.('fwc', fast ? -0.38 : -0.26, 'dolphin-harassment', 'FWC logged the tower boat crowding a dolphin pod.', false);
    this.game.persist(); this.transition('avoid');
  }

  strike(animal) {
    if (this.strikeCd > 0 || animal.strikeT > 0) return;
    const p = this.phys, dx = p.pos.x - animal.x, dz = p.pos.y - animal.z, d = Math.hypot(dx, dz) || 1;
    this.strikeCd = 18; animal.strikeT = 18; this.disturbed = true; this.nature.dolphinStrikes++; this.nature.dolphinDisturbances++;
    p.hit = Math.max(p.hit, 4.6); p.hitNormal.set(dx / d, dz / d); p.hitTag = 'dolphin'; p.hitObj = animal; p.vel.multiplyScalar(0.8);
    p.vy = Math.max(p.vy, 0.8); p.rollVel += (this.rand() < 0.5 ? -1 : 1) * 1.6; p.angVel += (this.rand() - 0.5) * 1.1;
    this.game.tricks?.bust?.('WILDLIFE'); this.audio?.thud?.(1.3); this.game.shake = Math.min(1, this.game.shake + 0.62);
    this.game.toast('Dolphin strike', 'Kill the throttle. FWC needs the position.', 3.5);
    this.law?.add?.(1.55, 'protected dolphin strike', false);
    this.reputation?.change?.('fwc', -1.05, 'dolphin-strike', 'A dolphin strike went into the FWC file.', true);
    this.game.persist(); this.transition('avoid');
  }

  moveToward(x, z, targetSpeed, turnRate, dt) {
    const desired = Math.atan2(-(x - this.x), -(z - this.z)), delta = wrapAngle(desired - this.heading);
    this.heading += clamp(delta, -turnRate * dt, turnRate * dt);
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt * 1.8));
    this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading));
    this.x += this._podFwd.x * this.speed * dt; this.z += this._podFwd.y * this.speed * dt;
  }

  travel(dt) {
    this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading));
    const aheadX = this.x + this._podFwd.x * 24, aheadZ = this.z + this._podFwd.y * 24;
    if (!this.suitable(aheadX, aheadZ, this.regionAtFn(this.x, this.z).id)) this.heading += this.side * dt * 0.62;
    this.speed += (3.8 - this.speed) * (1 - Math.exp(-dt));
    this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading));
    this.x += this._podFwd.x * this.speed * dt; this.z += this._podFwd.y * this.speed * dt;
  }

  surfaceBurst(animal) {
    if (this.surfaceSoundT <= 0) { this.audio?.splash?.(0.2); this.surfaceSoundT = 0.8; }
    for (let i = 0; i < 4; i++) this.plume?.emit?.(animal.x + (this.rand() - 0.5) * 0.35, animal.y + 0.2, animal.z + (this.rand() - 0.5) * 0.35, (this.rand() - 0.5) * 0.3, 0.35 + this.rand() * 0.45, (this.rand() - 0.5) * 0.3, 0.12 + this.rand() * 0.08, 0.35, 0.45, 0.12);
    for (let i = 0; i < 10; i++) this.spray?.emit?.(animal.x, animal.y + 0.12, animal.z, (this.rand() - 0.5) * 1.2, 0.45 + this.rand() * 1.1, (this.rand() - 0.5) * 1.2, 0.01 + this.rand() * 0.014, 0.28 + this.rand() * 0.25, 0.38);
  }

  updateAnimals(dt, time) {
    this.wakePool.reset(); this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading)); this._boatRight.set(-this._podFwd.y, this._podFwd.x);
    const dive = this.state === 'avoid' || this.state === 'depart';
    for (let i = 0; i < this.animals.length; i++) {
      const animal = this.animals[i], slot = animal.slot;
      const weave = Math.sin(time * 0.56 + slot.phase * 12) * 0.42;
      animal.x = this.x + this._boatRight.x * (slot.side + weave) - this._podFwd.x * slot.back;
      animal.z = this.z + this._boatRight.y * (slot.side + weave) - this._podFwd.y * slot.back;
      const waterY = this.water.waveHeight(animal.x, animal.z, time), cycle = fract(time * (this.state === 'ride' ? 0.19 : 0.13) + slot.phase);
      const arc = Math.sin(Math.PI * smooth(0.04, 0.7, cycle)) * (1 - smooth(0.72, 0.94, cycle));
      const depth = dive ? -2.25 - i * 0.12 : -1.32 + arc * (this.state === 'ride' ? 1.72 : 1.48);
      animal.y += (waterY + depth - animal.y) * (1 - Math.exp(-dt * (dive ? 3.2 : 5.5)));
      animal.surfaced = !dive && animal.y > waterY - 0.42;
      const pitch = dive ? 0.18 : Math.cos(Math.PI * clamp(cycle / 0.72)) * arc * 0.28;
      const roll = Math.sin(time * 1.15 + slot.phase * 17) * 0.055;
      animal.group.position.set(animal.x, animal.y, animal.z); animal.group.rotation.set(pitch, this.heading, roll, 'YXZ');
      animal.tail.rotation.x = Math.sin(time * (8.5 + this.speed * 0.65) + slot.phase * 19) * (0.18 + Math.min(0.18, this.speed * 0.018));
      animal.strikeT = Math.max(0, animal.strikeT - dt);
      if (animal.surfaced && !animal.wasSurfaced) this.surfaceBurst(animal);
      if (animal.surfaced) this.wakePool.emit(animal.x + this._podFwd.x * 0.8, animal.z + this._podFwd.y * 0.8, 0.65, -0.09, 0.1, 0.9);
      animal.wasSurfaced = animal.surfaced;
    }
  }

  update(dt, time, enabled = true) {
    this.wakePool.reset();
    if (!enabled) return;
    this.surfaceSoundT = Math.max(0, this.surfaceSoundT - dt); this.strikeCd = Math.max(0, this.strikeCd - dt);
    if (!this.active) {
      this.cooldown = Math.max(0, this.cooldown - dt); this.spawnCheckT -= dt;
      if (this.cooldown <= 0 && this.spawnCheckT <= 0) {
        this.spawnCheckT = 6 + this.rand() * 5;
        const potential = this.potentialAt(this.phys.pos.x, this.phys.pos.y);
        if (!this.blocked() && this.rand() < potential * 0.035) this.spawn();
      }
      return;
    }

    this.stateT += dt; this.activeT += dt;
    const values = this.environment.values || {};
    if ((values.storm || 0) > 0.62 || (values.wind || 0) * (this.environment.gust || 1) > 17 || this.blocked()) this.transition('depart');
    if (this.activeT > 78 && this.state !== 'depart') this.transition('depart');

    this.phys.forward(this._boatFwd); this.phys.right(this._boatRight);
    const dx = this.x - this.phys.pos.x, dz = this.z - this.phys.pos.y, distance = Math.hypot(dx, dz) || 0.001;
    this._toPod.set(dx / distance, dz / distance); this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading));
    const closing = Number.isFinite(this.prevDistance) ? clamp((this.prevDistance - distance) / Math.max(dt, 0.001), -20, 20) : 0;
    const aiming = this._boatFwd.dot(this._toPod);
    if (this.state === 'travel' && distance < 90 && aiming > 0.9 && closing > 0.7 && Math.abs(this.phys.angVel || 0) > 0.075) this.pursuitT += dt;
    else this.pursuitT = Math.max(0, this.pursuitT - dt * 0.8);
    this.prevDistance = distance;

    const input = this._responseInput;
    input.state = this.state; input.distance = distance; input.boatSpeed = this.phys.speed; input.turnRate = this.phys.angVel || 0;
    input.headingAlignment = this._boatFwd.dot(this._podFwd); input.pursuitSeconds = this.pursuitT;
    const response = dolphinVesselResponse(input);
    if (response === 'avoid' && this.state !== 'avoid' && this.state !== 'depart') {
      const reason = this.pursuitT > 2.8 ? 'vessel pursuit' : this.phys.speed > 10.5 ? 'high-speed pass' : 'close circling';
      this.disturb(reason);
    }

    if (this.state === 'travel') {
      this.travel(dt);
      if (response === 'approach' && this.stateT > 2.2) { this.transition('approach'); this.game.toast('Pod turning in', 'Hold speed and heading. Let them choose the distance.', 2.8); }
    } else if (this.state === 'approach') {
      const bow = 12.5, side = 4 * this.side;
      const targetX = this.phys.pos.x + this._boatFwd.x * bow + this._boatRight.x * side;
      const targetZ = this.phys.pos.y + this._boatFwd.y * bow + this._boatRight.y * side;
      this.moveToward(targetX, targetZ, clamp(this.phys.speed + 1.4, 3.2, 8.8), 1.05, dt);
      if (response === 'approach') this.unsteadyT = Math.max(0, this.unsteadyT - dt * 2); else this.unsteadyT += dt;
      if (distance < 15 && input.headingAlignment > 0.42 && response === 'approach') {
        this.transition('ride'); this.game.toast('Dolphins at the bow', 'Ease back. Let them leave on their own.', 3.2);
      } else if (this.unsteadyT > 4) this.transition('depart');
    } else if (this.state === 'ride') {
      const bow = 11.5, side = 3 * this.side;
      const targetX = this.phys.pos.x + this._boatFwd.x * bow + this._boatRight.x * side;
      const targetZ = this.phys.pos.y + this._boatFwd.y * bow + this._boatRight.y * side;
      this.moveToward(targetX, targetZ, clamp(this.phys.speed + 0.35, 2.8, 8.8), 1.3, dt);
      if (response === 'ride') { this.rideT += dt; this.unsteadyT = Math.max(0, this.unsteadyT - dt * 2); }
      else { this.rideT = Math.max(0, this.rideT - dt * 0.5); this.unsteadyT += dt; }
      if (this.rideT >= 6) this.logRide();
      if (this.stateT > 18 || this.unsteadyT > 3.5) this.transition('depart');
    } else if (this.state === 'avoid') {
      this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading)); this.speed += (8.6 - this.speed) * (1 - Math.exp(-dt * 2));
      this.x += this._podFwd.x * this.speed * dt; this.z += this._podFwd.y * this.speed * dt;
      if (this.stateT > 4.5) this.transition('depart');
    } else if (this.state === 'depart') {
      this._podFwd.set(-Math.sin(this.heading), -Math.cos(this.heading)); this.speed += (7.2 - this.speed) * (1 - Math.exp(-dt));
      this.x += this._podFwd.x * this.speed * dt; this.z += this._podFwd.y * this.speed * dt;
      if (distance > 300 || this.stateT > 24) { this.finish(); return; }
    }

    this.updateAnimals(dt, time);
    if (!this.sighted && distance < 155) this.sight();
    if (this.state !== 'avoid' && this.state !== 'depart' && !this.nearMissed && distance < 13 && this.phys.speed > 9.2) { this.nearMissed = true; this.disturb('high-speed pass'); }
    if (this.phys.speed > 2.8 && !this.phys.airborne) for (const animal of this.animals) {
      const waterY = this.water.waveHeight(animal.x, animal.z, time);
      if (animal.y > waterY - 1.25 && Math.hypot(animal.x - this.phys.pos.x, animal.z - this.phys.pos.y) < 2.35) { this.strike(animal); break; }
    }
  }

  stamps(out) { this.wakePool.appendTo(out); }

  resourceStats() {
    return { active: this.active, state: this.state, animals: this.animals.length, meshes: this.animals.length * 2, geometries: 2, materials: 1, vertices: this.vertices, geometryBytes: this.geometryBytes, wakeActive: this.wakePool.count, wakeCapacity: this.wakePool.capacity, wakeDroppedTotal: this.wakePool.droppedTotal };
  }

  dispose() {
    this.root.removeFromParent(); this.bodyGeometry.dispose(); this.tailGeometry.dispose(); this.material.dispose();
  }
}
