import * as THREE from 'three';
import { animatePerson, cast, fishingLine, person, rodTip, setLine } from './folk.js';
import { mulberry32 } from './noise.js';
import { registerWetMaterial } from './surfacewetness.js';
import { tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';

const { clamp, lerp } = THREE.MathUtils;
const motionBlend = (dt, rate) => -Math.expm1(-dt * rate);
const down = new THREE.Vector3(0, -1, 0);
const castDistances = [8.5, 6.3, 4.5];
const seat = new THREE.BoxGeometry(0.67, 0.37, 0.36);
const seatFinish = registerWetMaterial(new THREE.MeshStandardMaterial({ color: 0x545f55, roughness: 0.85 }));
const floatShape = new THREE.LatheGeometry([
  new THREE.Vector2(0, -0.038),
  new THREE.Vector2(0.018, -0.029),
  new THREE.Vector2(0.024, 0.004),
  new THREE.Vector2(0.013, 0.032),
  new THREE.Vector2(0.006, 0.040),
  new THREE.Vector2(0.006, 0.068),
  new THREE.Vector2(0, 0.072),
], 8);
const floatFinish = new THREE.MeshStandardMaterial({ color: 0xff5b28, roughness: 0.59 });

const vestPaint = [0xa57752, 0x9b8354, 0x657b6d, 0x906455];
const vestShapes = [];
const vestFinish = waterfrontSurface(0xffffff, { roughness: 0.92, side: THREE.DoubleSide });
const panelRows = [
  // Height, neckline edge, armhole edge, inner and outer depth, padding.
  [0.065, 0.036, 0.145, 0.117, 0.082, 0.006],
  [0.081, 0.020, 0.162, 0.123, 0.086, 0.037],
  [0.126, 0.018, 0.175, 0.125, 0.081, 0.056],
  [0.234, 0.019, 0.180, 0.138, 0.083, 0.052],
  [0.338, 0.032, 0.191, 0.145, 0.078, 0.044],
  [0.403, 0.058, 0.177, 0.131, 0.077, 0.042],
  [0.464, 0.084, 0.158, 0.109, 0.078, 0.038],
  [0.532, 0.087, 0.153, 0.076, 0.062, 0.026],
  [0.557, 0.085, 0.145, 0.054, 0.036, 0.014],
];

function flotationPanel(side, front) {
  const geometry = new THREE.BufferGeometry(), positions = [], indices = [];
  const segments = 12;
  for (const [y, inner, outer, innerZ, outerZ, padding] of panelRows) {
    for (let i = 0; i <= segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      const across = (1 + Math.cos(angle)) * 0.5;
      const x = side * lerp(inner, outer, across);
      const z = front * (lerp(innerZ, outerZ, across) + Math.sin(angle) * padding);
      positions.push(x, y + .005 * across, z);
    }
  }
  for (let row = 1; row < panelRows.length; row++) {
    for (let i = 0; i < segments; i++) {
      const a = (row - 1) * (segments + 1) + i, b = a + segments + 1;
      if (side === front) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const result = geometry.toNonIndexed();
  geometry.dispose();
  return result;
}

function vestBand(y, width, reachZ) {
  const tube = new THREE.CylinderGeometry(1, 1, width, 28, 1, true);
  const points = tube.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), z = points.getZ(i);
    points.setXYZ(i, Math.sign(x) * Math.abs(x) ** 0.72 * 0.195,
      points.getY(i) + y + x * .002, Math.sign(z) * Math.abs(z) ** 0.51 * reachZ);
  }
  tube.computeVertexNormals();
  const result = tube.toNonIndexed();
  tube.dispose();
  return result;
}

function flotationVest(index) {
  if (!vestShapes[index]) {
    const parts = [], color = vestPaint[index];
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        tintGeometry(parts, flotationPanel(side, front), color, (x, y, z) => {
          const wear = .94 + .09 * Math.sin(x * 62 + y * 163) * Math.cos(z * 94 + y * 29);
          const hem = THREE.MathUtils.smoothstep(y, .065, .114);
          return (0.65 + 0.35 * hem) * wear * (front > 0 ? 1 : .88);
        });
      }
      const shoulder = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * .117, .530, -.078),
        new THREE.Vector3(side * .116, .574, -.035),
        new THREE.Vector3(side * .115, .589, .007),
        new THREE.Vector3(side * .112, .564, .057),
        new THREE.Vector3(side * .111, .527, .090),
      ]);
      const binding = new THREE.TubeGeometry(shoulder, 9, .027, 7);
      tintGeometry(parts, binding.toNonIndexed(), color, (x, y) => .68 + (y - .52) * 3);
      binding.dispose();
      const reflector = new THREE.BoxGeometry(.033, .044, .004).rotateX(-.23);
      tintGeometry(parts, reflector.toNonIndexed().translate(side * .116, .506, .099), 0xaaa695);
      reflector.dispose();
    }
    for (const [y, reach] of [[.16, .182], [.255, .190]]) {
      tintGeometry(parts, vestBand(y, .021, reach), 0x413f38);
      const buckle = new THREE.BoxGeometry(.050, .031, .016);
      tintGeometry(parts, buckle.toNonIndexed().translate(.005, y, reach + .005), 0x282925);
      buckle.dispose();
      const latch = new THREE.BoxGeometry(.017, .021, .020);
      tintGeometry(parts, latch.toNonIndexed().translate(.008, y, reach + .004), 0x6b6a59);
      latch.dispose();
    }
    for (const part of parts) part.deleteAttribute('uv');
    vestShapes[index] = waterfrontMesh(parts, vestFinish).geometry;
  }
  const vest = new THREE.Mesh(vestShapes[index], vestFinish);
  vest.name = 'Padded flotation vest';
  vest.castShadow = vest.receiveShadow = true;
  return vest;
}

export function buildFishingCrew(boat, index) {
  const random = mulberry32(0x43fa7 + index * 15739);
  const helm = person(random, { pose: 'sit', hat: true, drive: true, work: true });
  const angler = person(random, { pose: 'stand', hat: true, rod: true, work: true });
  helm.userData.spine.add(flotationVest(index * 2));
  angler.userData.spine.add(flotationVest(index * 2 + 1));
  helm.name = 'Skiff helmsman';
  helm.position.set(-0.21, 0.064, 1.23);
  helm.rotation.y = Math.PI;
  angler.name = 'Skiff angler';
  angler.position.set(0.02, 0.073, -0.95);
  angler.rotation.y = Math.PI;
  for (const figure of [helm, angler]) {
    const rig = figure.userData;
    rig.act = 'idle';
    rig.actDur = Infinity;
  }
  const pedestal = new THREE.Mesh(seat, seatFinish);
  pedestal.name = 'Helm seat';
  pedestal.position.set(-0.21, 0.263, 1.23);
  pedestal.castShadow = pedestal.receiveShadow = true;

  const line = fishingLine(), float = new THREE.Mesh(floatShape, floatFinish);
  line.name = 'Skiff fishing line';
  float.name = 'Skiff fishing float';
  line.visible = float.visible = false;
  boat.mesh.add(helm, angler, pedestal, line, float);

  const rig = angler.userData;
  const crew = {
    helm, angler, line, float, standing: { ...rig.base }, raised: 0, hail: 0,
    castSide: index === 0 ? 1 : -1, phase: '', wait: 0, castTime: 0, rigging: 'idle', random,
    player: { x: 0, z: 0, speed: 0 }, tip: new THREE.Vector3(), tipLocal: new THREE.Vector3(), castFrom: new THREE.Vector3(),
    castTo: new THREE.Vector3(), lure: new THREE.Vector3(), retrieveFrom: new THREE.Vector3(),
    forward: new THREE.Vector3(), arm: {
      grip: new THREE.Vector3(), reach: new THREE.Vector3(), pole: new THREE.Vector3(),
      elbow: new THREE.Vector3(), forearm: new THREE.Vector3(), inverse: new THREE.Quaternion(),
    },
  };
  rig.onCast = () => launchCast(crew);
  return crew;
}

// Aim the arm through the shoulder/elbow chain so the hand stays planted
// on the tiller or against a thigh through body and hull motion.
function plantLeftHand(arm, figure, amount) {
  const { upper, fore } = figure.userData.arms[0];
  upper.parent.worldToLocal(arm.grip);
  arm.reach.subVectors(arm.grip, upper.position);
  const length = clamp(arm.reach.length(), 0.032, 0.574);
  arm.reach.normalize();
  const shoulderLength = 0.3, wristLength = 0.28;
  const chord = (length * length + shoulderLength ** 2 - wristLength ** 2) / (length * 2);
  arm.pole.set(-1, -0.45, -0.08).addScaledVector(arm.reach, -arm.pole.dot(arm.reach)).normalize();
  arm.elbow.copy(arm.reach).multiplyScalar(chord)
    .addScaledVector(arm.pole, Math.sqrt(Math.max(0, shoulderLength ** 2 - chord ** 2)));
  arm.inverse.setFromUnitVectors(down, arm.elbow.normalize());
  upper.quaternion.slerp(arm.inverse, amount);
  arm.forearm.copy(arm.reach).multiplyScalar(length).addScaledVector(arm.elbow, -shoulderLength).normalize();
  arm.forearm.applyQuaternion(arm.inverse.invert());
  arm.inverse.setFromUnitVectors(down, arm.forearm);
  fore.quaternion.slerp(arm.inverse, amount);
}

function beginReel(crew, seconds) {
  const rig = crew.angler.userData;
  crew.rigging = 'reeling';
  crew.retrieveFrom.copy(crew.lure);
  crew.castTime = 0;
  crew.reelDuration = seconds;
  rig.act = 'reel';
  rig.actT = 0;
  rig.actDur = seconds;
  rig.rate = 10;
}

function landCast(crew, time, ctx, waveAt) {
  const { castTo, lure } = crew;
  crew.rigging = 'soaking';
  crew.castTime = 0;
  castTo.y = waveAt(castTo.x, castTo.z, time);
  lure.copy(castTo);
  ctx.emitStamp?.(lure.x, lure.z, 0.37, 0.075, 0.09, 0.28);
  const distance = Math.hypot(ctx.bx - lure.x, ctx.bz - lure.z);
  ctx.audio?.plip?.(0.22 * Math.max(0, 1 - distance / 40), lure.x, lure.z);
  crew.soak = 10 + crew.random() * 8;
  crew.bite = 3 + crew.random() * 5;
}

function launchCast(crew) {
  if (crew.rigging !== 'casting') return;
  const { context: ctx, time, waveAt } = crew;
  rodTip(crew.angler, crew.castFrom);
  crew.angler.getWorldDirection(crew.forward);
  const origin = crew.angler.getWorldPosition(crew.castTo);
  for (const range of castDistances) {
    const x = origin.x + crew.forward.x * range, z = origin.z + crew.forward.z * range;
    const y = waveAt(x, z, time);
    if (ctx.heightAt && y - ctx.heightAt(x, z) < 0.24) continue;
    crew.castTo.set(x, y, z);
    crew.lure.copy(crew.castFrom);
    crew.rigging = 'airborne';
    crew.castTime = 0;
    return;
  }
  crew.rigging = 'idle';
  crew.wait = 2.5;
}

function updateFishingLine(crew, boat, dt, time, ctx, waveAt, visible) {
  const active = crew.rigging === 'airborne' || crew.rigging === 'soaking' || crew.rigging === 'reeling';
  crew.line.visible = crew.float.visible = visible && active;
  if (!active) return;
  const { lure, castFrom, castTo, tip } = crew;
  const rig = crew.angler.userData;
  rodTip(crew.angler, tip);
  crew.castTime += dt;
  if (crew.rigging === 'airborne') {
    const progress = Math.min(1, crew.castTime / 0.44);
    lure.lerpVectors(castFrom, castTo, progress);
    lure.y += 0.86 * Math.sin(Math.PI * progress);
    if (progress === 1) landCast(crew, time, ctx, waveAt);
  } else if (crew.rigging === 'soaking') {
    const nudge = Math.max(0, 1 - Math.abs(crew.castTime - crew.bite) * 3.4);
    lure.y = waveAt(lure.x, lure.z, time) - nudge * 0.045;
    if (nudge > 0.72 && rig.tug <= 0) rig.tug = 0.65;
    if (crew.castTime > crew.soak) beginReel(crew, 2.8 + crew.random() * 1.4);
  } else {
    const progress = Math.min(1, crew.castTime / crew.reelDuration);
    lure.lerpVectors(crew.retrieveFrom, tip, progress);
    const surface = waveAt(lure.x, lure.z, time);
    const settling = Math.max(0, crew.retrieveFrom.y - surface) * (1 - progress) ** 6;
    lure.y = lerp(surface + settling, tip.y, progress ** 4);
    if (progress === 1) {
      crew.rigging = 'idle';
      crew.wait = 2 + crew.random() * 2.2;
      crew.line.visible = crew.float.visible = false;
    }
  }
  if (visible && crew.line.visible) {
    boat.mesh.worldToLocal(crew.float.position.copy(lure));
    boat.mesh.worldToLocal(crew.tipLocal.copy(tip));
    setLine(crew.line, crew.tipLocal, crew.float.position);
  }
}

export function updateFishingCrew(crew, boat, trip, dt, time, ctx, waveAt) {
  const { helm, angler, player } = crew;
  const { mesh } = boat;
  const distance = Math.hypot(mesh.position.x - ctx.bx, mesh.position.z - ctx.bz);
  const nearby = distance < 150;
  if (!nearby) {
    crew.line.visible = crew.float.visible = false;
    helm.visible = angler.visible = distance < 260;
  } else {
    helm.visible = angler.visible = true;
  }
  if (!(dt > 0)) return;

  const fishing = trip.phase === 'fishing';
  const alarm = clamp(trip.alarm || 0, 0, 1);
  const storm = trip.storm && !trip.secured;
  const docking = trip.phase === 'docking';
  const response = trip.reaction;
  const waveRoll = boat.roll || 0;
  const brace = clamp((storm ? 0.52 : 0) + 0.67 * alarm + Math.abs(waveRoll) * 1.4, 0, 1);
  const stopping = !fishing || storm || alarm > 0.54;
  if (crew.phase !== trip.phase && fishing) crew.wait = 1.2;
  crew.phase = trip.phase;
  if (stopping && (crew.rigging === 'soaking' || crew.rigging === 'airborne')) beginReel(crew, 1.15);
  if (stopping && crew.rigging === 'casting') crew.rigging = 'idle';

  const hooked = crew.rigging === 'reeling';
  const upright = fishing && !storm ? 1 - brace * 0.42 : hooked ? 0.45 : 0;
  crew.raised += (upright - crew.raised) * motionBlend(dt, 2.8);
  const side = docking ? -(boat.berth?.side ?? 1) : (trip.fishingSide ?? crew.castSide);
  const yaw = Math.PI - side * (1.43 + (docking ? 0.21 : 0));
  const facing = lerp(Math.PI, yaw, docking ? 0.68 : crew.raised);
  angler.rotation.y += Math.atan2(Math.sin(facing - angler.rotation.y), Math.cos(facing - angler.rotation.y)) * motionBlend(dt, 3.5);
  angler.position.z = lerp(-0.95, -0.62, crew.raised);
  angler.position.x = 0.02 + side * 0.12 * crew.raised;

  if (!nearby && crew.rigging === 'idle') return;
  const anglerRig = angler.userData, helmRig = helm.userData, uprightPose = crew.standing;
  Object.assign(anglerRig.base, {
    hy: lerp(0.53, uprightPose.hy, crew.raised),
    ltf: lerp(1.48, 0.07 + brace * 0.13, crew.raised), rtf: lerp(1.48, 0.05 + brace * 0.13, crew.raised),
    lk: lerp(1.34, 0.16 + brace * 0.24, crew.raised), rk: lerp(1.34, 0.15 + brace * 0.24, crew.raised),
    hRz: clamp(-waveRoll * 0.28, -0.15, 0.15) * (0.38 + crew.raised * 0.62),
    sx: 0.08 + 0.22 * brace + Math.sin(time * 1.4 + anglerRig.ph) * 0.022,
    sy: 0.1 * Math.sin(time * 0.37 + anglerRig.ph) + (docking ? side * .16 : 0),
    hdx: 0.07 + 0.22 * brace,
    lf: lerp(0.54, 0.42, crew.raised) + brace * 0.46, lo: 0.11 + brace * 0.34,
    le: lerp(1.35, 0.58, crew.raised) - brace * 0.30,
    rf: lerp(0.12, 1.0, crew.raised), ro: lerp(0.35, uprightPose.ro, crew.raised),
    re: lerp(1.47, 0.80, crew.raised), rod: lerp(3.14, 0.33, crew.raised),
  });

  crew.context = ctx; crew.time = time; crew.waveAt = waveAt;
  if (anglerRig.actT + Math.min(dt, 0.1) >= anglerRig.actDur || (stopping && anglerRig.act === 'cast')) {
    anglerRig.act = 'idle'; anglerRig.actT = 0; anglerRig.actDur = Infinity; anglerRig.rate = 8;
  }
  if (!stopping && nearby && response !== 'hail' && response !== 'watch' && crew.rigging === 'idle') {
    crew.wait -= dt;
    if (crew.wait <= 0 && crew.raised > 0.84 && cast(angler)) {
      crew.rigging = 'casting';
    }
  }

  // Let the deckhand check the approaching helm before raising a hand.
  const hail = response === 'hail' && !storm && alarm < 0.44 ? 1 : 0;
  crew.hail += (hail - crew.hail) * motionBlend(dt, 4.5);
  if (crew.hail > 0.02 && crew.rigging !== 'casting' && !hooked) {
    anglerRig.base.lf = lerp(anglerRig.base.lf, 2.17, crew.hail);
    anglerRig.base.lo = lerp(anglerRig.base.lo, 0.46 + Math.sin(time * 6) * 0.11, crew.hail);
    anglerRig.base.le = lerp(anglerRig.base.le, 0.37, crew.hail);
  }
  player.x = ctx.bx; player.z = ctx.bz; player.speed = ctx.speed || 0;
  const attention = alarm > 0.14 || response === 'watch' || response === 'hail' || response === 'brace' || distance < 12;
  animatePerson(angler, time, dt, attention ? player : null);
  if (nearby) {
    const holdingLine = crew.rigging === 'soaking' || hooked;
    const supportingArm = (1 - crew.hail) * (holdingLine ? 0.95 : 0);
    const restingArm = (1 - crew.raised) * (1 - crew.hail);
    if (supportingArm > 0.08) {
      const crank = hooked ? time * 10 : 0;
      anglerRig.rod.localToWorld(crew.arm.grip.set(-0.046, 0.22 + Math.sin(crank) * 0.024,
        -0.048 + Math.cos(crank) * 0.021));
      plantLeftHand(crew.arm, angler, supportingArm * 0.86);
    } else if (restingArm > 0.08) {
      anglerRig.legs[0].thigh.localToWorld(crew.arm.grip.set(-0.028, -0.22, 0.062));
      plantLeftHand(crew.arm, angler, restingArm * 0.9);
    }
  }
  updateFishingLine(crew, boat, dt, time, ctx, waveAt, nearby && distance < 85);

  if (!nearby) return;
  Object.assign(helmRig.base, {
    hx: -0.045 + clamp((trip.turn || 0) * 0.075, -0.065, 0.065),
    sy: 0.23 + clamp((trip.turn || 0) * 0.22, -0.16, 0.16), sx: 0.08 + 0.15 * brace,
    sz: clamp(-waveRoll * 0.35, -0.15, 0.15), hdy: docking ? side * 0.35 : -0.20,
    rf: 0.5 + 0.26 * brace, ro: 0.35, re: 0.5,
  });
  animatePerson(helm, time, dt, attention ? player : null);
  const motor = mesh.userData.motor;
  if (motor) {
    motor.localToWorld(crew.arm.grip.set(-0.16, 0.22, -0.80));
    plantLeftHand(crew.arm, helm, trip.secured ? 0.36 : 0.92);
  }
}
