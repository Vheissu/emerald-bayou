import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cachedResource } from './cache.js';
import { person } from './folk.js';
import { mulberry32 } from './noise.js';
import { RESIDENT_ROUTINE } from './residentroutines.js';
import { registerWetMaterial } from './surfacewetness.js';

const geometry = new Map();
const gearMaterial = registerWetMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76 }));
const ropeMaterial = registerWetMaterial(new THREE.MeshStandardMaterial({ color: 0x9c8157, roughness: 0.94 }));
const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);
const deck = 0.81, fairlead = 2.38, winchHeight = 1.99;
const smooth = THREE.MathUtils.smoothstep;

function bake(make) {
  const parts = [], colour = new THREE.Color();
  const add = (geo, tint, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
    colour.setHex(tint);
    const positions = geo.getAttribute('position'), colours = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) colour.toArray(colours, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(geo);
  };
  make(
    (w, h, d, tint, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), tint, x, y, z, rx, ry, rz),
    (a, b, h, tint, x, y, z, rx, ry, rz) => add(new THREE.CylinderGeometry(a, b, h, 8), tint, x, y, z, rx, ry, rz),
    (r, tube, tint, x, y, z, rx, ry, rz) => add(new THREE.TorusGeometry(r, tube, 5, 16), tint, x, y, z, rx, ry, rz),
  );
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function wirePot(box, cylinder, ring, x = 0, y = 0, z = 0) {
  const steel = 0x717874, rust = 0x655241;
  for (const edge of [-0.32, 0.32]) {
    for (const height of [-0.16, 0.18]) {
      box(0.65, 0.028, 0.025, steel, x, y + height, z + edge);
      box(0.025, 0.028, 0.65, rust, x + edge, y + height, z);
    }
    for (let i = -3; i <= 3; i++) {
      const offset = i * 0.104;
      box(0.014, 0.35, 0.014, steel, x + offset, y + 0.015, z + edge);
      box(0.014, 0.35, 0.014, rust, x + edge, y + 0.015, z + offset);
    }
    for (const height of [-0.042, 0.065]) {
      box(0.64, 0.013, 0.013, rust, x, y + height, z + edge);
      box(0.013, 0.013, 0.64, steel, x + edge, y + height, z);
    }
  }
  for (let i = -3; i <= 3; i++) {
    box(0.016, 0.014, 0.64, steel, x + i * 0.104, y + 0.18, z);
    box(0.64, 0.014, 0.015, rust, x, y + 0.185, z + i * 0.104);
    box(0.015, 0.014, 0.63, rust, x + i * 0.104, y - 0.16, z);
  }
  ring(0.048, 0.011, steel, x, y + 0.26, z);
  cylinder(0.075, 0.075, 0.19, 0xb55e2f, x + 0.18, y - 0.07, z, 0, 0, Math.PI / 2);
}

function baitBasket(box, cylinder, ring, x = 0, y = 0, z = 0) {
  const net = 0x637365, rim = 0xadb6a3;
  ring(0.34, 0.029, rim, x, y + 0.16, z, Math.PI / 2);
  ring(0.27, 0.019, net, x, y - 0.18, z, Math.PI / 2);
  ring(0.3, 0.012, net, x, y - 0.015, z, Math.PI / 2);
  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2, sideX = Math.sin(angle), sideZ = Math.cos(angle);
    cylinder(0.008, 0.012, 0.36, net, x + 0.3 * sideX, y, z + 0.3 * sideZ, 0.19 * sideZ, 0, -0.19 * sideX);
  }
  cylinder(0.27, 0.24, 0.055, net, x, y - 0.19, z);
  box(0.61, 0.026, 0.026, rim, x, y + 0.19, z);
  ring(0.053, 0.011, rim, x, y + 0.25, z);
}

function campStation(box, cylinder, ring, bait) {
  const metal = 0xa4a79b, steel = 0x485352, rust = 0x7e4e32, timber = 0x7c6850;
  box(0.31, 0.077, 0.32, rust, 0, deck + 0.01, 0);
  box(0.1, fairlead - deck, 0.105, metal, 0, (deck + fairlead) * 0.5, 0);
  box(0.10, 0.10, 0.86, metal, 0, fairlead, 0.40);
  box(0.078, 0.065, 0.53, steel, 0, fairlead - 0.22, 0.20, -0.83);
  box(0.045, 0.19, 0.14, rust, -0.064, fairlead - 0.035, 0.76);
  box(0.045, 0.19, 0.14, rust, 0.064, fairlead - 0.035, 0.76);
  cylinder(0.062, 0.062, 0.19, steel, 0, fairlead - 0.04, 0.76, 0, 0, Math.PI / 2);
  box(0.29, 0.26, 0.22, rust, 0, winchHeight - 0.03, -0.09);
  cylinder(0.13, 0.13, 0.29, steel, 0, winchHeight, -0.21, 0, 0, Math.PI / 2);
  for (const x of [-0.13, 0.13]) cylinder(0.15, 0.15, 0.028, metal, x, winchHeight, -0.21, 0, 0, Math.PI / 2);
  cylinder(0.013, 0.013, 0.42, timber, 0.028, 2.21, -0.16, 0.31);
  cylinder(0.013, 0.013, 0.84, timber, 0.028, fairlead + 0.06, 0.35, Math.PI / 2);
  ring(0.14, 0.025, timber, 0.31, deck + 0.02, -0.28, Math.PI / 2);
  ring(0.109, 0.021, timber, 0.31, deck + 0.02, -0.28, Math.PI / 2);
  // Spare gear fits between the rails alongside the work position.
  if (!bait) {
    wirePot(box, cylinder, ring, 0.82, deck + 0.16, -0.45);
    wirePot(box, cylinder, ring, 1.16, deck + 0.51, -0.43);
    return;
  }
  baitBasket(box, cylinder, ring, 0.75, deck + 0.2, -0.47);
  box(0.55, 0.3, 0.64, 0x496b62, 1.52, deck + 0.15, -0.45);
  box(0.58, 0.06, 0.65, 0x799283, 1.52, deck + 0.29, -0.45);
  for (const x of [1.37, 1.67]) box(0.038, 0.28, 0.021, steel, x, deck + 0.18, -0.12);
}

export function buildCampWork(dock, site, skiffSide, terrain) {
  const random = mulberry32(site.seed ^ 0x276ba3e1);
  const bait = random() > 0.48;
  const side = -skiffSide;
  const rig = new THREE.Group();
  rig.name = bait ? 'Bait station' : 'Crab-pot station';
  rig.position.set(side * 0.85, 0, -9.45);
  rig.rotation.y = side * Math.PI / 2;
  dock.add(rig);
  const station = new THREE.Mesh(cachedResource(geometry, rig.name, () => bake((box, cylinder, ring) => campStation(box, cylinder, ring, bait))), gearMaterial);
  const cargo = new THREE.Mesh(cachedResource(geometry, bait ? 'bait basket' : 'crab pot', () => bake(bait ? baitBasket : wirePot)), gearMaterial);
  const drum = new THREE.Group();
  const crank = new THREE.Mesh(cachedResource(geometry, 'hoist crank', () => bake((box, cylinder, ring) => {
    ring(0.19, 0.021, 0x999b8f, 0, 0, 0, 0, Math.PI / 2);
    box(0.034, 0.38, 0.027, 0x485352, 0, 0, 0);
    cylinder(0.032, 0.032, 0.12, 0x63543b, 0.054, 0.16, 0, 0, 0, Math.PI / 2);
  })), gearMaterial);
  drum.position.set(0.16, winchHeight, -0.21);
  drum.add(crank);
  const rope = new THREE.Mesh(cachedResource(geometry, 'hoist rope', () => new THREE.CylinderGeometry(0.013, 0.013, 1, 6)), ropeMaterial);
  const worker = person(random, { pose: 'stand', work: true });
  const actor = new THREE.Group();
  worker.position.set(0.027, deck, -0.55);
  actor.add(worker);
  rig.add(station, drum, cargo, rope, actor);
  cargo.position.set(0, 1.34, 0.76);
  const waterPoint = rig.localToWorld(new THREE.Vector3(0, 0, 0.76));
  const work = { actor, worker, cargo, drum, rope, x: waterPoint.x, z: waterPoint.z,
    bed: terrain.heightAt(waterPoint.x, waterPoint.z), phase: 0.7 + random() * 2, splashCd: 0, parked: true,
    line: new THREE.Vector3(), stormHold: 0, y: cargo.position.y };
  setRope(work);
  return work;
}

function setRope(work) {
  const { cargo, rope, line } = work;
  line.set(cargo.position.x, cargo.position.y + 0.26 - fairlead, cargo.position.z - 0.76);
  rope.position.set(line.x * 0.5, fairlead + line.y * 0.5, 0.76 + line.z * 0.5);
  rope.scale.y = line.length();
  rope.quaternion.setFromUnitVectors(up, line.normalize());
}

export function campWorkStep(work, dt, water, wake, distance, speed, routine, wind, active) {
  const unsafe = routine === RESIDENT_ROUTINE.BRACE || wind > 1.8 || Math.abs(wake) > 0.09 || (distance < 31 && speed > 5.7);
  work.stormHold = unsafe ? 3.5 : Math.max(0, work.stormHold - dt);
  const canWork = active && routine !== RESIDENT_ROUTINE.INSIDE && work.stormHold <= 0 && water > work.bed + 0.31;
  work.parked = !canWork;
  work.phase = canWork ? (work.phase + dt) % 12 : 0;
  const dip = smooth(work.phase, 0.5, 3.7) * (1 - smooth(work.phase, 5.3, 9.4));
  const parkedHeight = Math.min(fairlead - 0.42, Math.max(1.34, water + 0.42));
  const dippedHeight = Math.max(work.bed + 0.22, water - 0.24);
  work.y += (THREE.MathUtils.lerp(parkedHeight, dippedHeight, dip) - work.y) * (1 - Math.exp(-dt * 2.7));
}

export function updateCampWork(work, time, waveAt, wind, context) {
  const distance = Math.hypot(work.x - context.bx, work.z - context.bz);
  work.actor.visible = distance <= 165;
  if (!work.actor.visible) return;

  const dt = context.dt, wake = context.playerWakeAt?.(work.x, work.z, time) || 0;
  const water = waveAt(work.x, work.z, time);
  const oldHeight = work.y, gust = wind?.y || 0;
  const { worker, cargo, drum } = work;
  const reaction = worker.userData.dockReaction;
  const gripWeight = reaction?.grip ?? 1;
  campWorkStep(work, dt, water, wake, distance, context.speed, worker.userData.routineState, gust,
    worker.visible && context.humanActivity > 0.14 && (!reaction || reaction.state === 'idle' || reaction.state === 'notice'));
  const delta = work.y - oldHeight;
  const swing = Math.min(0.15, 0.025 * gust + Math.abs(wake) * 0.55 + Math.abs(delta) * 0.55);
  cargo.position.set(Math.sin(time * 2.1 + work.x) * swing, work.y, 0.76 + Math.cos(time * 1.7 + work.z) * swing);
  cargo.rotation.set(Math.sin(time * 1.7 + work.z) * swing * 1.5, 0, Math.sin(time * 2.1 + work.x) * swing * 1.7);
  drum.rotation.x -= delta * 8;
  worker.userData.hoistAngle = drum.rotation.x;
  // Keep a hand on the rim between turns and while hauling the load out. Release
  // once it is secured, or when the operator leaves the working position.
  const grip = (work.parked ? smooth(Math.abs(delta) / Math.max(0.001, dt), 0.016, 0.13) : 1) * gripWeight;
  worker.userData.hoistGrip = THREE.MathUtils.lerp(worker.userData.hoistGrip || 0, grip, 1 - Math.exp(-dt * 9));
  setRope(work);

  work.splashCd -= dt;
  const corner = water + wake + 0.08;
  if (work.splashCd <= 0 && (oldHeight - corner) * (work.y - corner) < 0) {
    work.splashCd = 2;
    context.emitStamp?.(work.x, work.z, 0.46, 0.085, 0.18, 0.36);
    if (distance < 48) context.audio?.plip(0.34 * (1 - distance / 48), work.x, work.z);
  }
}

const goal = new THREE.Vector3(), aim = new THREE.Vector3(), elbow = new THREE.Vector3();
const upperTarget = new THREE.Quaternion(), foreTarget = new THREE.Quaternion(), inverse = new THREE.Quaternion();
const gripFrame = new THREE.Quaternion(), wristRoll = new THREE.Quaternion(), crankAxis = new THREE.Vector3(1, 0, 0);
export function poseCampWorker(work) {
  const { worker, drum, actor } = work;
  const grip = worker.userData.hoistGrip;
  if (!actor.visible || !worker.visible || !(grip > 0.01)) return;
  const { upper, fore, hand } = worker.userData.arms[1];
  const spine = upper.parent;
  // Solve the two arm lengths in spine space so the worker follows the actual crank handle.
  drum.parent.getWorldQuaternion(gripFrame);
  gripFrame.multiply(wristRoll.setFromAxisAngle(crankAxis, -0.20 + Math.sin(drum.rotation.x) * 0.24));
  drum.localToWorld(goal.set(0.054, 0.16, 0));
  goal.add(aim.set(0, 0.023, -0.012).applyQuaternion(gripFrame));
  spine.worldToLocal(goal);
  goal.sub(upper.position);
  const arm = -fore.position.y, forearm = -hand.position.y;
  const distance = THREE.MathUtils.clamp(goal.length(), Math.abs(arm - forearm) + 0.001, arm + forearm - 0.001);
  aim.copy(goal).normalize(); goal.copy(aim).multiplyScalar(distance);
  const along = (distance * distance + arm * arm - forearm * forearm) / (2 * distance);
  elbow.set(0.42, -1, 0);
  elbow.addScaledVector(aim, -elbow.dot(aim)).normalize().multiplyScalar(Math.sqrt(Math.max(0, arm * arm - along * along)));
  elbow.addScaledVector(aim, along);
  upperTarget.setFromUnitVectors(down, aim.copy(elbow).normalize());
  goal.sub(elbow).applyQuaternion(inverse.copy(upperTarget).invert()).normalize();
  foreTarget.setFromUnitVectors(down, goal);
  upper.quaternion.slerp(upperTarget, grip);
  fore.quaternion.slerp(foreTarget, grip);
  // The handle turns on a horizontal pin. Keep the knuckles along that pin
  // as the elbow changes direction instead of rolling the palm through the crank.
  fore.getWorldQuaternion(inverse).invert();
  hand.quaternion.slerp(inverse.multiply(gripFrame), grip);
}
