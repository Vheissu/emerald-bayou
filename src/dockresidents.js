import * as THREE from 'three';
import { RESIDENT_ROUTINE } from './residentroutines.js';
import { DOCK_SHELTER } from './tower.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, value) => THREE.MathUtils.smoothstep(value, a, b);
const transform = new THREE.Quaternion();
const axis = new THREE.Vector3(0, 0, 1);

export function dockShelterPath(dock, person, side) {
  const feet = person.getWorldPosition(new THREE.Vector3());
  const onDeck = dock.worldToLocal(feet.clone());
  // Ease away from the rail before following the middle of the walkway.
  const lane = side * 0.16;
  const { deck, entryZ, berthZ, berthX } = DOCK_SHELTER;
  const shift = dock.userData.dockShelter?.position.z ?? 0;
  return [feet, dock.localToWorld(new THREE.Vector3(lane, deck, onDeck.z + 0.38)),
    dock.localToWorld(new THREE.Vector3(lane, deck, entryZ + shift)),
    dock.localToWorld(new THREE.Vector3(side * berthX, deck, berthZ - side * 0.42 + shift))];
}

export function attachLandingResident(dock, person, terrain, side, { hoist = false } = {}) {
  if (dock.userData.dockShelter) return attachDockResident(person, dockShelterPath(dock, person, side), { hoist });

  const origin = person.getWorldPosition(new THREE.Vector3());
  const foot = dock.worldToLocal(origin.clone());
  const target = foot.clone();
  target.x = side * 0.16;
  target.z += 0.27;
  const sample = new THREE.Vector3();
  let clear = true;
  for (const t of [0, 0.5, 1]) {
    for (const shoe of [-0.13, 0.13]) {
      sample.lerpVectors(foot, target, t);
      sample.x += shoe;
      dock.localToWorld(sample);
      clear &&= terrain.heightAt(sample.x, sample.z) <= sample.y + 0.025;
    }
  }
  const step = clear ? dock.localToWorld(target) : origin;
  return attachDockResident(person, [origin, step], { hoist, hasShelter: false });
}

export function attachDockResident(person, path, { hoist = false, hasShelter = true } = {}) {
  const origin = path[0], points = path.map(point => person.parent.worldToLocal(point.clone()));
  const metres = [0];
  for (let i = 1; i < points.length; i++) metres.push(metres[i - 1] + points[i - 1].distanceTo(points[i]));
  person.parent.getWorldQuaternion(transform);
  const heading = axis.clone().applyQuaternion(transform);
  const seed = person.userData.seed ?? 0.5;
  const reaction = {
    state: 'idle', reason: '', age: 0, facing: 0, gait: 0, grip: 1, rest: 1, sit: 1, distanceWalked: 0,
    ready: false, distance: 0, total: metres.at(-1), position: origin.clone(), yaw: person.rotation.y,
    parentYaw: Math.atan2(heading.x, heading.z), points, metres,
    arrival: false, visited: false, away: 0, recovery: 0, dry: 0, seed, hoist, hasShelter,
  };
  person.userData.dockReaction = reaction;
  return reaction;
}

function enter(state, type, reason = state.reason) {
  if (state.state === type && state.reason === reason) return;
  state.state = type;
  state.reason = reason;
  state.age = 0;
}

function move(person, state, target, dt, pace = 1) {
  const old = state.distance;
  const step = Math.min(0.05, dt) * pace;
  state.distance = old + clamp(target - old, -step, step);
  const delta = state.distance - old;
  state.distanceWalked += Math.abs(delta);
  state.gait = THREE.MathUtils.lerp(state.gait, Math.abs(delta) > 0.001 ? 1 : 0, -Math.expm1(-dt * 9));
  const distances = state.metres, p = state.points;
  let i = 1;
  while (i < distances.length - 1 && distances[i] < state.distance) i++;
  const fraction = (state.distance - distances[i - 1]) / Math.max(0.001, distances[i] - distances[i - 1]);
  person.position.lerpVectors(p[i - 1], p[i], fraction);
  const turnRate = -Math.expm1(-dt * 9);
  let face = state.yaw;
  if (Math.abs(state.distance - target) > 0.02 || Math.abs(delta) > 0.025) {
    const dir = target < old || delta < 0 ? -1 : 1;
    face = Math.atan2((p[i].x - p[i - 1].x) * dir, (p[i].z - p[i - 1].z) * dir);
  } else if (state.state === 'sheltered') face = Math.atan2((p[i].x - p[i - 1].x), (p[i].z - p[i - 1].z)) + Math.PI;
  const turn = face - person.rotation.y;
  person.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * turnRate;
  state.facing = person.rotation.y + state.parentYaw;
}

function closeLine(user) {
  if (!user.line) return;
  user.line.visible = false;
  user.lineOn = 0;
  user.reelT = 0;
  user.biteT = 0;
  user.tug = 0;
  user.castCd = 3 + (user.seed || 0) * 5;
}

export function updateDockResident(person, dt, boat) {
  const user = person.userData, state = user.dockReaction;
  const { routineDesired, routineWeather } = user;
  if (routineDesired === undefined || dt <= 0) return;

  const dx = state.position.x - boat.x, dz = state.position.z - boat.z;
  const distance = Math.hypot(dx, dz);
  const closing = distance > 0.2 ? (dx * boat.vx + dz * boat.vz) / distance : 0;
  const closeEnoughToSee = distance < 90;
  const inside = routineDesired === RESIDENT_ROUTINE.INSIDE;
  const heavyWeather = inside && routineWeather === 'storm';
  const hunker = heavyWeather && !state.hasShelter;
  const weatherBrace = routineDesired === RESIDENT_ROUTINE.BRACE;
  const reason = routineWeather || 'shift';

  if (!state.ready || !closeEnoughToSee) {
    state.ready = true;
    if (!closeEnoughToSee) {
      const settledState = inside ? (hunker ? 'brace' : 'sheltered') : 'idle';
      if (state.state !== settledState || (inside && state.reason !== reason)) {
        enter(state, settledState, inside ? reason : '');
        state.distance = inside ? state.total : 0;
        move(person, state, state.distance, dt);
        closeLine(user);
      }
      state.arrival = false; state.visited = false; state.away = 0;
      state.rest = inside && state.total > 0.02 ? 0 : 1; state.sit = state.rest; state.grip = inside ? 0 : 1;
      user.routineState = hunker ? RESIDENT_ROUTINE.BRACE : routineDesired;
      person.visible = !inside || heavyWeather;
      return;
    }
  }

  state.age += dt;
  state.away = distance > 65 ? state.away + dt : 0;
  if (state.away > 2) { state.visited = false; state.arrival = false; }
  const visit = !state.visited && distance < 62 && closing > 0.4 && boat.speed > 0.6;
  if (visit) state.arrival = true;
  const dangerousWake = distance < 28 && (Math.abs(boat.wake) > 0.10 || (boat.speed > 4.7 && closing > 1.4));
  state.recovery = dangerousWake ? 0 : state.recovery + dt;

  // Severe conditions secure the gear in place first. Nobody changes decks until
  // they've put the rod up or lifted the crab pot out of the water.
  if (inside) {
    state.dry = 0;
    if (state.state === 'return') enter(state, hunker ? 'brace' : 'evacuate', reason);
    else if (state.state === 'sheltered') enter(state, hunker ? 'brace' : 'sheltered', reason);
    else if (state.state !== 'evacuate' && state.state !== 'secure'
      && !(hunker && state.state === 'brace' && state.reason === 'storm')) enter(state, 'secure', reason);
  } else if (state.state === 'sheltered' || state.state === 'brace' && state.reason === 'storm') {
    state.dry = weatherBrace ? 0 : state.dry + dt;
    if (state.dry > 4.5 + state.seed * 2) enter(state, 'return');
  } else if (state.state === 'idle' || state.state === 'notice' || state.state === 'greet' || state.state === 'brace') {
    if (dangerousWake || weatherBrace) {
      state.visited ||= dangerousWake;
      enter(state, 'brace', dangerousWake ? 'wake' : 'wind');
    } else if (state.state === 'brace' && state.recovery > 1.1) {
      enter(state, state.distance > 0.025 ? 'return' : 'idle', '');
    } else if (state.state === 'idle' && visit) enter(state, 'notice', 'arrival');
    else if (state.state === 'notice') {
      if (state.arrival && !state.visited && state.age > 0.58 && distance < 18 && boat.speed < 3.25 && closing > -0.9) {
        state.visited = true;
        enter(state, 'greet', 'arrival');
      } else if (distance > 66 || state.age > 10) enter(state, 'idle', '');
    } else if (state.state === 'greet' && (state.age >= 2.65 || distance > 26)) enter(state, 'idle', '');
  }

  let rest = 1, target = 0, pace = 1.35;
  const brace = state.state === 'brace', secure = state.state === 'secure';
  if (secure) {
    const delay = state.hoist ? 2.6 : user.rod ? 1.45 : 0.7;
    rest = 1 - smooth(delay - 0.55, delay, state.age);
    if (state.age > delay + state.seed * 0.55) {
      const waitOnDeck = !state.hasShelter && state.reason === 'storm';
      enter(state, waitOnDeck ? 'brace' : 'evacuate');
      closeLine(user);
    }
  }
  if (state.state === 'evacuate') {
    target = state.total; pace = 1.72; rest = 0;
    if (state.distance >= target - 0.002) enter(state, 'sheltered');
  }
  if (state.state === 'sheltered') { target = state.total; rest = 0; }
  if (state.state === 'return') {
    rest = 1 - smooth(0.04, 0.90, state.distance);
    if (state.distance <= 0.002 && state.age > 0.28) enter(state, 'idle', '');
  }
  if (brace && state.reason === 'wake') {
    rest = 1 - smooth(0.05, 0.60, state.age);
    target = smooth(0.45, 1.20, state.age) * Math.min(state.total, 0.90 + state.seed * 0.12);
  }
  if (state.state === 'brace' && state.reason === 'storm' && state.total > 0.02) {
    rest = 1 - smooth(0, 0.42, state.age);
    target = smooth(0.32, 0.90, state.age) * state.total;
  }
  move(person, state, target, dt, pace);
  state.rest = rest;
  state.sit = rest;
  state.grip = secure && state.hoist ? 1 - smooth(1.55, 2.45, state.age) : state.state === 'idle' || state.state === 'notice' ? 1 : 0;
  user.routineState = state.state === 'sheltered' ? RESIDENT_ROUTINE.INSIDE
    : secure || state.state === 'brace' || state.state === 'evacuate' ? RESIDENT_ROUTINE.BRACE
      : state.state === 'greet' || state.state === 'notice' ? RESIDENT_ROUTINE.WATCH : RESIDENT_ROUTINE.OUTSIDE;
  person.visible = state.state !== 'sheltered' || state.reason === 'storm';
}

const input = { x: 0, z: 0, vx: 0, vz: 0, speed: 0, wake: 0 };

export function updateDockResidents(group, time, context) {
  if (!context.residentDt || !group.userData.dockResidents) return;
  input.x = context.bx; input.z = context.bz; input.vx = context.vx; input.vz = context.vz; input.speed = context.speed;
  for (const person of group.userData.dockResidents) {
    const state = person.userData.dockReaction;
    const distance = Math.hypot(state.position.x - input.x, state.position.z - input.z);
    input.wake = distance < 28 ? context.playerWakeAt?.(state.position.x, state.position.z, time) || 0 : 0;
    updateDockResident(person, context.residentDt, input);
  }
}

export function dockCastAllowed(person) {
  const user = person.userData, reaction = user.dockReaction;
  if (!reaction || reaction.state === 'idle' || reaction.state === 'notice' || reaction.state === 'greet') return true;
  if (reaction.state !== 'secure' || reaction.age >= 1.24) closeLine(user);
  if (user.act === 'cast' || user.act === 'reel') {
    user.act = 'hold'; user.actT = 0; user.actDur = 1.8;
  }
  return false;
}
