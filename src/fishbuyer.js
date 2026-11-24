import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { animatePerson, person } from './folk.js';
import { mulberry32 } from './noise.js';

const asset = new URL('../assets/people/fish-buyer.glb', import.meta.url);
const rigs = new WeakMap();
const { damp, lerp, clamp, smoothstep } = THREE.MathUtils;
let modelRequest;

const defaultTray = new THREE.Vector3(-0.26, 0.96, 0.015);
const defaultLedger = new THREE.Vector3(0.423, 0.787, 0.243);
const pencilTip = -0.124;
const lateral = new THREE.Vector3();
const toward = new THREE.Vector3();
const elbow = new THREE.Vector3();
const reference = new THREE.Vector3();
const wrist = new THREE.Vector3();
const desired = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const relative = new THREE.Quaternion();

function model() {
  if (!modelRequest) modelRequest = new GLTFLoader().loadAsync(asset.href).then(file => file.scene);
  return modelRequest;
}

function deform(bone, rest, rotation) {
  relative.setFromEuler(rotation);
  bone.quaternion.multiplyQuaternions(rest, relative);
}

function findArm(model, side, pole) {
  const upper = model.getObjectByName('upperarm_' + side);
  const fore = model.getObjectByName('lowerarm_' + side);
  const hand = model.getObjectByName('hand_' + side);
  const finger = model.getObjectByName('middle_01_' + side);
  const digits = [];
  for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
    for (const joint of ['01', '02', '03']) {
      const bone = model.getObjectByName(`${name}_${joint}_${side}`);
      if (!bone) continue;
      const dir = bone.children.find(child => child.isBone)?.position;
      digits.push({
        bone, rest: bone.quaternion.clone(), base: joint === '01',
        bend: new THREE.Vector3().crossVectors(dir ?? finger.position, lateral.set(pole, -0.2, -0.1)).normalize(),
      });
    }
  }
  return {
    upper, fore, hand, pole, digits,
    upperRest: upper.quaternion.clone(), foreRest: fore.quaternion.clone(), handRest: hand.quaternion.clone(),
    foreAxis: fore.position.clone().normalize(), handAxis: hand.position.clone().normalize(),
    fingerAxis: finger.position.clone().normalize(),
    upperLength: fore.position.length(), lowerLength: hand.position.length(),
  };
}

function pencilFor(arm) {
  // Carpentry pencil with unpainted wood at the point and a black graphite tip.
  const pencil = new THREE.Group();
  pencil.name = 'Receipt pencil';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0038, 0.0038, 0.17, 6),
    new THREE.MeshStandardMaterial({ color: 0xb48547, roughness: 0.68 }),
  );
  shaft.position.y = -0.024;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.0038, 0.014, 6),
    new THREE.MeshStandardMaterial({ color: 0xc6a376, roughness: 0.71 }),
  );
  point.rotation.z = Math.PI;
  point.position.y = pencilTip + 0.009;
  pencil.add(shaft, point);
  pencil.visible = false;
  arm.hand.add(pencil);
  const index = arm.digits[0].bone.position;
  pencil.position.copy(index).multiplyScalar(0.79);
  pencil.quaternion.setFromUnitVectors(lateral.set(0, -1, 0), arm.fingerAxis);
  return pencil;
}

function createRig(root, template, atBend) {
  const figure = cloneSkeleton(template);
  figure.name = 'Skinned fish buyer';
  // Keep one shared texture set for both docks. Work clothes differ in dye.
  const materialCopies = new Map(), faces = [];
  figure.traverse(part => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.receiveShadow = true;
    if (part.isSkinnedMesh) part.frustumCulled = false;
    const tint = material => {
      const id = material.name;
      if (!['Cloth_shirt', 'Cloth_jeans', 'Skin', 'Hair_short04', 'Waxed cap', 'Rubber coated canvas'].includes(id)) return material;
      if (!materialCopies.has(material)) {
        const copy = material.clone();
        if (id === 'Cloth_shirt') copy.color.setHex(atBend ? 0x969d85 : 0x777d91);
        if (id === 'Cloth_jeans') copy.color.setHex(atBend ? 0x687280 : 0x5f6156);
        if (id === 'Skin') copy.color.setHex(atBend ? 0xe9e1d6 : 0xcbc2ab);
        if (id === 'Hair_short04') copy.color.multiplyScalar(atBend ? 0.9 : 0.66);
        if (id === 'Waxed cap') copy.color.setHex(atBend ? 0xe9d2ab : 0xb6bbc0);
        if (id === 'Rubber coated canvas') copy.color.setHex(atBend ? 0xe3d0a6 : 0xccd1bf);
        materialCopies.set(material, copy);
      }
      return materialCopies.get(material);
    };
    part.material = Array.isArray(part.material) ? part.material.map(tint) : tint(part.material);
    const blink = part.morphTargetDictionary;
    if (blink?.blink_left !== undefined) faces.push({ weights: part.morphTargetInfluences, blink });
  });
  const chest = figure.getObjectByName('spine_03'), neck = figure.getObjectByName('neck_01');
  const pelvis = figure.getObjectByName('pelvis');
  const head = figure.getObjectByName('head');
  const left = findArm(figure, 'l', 1), right = findArm(figure, 'r', -1);
  const rig = {
    figure, faces, left, right, chest, neck, head, pelvis, pelvisRest: pelvis.position.clone(), pencil: pencilFor(left),
    chestRest: chest.quaternion.clone(), neckRest: neck.quaternion.clone(), headRest: head.quaternion.clone(),
    phase: atBend ? 0.2 : 2.1, greetTime: 0, greeted: false, lean: 0, turn: 0, nod: 0, activity: 0,
    leftWrist: new THREE.Vector3(), rightWrist: new THREE.Vector3(),
    lookAt: new THREE.Vector3(), aim: new THREE.Vector3(), leftTarget: new THREE.Vector3(), rightTarget: new THREE.Vector3(),
    drawing: new THREE.Vector3(), writingPoint: new THREE.Vector3(), nib: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YXZ'), initialized: false,
  };
  root.add(figure);
  return rig;
}

export function buildFishBuyer(atBend = false) {
  const group = new THREE.Group();
  group.name = 'Fish buyer';
  group.position.set(0.07, 0, -0.147);
  const state = { rig: null, fallback: null };
  rigs.set(group, state);
  group.userData.ready = model().then(template => {
    state.rig = createRig(group, template, atBend);
    return state.rig;
  }).catch(error => {
    console.warn('Fish buyer character failed to load', error);
    state.fallback = person(mulberry32(atBend ? 8421 : 73187), { pose: 'stand', work: true, hat: true, waders: true });
    group.add(state.fallback);
  });
  return group;
}

function reach(arm, station, cue, handAim, curl) {
  const { upper, fore, hand, upperLength: a, lowerLength: b } = arm;
  const parent = upper.parent;
  station.localToWorld(wrist.copy(cue));
  parent.worldToLocal(wrist).sub(upper.position);
  const length = clamp(wrist.length(), Math.abs(a - b) + 0.001, a + b - 0.003);
  toward.copy(wrist).normalize();
  wrist.copy(toward).multiplyScalar(length);
  const chord = (a * a - b * b + length * length) / (2 * length);
  // Elbow preference pulls down and away from the work body, keeping it
  // clear of the apron and avoiding a pop when the wrist travels.
  lateral.set(arm.pole * 0.65, -1, -0.14);
  lateral.addScaledVector(toward, -lateral.dot(toward)).normalize();
  elbow.copy(toward).multiplyScalar(chord);
  elbow.addScaledVector(lateral, Math.sqrt(Math.max(0, a * a - chord * chord)));

  reference.copy(arm.foreAxis).applyQuaternion(arm.upperRest);
  upper.quaternion.setFromUnitVectors(reference, desired.copy(elbow).normalize()).multiply(arm.upperRest);
  inverse.copy(upper.quaternion).invert();
  desired.copy(wrist).sub(elbow).applyQuaternion(inverse).normalize();
  reference.copy(arm.handAxis).applyQuaternion(arm.foreRest);
  fore.quaternion.setFromUnitVectors(reference, desired).multiply(arm.foreRest);

  if (handAim) {
    // Hand cues use station axes as well as contact positions.
    station.getWorldQuaternion(relative);
    fore.getWorldQuaternion(inverse).invert();
    desired.copy(handAim).applyQuaternion(relative).applyQuaternion(inverse).normalize();
    reference.copy(arm.fingerAxis).applyQuaternion(arm.handRest);
    hand.quaternion.setFromUnitVectors(reference, desired).multiply(arm.handRest);
  } else hand.quaternion.copy(arm.handRest);
  for (const finger of arm.digits) {
    relative.setFromAxisAngle(finger.bend, curl * (finger.base ? 0.69 : 0.55));
    finger.bone.quaternion.multiplyQuaternions(finger.rest, relative);
  }
}

function cueVector(out, value, fallback) {
  if (value?.isVector3) return out.copy(value);
  return Array.isArray(value) ? out.fromArray(value) : out.copy(fallback);
}

export function updateFishBuyer(buyer, { dt = 0, time = 0, near = false, weighing = 0, greet = false, player, targets } = {}) {
  const state = rigs.get(buyer);
  if (!state) return;
  if (!state.rig) {
    if (state.fallback) animatePerson(state.fallback, time, dt, near ? player : null);
    return;
  }
  if (!(dt > 0) && state.rig.initialized) return;
  const r = state.rig, station = buyer.parent;
  if (!station) return;
  const step = r.initialized ? dt : 1;
  r.initialized = true;
  if (greet && !r.greeted && weighing <= 0) r.greetTime = 1.7;
  r.greeted = greet;
  const hello = 1.7 - r.greetTime;
  const greeting = smoothstep(hello, 0.0, 0.32) * (1 - smoothstep(hello, 0.92, 1.65));
  r.greetTime = Math.max(0, r.greetTime - dt);

  const age = Math.max(0, 3.1 - weighing);
  const work = weighing > 0 ? smoothstep(age, 0.0, 0.42) * (1 - smoothstep(age, 2.64, 3.1)) : 0;
  const writing = work * smoothstep(age, 0.92, 1.35);
  const penDown = writing > 0.6;
  const breath = time * 1.63 + r.phase;
  r.lean = damp(r.lean, 0.025 + work * 0.19 + Math.sin(breath) * 0.014, 9, step);
  let bearing = 0;
  if (near && player && Number.isFinite(player.x) && Number.isFinite(player.z)) {
    station.worldToLocal(r.lookAt.set(player.x, 0, player.z));
    bearing = clamp(Math.atan2(r.lookAt.x - buyer.position.x, r.lookAt.z - buyer.position.z), -0.89, 0.89);
  }
  r.turn = damp(r.turn, bearing * (1 - work) + writing * 0.35, 4.8, step);
  r.nod = damp(r.nod, work * 0.10 - greeting * 0.09, 6.0, step);
  // Blender's exported bone frames differ slightly across the spine. These
  // small local rotations put the weight forward and direct the gaze.
  r.pelvis.position.copy(r.pelvisRest);
  r.pelvis.position.z += writing * 0.023;
  deform(r.chest, r.chestRest, r.rotation.set(r.lean, r.turn * 0.22, 0.022 * Math.sin(breath * 0.47)));
  deform(r.neck, r.neckRest, r.rotation.set(r.nod * 0.53, r.turn * 0.36, -0.027));
  deform(r.head, r.headRest, r.rotation.set(r.nod * 0.52 + 0.02 * Math.sin(breath), r.turn * 0.49, 0.018));

  const tray = cueVector(r.rightTarget, targets?.tray, defaultTray);
  tray.z -= 0.035;
  tray.y += 0.042;
  const ledger = cueVector(r.leftTarget, targets?.ledger, defaultLedger);
  // Behind the pencil nib, the wrist follows a short line and returns to
  // the start for the next figure rather than sweeping across the scale.
  const stroke = Math.sin((age - 1.34) * 18.8);
  r.writingPoint.copy(ledger);
  r.writingPoint.x += 0.012 - stroke * 0.015;
  r.writingPoint.y += 0.006 + 0.003 * Math.sin(age * 24);
  r.writingPoint.z += 0.016 * Math.sin(age * 9);
  ledger.copy(r.writingPoint).add(r.nib.set(-0.039, 0.038, -0.066));

  r.leftWrist.set(buyer.position.x + 0.27, 0.99 + Math.sin(breath) * 0.012, buyer.position.z + 0.14);
  r.leftWrist.lerp(ledger, writing);
  r.rightWrist.set(buyer.position.x - 0.25, 0.94 + Math.sin(breath - 0.7) * 0.01, buyer.position.z + 0.095);
  r.rightWrist.lerp(tray, work);
  r.rightWrist.lerp(r.lookAt.set(-0.45 + Math.sin(hello * 11.0) * 0.019, 1.48, buyer.position.z + 0.23), greeting * (1 - work));
  const grip = lerp(0.24, 0.93, writing);
  const penAim = penDown ? r.drawing.set(0.12, -0.70, 0.71) : null;
  reach(r.left, station, r.leftWrist, penAim, grip);
  if (penDown) {
    station.worldToLocal(r.pencil.localToWorld(r.nib.set(0, pencilTip, 0)));
    r.leftWrist.add(r.writingPoint.sub(r.nib));
    reach(r.left, station, r.leftWrist, penAim, grip);
  }
  const rightAim = work > 0.45 ? r.aim.set(0.08, -0.24, 0.96) : greeting > 0.35 ? r.aim.set(0, 0.97, 0.19) : null;
  reach(r.right, station, r.rightWrist, rightAim, lerp(0.35, 0.16, Math.max(greeting, work)));
  r.pencil.visible = penDown;

  const blinkClock = (time + r.phase) % 4.24;
  const blink = smoothstep(blinkClock, 0.035, 0.085) * (1 - smoothstep(blinkClock, 0.085, 0.16));
  for (const face of r.faces) {
    face.weights[face.blink.blink_left] = blink;
    face.weights[face.blink.blink_right] = blink;
  }
}
