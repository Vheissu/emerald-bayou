import * as THREE from 'three';
import { animatePerson } from './folk.js';
import { PAIL_HANDLE, TOTE_HANDLES } from './skiffdockgear.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);
const neutral = new THREE.Quaternion();
const curve = (v, low, high) => smoothstep(v, low, high);

const seats = { helm: [-.21, .064, 1.23], angler: [.02, .073, -.95] };
const standing = {
  hy: .87, hx: 0, hRx: 0, hRy: 0, hRz: 0, sx: .05, sy: 0, sz: 0,
  hdx: .02, hdy: 0, lf: .14, le: .43, lo: .19, rf: .14, re: .43, ro: .19,
  ltf: 0, lk: .13, lto: .09, rtf: 0, rk: .13, rto: .09,
};

const poseChannels = Object.keys(standing);
const actorStates = new WeakMap();
function dockActor(figure, seat) {
  let state = actorStates.get(figure);
  if (!state) {
    const original = { ...figure.userData.base };
    state = {
      figure, rate: figure.userData.rate, original, seatPose: originalSeatPose(original, seat), active: false, initialized: false,
      handCurl: figure.userData.arms.map(({ hand }) => hand.morphTargetInfluences[0]),
      root: new THREE.Vector3(), origin: new THREE.Vector3(), destination: new THREE.Vector3(),
      prior: new THREE.Vector3(), step: figure.userData.ph, effort: 0, yaw: 0, worldRotation: new THREE.Quaternion(),
      fromRotation: new THREE.Quaternion(), toRotation: new THREE.Quaternion(),
      blended: new THREE.Quaternion(), inverse: new THREE.Quaternion(),
    };
    actorStates.set(figure, state);
  }
  return state;
}

function worldAnchor(boat, anchor, output) {
  output.set(anchor.x, anchor.y, anchor.z);
  if (anchor.space === 'boat') boat.mesh.localToWorld(output);
  return output;
}

function orientation(boat, anchor, yaw, output, scratch) {
  output.setFromAxisAngle(up, yaw);
  if (anchor.space === 'boat') output.premultiply(boat.mesh.getWorldQuaternion(scratch));
  return output;
}

const target = new THREE.Vector3(), bend = new THREE.Vector3(), ray = new THREE.Vector3();
const pole = new THREE.Vector3(), elbow = new THREE.Vector3(), forearm = new THREE.Vector3();
const baseRotation = new THREE.Quaternion(), tipRotation = new THREE.Quaternion();
const ankleOffset = new THREE.Vector3(0, 0, .06);

function solveLimb(first, second, point, lengthA, lengthB, bendX, bendZ, weight = 1) {
  first.parent.worldToLocal(ray.copy(point)).sub(first.position);
  const reach = clamp(ray.length(), .035, lengthA + lengthB - .002);
  ray.normalize();
  pole.set(bendX, 0, bendZ).addScaledVector(ray, -pole.dot(ray)).normalize();
  const extension = (reach * reach + lengthA * lengthA - lengthB * lengthB) / (2 * reach);
  const height = Math.sqrt(Math.max(0, lengthA * lengthA - extension * extension));
  elbow.copy(ray).multiplyScalar(extension).addScaledVector(pole, height);
  baseRotation.setFromUnitVectors(down, bend.copy(elbow).normalize());
  forearm.copy(ray).multiplyScalar(reach).sub(elbow).normalize().applyQuaternion(tipRotation.copy(baseRotation).invert());
  tipRotation.setFromUnitVectors(down, forearm);
  first.quaternion.slerp(baseRotation, weight);
  second.quaternion.slerp(tipRotation, weight);
}

function restoreActor(actor, seat) {
  if (!actor.active) return;
  const { figure, original, rate } = actor, rig = figure.userData;
  Object.assign(rig.base, original);
  rig.rate = rate;
  for (const { boot } of rig.legs) boot.quaternion.identity();
  rig.arms.forEach(({ hand }, index) => { hand.morphTargetInfluences[0] = actor.handCurl[index]; });
  if (rig.rod) rig.rod.visible = true;
  figure.position.set(...seat);
  figure.rotation.set(0, Math.PI, 0);
  actor.active = false;
}

function updateBody(boat, actor, cue, dt, time, ctx) {
  const { figure, root, origin, destination, fromRotation, toRotation, inverse, blended, worldRotation } = actor;
  const animating = actor.active, rig = figure.userData;
  worldAnchor(boat, cue.from, origin);
  worldAnchor(boat, cue.to, destination);
  root.lerpVectors(origin, destination, cue.progress);
  const walking = cue.moving && (cue.action === 'walk' || cue.action === 'carry' || cue.action === 'shelter');
  const boarding = cue.action === 'board' || cue.action === 'step-off';
  const sitting = cue.action === 'seat' ? cue.actionProgress
    : cue.action === 'rise' ? 1 - cue.actionProgress : cue.action === 'aboard' ? 1 : 0;
  const reach = cue.action === 'lift' || cue.action === 'lower';
  const crouch = reach ? curve(cue.actionProgress, .04, .43) * (1 - curve(cue.actionProgress, .55, .98)) : 0;
  const gripHeight = cue.reach ? worldAnchor(boat, cue.reach, target).y - root.y : 0;
  const reachDown = 1 - .8 * curve(gripHeight, .18, .86);
  const carried = cue.gear !== 'none';
  const tucking = carried ? .11 : .045;
  const inside = cue.from.space === 'boat' && cue.to.space === 'boat';
  const inStorm = boat.trip.storm;
  const shelter = inStorm && cue.action === 'shelter' && !cue.moving;
  const sorting = cue.action === 'sort';
  if (dt > 0) {
    const distance = animating && walking ? root.distanceTo(actor.prior) : 0;
    actor.step += distance * Math.PI * 2 / 1.22;
    actor.effort = lerp(actor.effort, walking ? clamp(distance / dt / .8, .22, 1) : 0, 1 - Math.exp(-dt * 7));
  }
  actor.prior.copy(root);
  const heading = Number.isFinite(cue.facing) ? cue.facing : 0;
  // A crossing begins looking through the opening. On the last part of a
  // rise or sit the crew faces the bow, exactly as the underway pose does.
  if (boarding) {
    const across = Math.atan2(destination.x - origin.x, destination.z - origin.z);
    fromRotation.setFromAxisAngle(up, across);
    toRotation.copy(fromRotation);
  } else {
    orientation(boat, cue.from, heading, fromRotation, inverse);
    if (cue.from.space === cue.to.space) toRotation.copy(fromRotation);
    else orientation(boat, cue.to, heading, toRotation, inverse);
  }
  blended.copy(fromRotation).slerp(toRotation, cue.progress);
  if (!animating) worldRotation.copy(blended);
  else worldRotation.slerp(blended, -Math.expm1(-dt * (boarding ? 11 : 8)));
  actor.yaw = Math.atan2(2 * (worldRotation.w * worldRotation.y + worldRotation.x * worldRotation.z),
    1 - 2 * (worldRotation.y ** 2 + worldRotation.z ** 2));
  boat.mesh.getWorldQuaternion(inverse).invert();
  figure.quaternion.copy(inverse).multiply(worldRotation);
  figure.position.copy(root);
  boat.mesh.worldToLocal(figure.position);

  actor.active = true;
  if (rig.rod) rig.rod.visible = false;
  figure.visible = Math.hypot(root.x - ctx.bx, root.z - ctx.bz) < 260;
  if (!figure.visible || (dt === 0 && actor.initialized)) return;
  rig.act = 'idle';
  rig.actDur = Infinity;
  rig.rate = 13;
  const stride = Math.sin(actor.step) * actor.effort;
  const pose = rig.base;
  if (rig.rod) pose.rod = Math.PI;
  for (const name of poseChannels) pose[name] = lerp(standing[name], actor.seatPose[name] ?? standing[name], sitting);
  pose.hy -= .39 * crouch * reachDown + (boarding ? .09 : 0) + (shelter ? .045 : 0);
  pose.hy += .019 * actor.effort * Math.sin(actor.step * 2);
  pose.hx += .024 * stride;
  pose.sx += .67 * crouch * reachDown + (boarding ? .17 : tucking) + (shelter ? .16 : 0);
  pose.sz += stride * .036;
  pose.hdx += .38 * crouch + (boarding ? .27 : 0) + (shelter ? -.17 : 0);
  pose.hdy += shelter ? Math.sin(time * 1.25 + rig.ph) * .24 : 0;
  pose.lf += carried ? .38 : stride * .3;
  pose.rf += carried ? .38 : -stride * .3;
  for (const { hand } of rig.arms) hand.morphTargetInfluences[0] = .45;
  if (sorting) {
    pose.sx = .44; pose.hy -= .11; pose.hdx = .37;
    pose.lf = .51; pose.lo = -.01; pose.le = .91;
    pose.rf = .77; pose.ro = .13; pose.re = 1.18;
  }
  if (shelter) {
    pose.lf = 1.06; pose.lo = -.25; pose.le = 1.82;
    pose.rf = .86; pose.ro = -.29; pose.re = 1.93;
  }
  if (!actor.initialized) Object.assign(rig.cur, pose);
  actor.initialized = true;
  animatePerson(figure, time, dt, !walking && !reach && !boarding && !carried && !shelter && !sorting
    ? { x: ctx.bx, z: ctx.bz, speed: ctx.speed } : null);

  // AnimatePerson poses the tubes, then the IK keeps each boot on its
  // support. The stride matches distance travelled, so changing pace does
  // not turn the shore walk into skating.
  const feet = rig.legs;
  if (sitting > .96) {
    for (const { boot } of feet) boot.quaternion.identity();
    return;
  }
  const boardStep = boarding ? Math.sin(Math.PI * cue.actionProgress) : 0;
  const plantWeight = (1 - curve(sitting, .52, .96)) * (boarding ? .83 : 1);
  for (let side = 0; side < feet.length; side++) {
    const { thigh, shin, boot } = feet[side];
    const phase = ((actor.step / (Math.PI * 2) + side * .5) % 1 + 1) % 1;
    const swaying = phase < .58 ? -phase / .58 : -1 + curve(phase, .58, 1);
    const lift = phase <= .58 ? 0 : Math.sin((phase - .58) / .42 * Math.PI);
    const swing = (swaying + .5) * .54 * actor.effort;
    const lead = side === 0 ? .15 : -.16;
    const rise = boarding ? boardStep * (side === 0 ? .16 : .035) : lift * .12 * actor.effort;
    target.set(side === 0 ? -.106 : .106, .047 + rise, .06 + swing + boardStep * lead + .22 * sitting);
    figure.localToWorld(target);
    // The boot geometry projects 6 cm from its ankle. Solve the ankle
    // channel first, then counter the shin quaternion to keep the sole flat.
    target.sub(bend.copy(ankleOffset).applyQuaternion(worldRotation));
    solveLimb(thigh, shin, target, .42, .415, side ? .13 : -.13, 1, plantWeight);
    shin.getWorldQuaternion(inverse).invert();
    boot.quaternion.copy(inverse.multiply(worldRotation));
    if (inside && !boarding) boot.quaternion.slerp(neutral, sitting);
  }
}

function originalSeatPose(original, seat) {
  if (seat === seats.helm) return original;
  // The foredeck angler is seated on the thwart before resuming the
  // fishing pose, with the rod left in its holder until the boat casts off.
  return { ...original, hy: .53, ltf: 1.48, lk: 1.34, rtf: 1.48, rk: 1.34, rf: .12, re: 1.47, lf: .54, le: 1.35 };
}

const itemPosition = new THREE.Vector3(), reachPosition = new THREE.Vector3();
const itemRotation = new THREE.Quaternion(), propRotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();

function placeProp(prop, position, rotation) {
  prop.position.copy(position);
  if (prop.parent) {
    prop.parent.worldToLocal(prop.position);
    prop.parent.getWorldQuaternion(parentRotation).invert();
    prop.quaternion.copy(parentRotation).multiply(rotation);
  } else prop.quaternion.copy(rotation);
  prop.updateMatrixWorld();
}

const pailGrip = [PAIL_HANDLE];
function updateProp(boat, name, cargo, shift, helm, angler, engaged, pose) {
  const prop = boat.dockGear?.[name];
  if (!prop) return;
  prop.visible = cargo.owner !== 'hidden';
  if (!prop.visible) return;
  const cue = !engaged ? null : shift.helm.gear === name ? shift.helm : shift.angler.gear === name ? shift.angler : null;
  const actor = cue === shift.helm ? helm : angler;
  const { figure } = actor;
  const held = cargo.owner === 'helm' || cargo.owner === 'angler';
  const reaching = cue && cue.reach && (cue.action === 'lift' || cue.action === 'lower');
  const carry = reaching ? cue.action === 'lift' ? curve(cue.actionProgress, .46, .98)
    : 1 - curve(cue.actionProgress, .04, .56) : held ? 1 : 0;
  const pail = name === 'tackle';
  if (carry > 0) {
    const gearBob = Math.sin(actor.step * 2) * actor.effort * .009;
    itemPosition.set(pail ? .29 : 0, (pail ? .52 : .82) + gearBob, pail ? .08 : .29);
    figure.localToWorld(itemPosition);
    itemRotation.setFromAxisAngle(up, actor.yaw);
  }
  if (carry < 1) {
    const point = reaching ? cue.reach : cargo.point;
    worldAnchor(boat, point, reachPosition);
    orientation(boat, point, cargo.rotation ?? 0, propRotation, parentRotation);
    itemPosition.lerpVectors(reachPosition, itemPosition, carry);
    propRotation.slerp(itemRotation, carry);
    itemRotation.copy(propRotation);
  }
  placeProp(prop, itemPosition, itemRotation);
  if (!cue || !figure.visible || !pose) return;
  const grip = reaching ? cue.action === 'lift' ? curve(cue.actionProgress, .11, .44)
    : 1 - curve(cue.actionProgress, .61, .94) : held ? 1 : 0;
  if (grip <= 0) return;
  const grips = pail ? pailGrip : TOTE_HANDLES;
  for (let i = 0; i < grips.length; i++) {
    const side = pail ? 1 : i;
    const { upper, fore, hand } = figure.userData.arms[side];
    const { x, y, z } = grips[i];
    prop.localToWorld(target.set(x, y, z));
    solveLimb(upper, fore, target, .30, .28, side ? 1 : -1, -.35, grip);
    hand.morphTargetInfluences[0] = .45 + grip * .44;
  }
}

const fishFrom = new THREE.Vector3(), fishTo = new THREE.Vector3(), fishGrip = new THREE.Vector3();
const restingHand = new THREE.Vector3();
const fishRotation = new THREE.Quaternion();
const fishSide = new THREE.Vector3(0, 0, 1);
// The fish moves from the ice to the pan. Empty pickup and release frames
// keep the hand moving without duplicating a fish in either container.
function sortCatch(boat, shift, helm, engaged, pose) {
  const fish = boat.dockGear?.sortFish;
  if (fish) fish.visible = false;
  if (!engaged || !shift.sorting || !helm.figure.visible) return;
  const progress = shift.sortProgress;
  const transfer = curve(progress, .28, .78);
  const { cooler, panPoint } = boat.dockGear || {};
  if (shift.sortFrom && shift.sortTo) {
    worldAnchor(boat, shift.sortFrom, fishFrom);
    worldAnchor(boat, shift.sortTo, fishTo);
  } else {
    if (!panPoint || !cooler) return;
    cooler.localToWorld(fishFrom.set(0, .265, 0));
    fishTo.copy(panPoint);
  }
  const atWork = curve(progress, 0, .24) * (1 - curve(progress, .78, 1));
  fishGrip.lerpVectors(fishFrom, fishTo, transfer);
  fishGrip.y += Math.sin(transfer * Math.PI) * .16;
  const { arms } = helm.figure.userData;
  const handSide = boat.berth.side > 0 ? 1 : 0;
  const { upper, fore, hand } = arms[handSide];
  if (pose) solveLimb(upper, fore, fishGrip, .30, .28, handSide ? 1 : -1, -.35, atWork);
  if (fish && progress >= .28 && progress < .78) {
    fish.visible = true;
    hand.getWorldPosition(restingHand);
    fishRotation.setFromAxisAngle(up, helm.yaw + .26)
      .multiply(propRotation.setFromAxisAngle(fishSide, -1.12 - transfer * .42));
    placeProp(fish, restingHand, fishRotation);
    hand.morphTargetInfluences[0] = .8;
  }
}

export function updateDockActors(boat, shift, dt, time, ctx) {
  const aboard = !boat.trip.secured;
  const helm = dockActor(boat.crew.helm, seats.helm), angler = dockActor(boat.crew.angler, seats.angler);
  const pose = dt > 0 || !helm.initialized || !angler.initialized;
  if (aboard) {
    restoreActor(helm, seats.helm);
    restoreActor(angler, seats.angler);
  } else {
    const { crew } = boat;
    crew.line.visible = crew.float.visible = false;
    crew.rigging = 'idle';
    crew.hasBite = false;
    updateBody(boat, helm, shift.helm, dt, time, ctx);
    updateBody(boat, angler, shift.angler, dt, time, ctx);
  }
  updateProp(boat, 'cooler', shift.gear.cooler, shift, helm, angler, !aboard, pose);
  updateProp(boat, 'tackle', shift.gear.tackle, shift, helm, angler, !aboard, pose);
  sortCatch(boat, shift, helm, !aboard, pose);
  return !aboard;
}
