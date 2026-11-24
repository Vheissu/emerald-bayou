import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedResource } from './cache.js';
import { registerWetMaterial } from './surfacewetness.js';
import { plank } from './textures.js';

export const MULLET_BEND_KEY = '-1,0';
const landing = { x: -2.06, z: -4.91, deck: 0.81, width: 2.30, depth: 2.56 };
const drums = [
  { x: -0.49, z: 0.53, yaw: 0 },
  { x: -0.55, z: -0.47, yaw: -0.8 },
];
let sharedLanding;
let authoredLanding;

export function loadAuthoredLanding() {
  if (authoredLanding) return authoredLanding;
  if (!import.meta.env || import.meta.env.SSR) return null;

  const url = new URL('../assets/environment/mullet-bend.glb', import.meta.url);
  authoredLanding = new GLTFLoader().loadAsync(url.href).then(({ scene }) => {
    const deck = scene.getObjectByName('mullet_deck');
    const cabinWall = scene.getObjectByName('mullet_wall');
    const fuelDrums = ['mullet_drum_a', 'mullet_drum_b'].map(name => scene.getObjectByName(name));
    for (const part of [deck, cabinWall, ...fuelDrums]) part?.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = object.receiveShadow = true;
      sharedResource(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.map) material.map.anisotropy = 4;
        if (material.normalMap) material.normalMap.anisotropy = 4;
        registerWetMaterial(sharedResource(material));
      }
    });
    return { deck, cabinWall, fuelDrums };
  }).catch(error => {
    console.warn('Mullet Bend landing model', error);
    return null;
  });
  return authoredLanding;
}

function showAuthoredLanding(group, floor, fuelDrums) {
  loadAuthoredLanding()?.then(parts => {
    // A load can finish after the camp streams out. Its next instance uses the cached template.
    let root = group;
    while (root.parent) root = root.parent;
    if (!parts || !root.isScene) return;

    const replace = (template, anchor, fallback) => {
      if (!template) return;
      const part = template.clone(true);
      // The bundle anchors are dock-local. The procedural anchors already apply these same transforms.
      part.position.set(0, 0, 0);
      part.quaternion.identity();
      part.scale.setScalar(1);
      for (const object of fallback) object.visible = false;
      anchor.add(part);
    };
    replace(parts.deck, group, [floor]);
    for (let i = 0; i < fuelDrums.length; i++) replace(parts.fuelDrums[i], fuelDrums[i], fuelDrums[i].children);
    if (parts.cabinWall) group.parent.add(parts.cabinWall.clone(true));
  });
}

function addPart(batch, geometry, tint, x = 0, y = 0, z = 0) {
  geometry.translate(x, y, z);
  const color = new THREE.Color(tint), colors = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(color.r, color.g, color.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  batch.push(geometry);
}

function board(batch, size, position, tint, grainOffset = 0) {
  const geometry = new THREE.BoxGeometry(...size);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.65, grainOffset + uv.getY(i) * 0.13);
  addPart(batch, geometry, tint, ...position);
}

function tube(batch, points, radius, tint, segments = 25) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  addPart(batch, new THREE.TubeGeometry(path, segments, radius, 7, false), tint);
}

function rod(batch, start, end, radius, tint) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), axis = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, axis.length(), 9);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
  addPart(batch, geometry, tint, ...a.lerp(b, 0.5).toArray());
}

function merge(batch) {
  const geo = sharedResource(mergeGeometries(batch, false));
  for (const part of batch) part.dispose();
  return geo;
}

function landingResources() {
  if (sharedLanding) return sharedLanding;
  const floor = [], wood = [], metal = [], rubber = [];
  const grain = [0xd5c6b6, 0xa5a69a, 0xb9af9c, 0xcbb6a0, 0xb9ad99, 0xe1d8cb];
  const { width, depth } = landing, boardCount = 12, pitch = depth / boardCount;
  for (let i = 0; i < boardCount; i++) {
    const z = (i + 0.5) * pitch - depth / 2;
    board(floor, [width, 0.11, pitch - 0.009], [0, -0.055, z], grain[i % grain.length], (i * 0.23) % 1);
    for (const x of [-0.90, 0.88]) {
      addPart(floor, new THREE.CylinderGeometry(0.010, 0.010, 0.003, 7), 0x4f4134, x, 0.001, z);
    }
  }
  for (const x of [-0.95, 0.95]) {
    board(wood, [0.14, 0.19, depth], [x, -0.20, 0], 0xa09b8b);
    for (const z of [-1.06, 1.06]) {
      const pile = new THREE.CylinderGeometry(0.127, 0.164, 3.72, 11, 4);
      const positions = pile.attributes.position;
      addPart(wood, pile, 0x9c9b82, x, -1.89, z);
      // Stains and algae darken the timber at the high-water mark.
      const color = pile.attributes.color;
      for (let i = 0; i < positions.count; i++) {
        const tide = 1 - Math.min(1, Math.abs(positions.getY(i) + 0.81) * 0.95);
        color.setXYZ(i, color.getX(i) * (1 - 0.43 * tide), color.getY(i) * (1 - 0.27 * tide), color.getZ(i) * (1 - 0.49 * tide));
      }
    }
  }
  for (const z of [-1.06, 1.06]) board(wood, [width - 0.20, 0.11, 0.16], [0, -0.34, z], 0xaaa18f);
  // Drum skids keep the steel off the deck and stop it rolling sideways.
  for (const { x, z } of drums) {
    for (const offset of [-0.20, 0.20]) {
      board(wood, [0.64, 0.043, 0.18], [x, 0.0215, z + offset], 0x9d8974, offset + 0.33);
    }
  }
  const pumpX = drums[0].x + 0.15, pumpZ = drums[0].z;
  const pump = (top, base, height, y, color) => {
    addPart(metal, new THREE.CylinderGeometry(top, base, height, 12), color, pumpX, y, pumpZ);
  };
  pump(0.085, 0.085, 0.035, 0.927, 0x393630);
  pump(0.042, 0.042, 0.27, 1.072, 0x505851);
  pump(0.078, 0.072, 0.12, 1.24, 0x747a66);
  pump(0.064, 0.079, 0.035, 1.315, 0x909485);
  rod(metal, [pumpX, 1.33, pumpZ], [pumpX, 1.455, pumpZ], 0.019, 0xa29e8e);
  rod(metal, [pumpX - 0.12, 1.47, pumpZ], [pumpX + 0.12, 1.44, pumpZ], 0.019, 0x706754);
  rod(rubber, [pumpX - 0.115, 1.469, pumpZ], [pumpX - 0.032, 1.458, pumpZ], 0.027, 0x242725);
  rod(metal, [pumpX, 1.22, pumpZ], [0.02, 1.23, pumpZ], 0.029, 0x777a69);
  tube(rubber, [
    [0.01, 1.23, pumpZ], [0.22, 1.20, 0.49], [0.38, 0.76, 0.33], [0.35, 0.17, 0.15],
    [0.15, 0.10, -0.14], [0.03, 0.28, -0.43], [0.06, 0.62, -0.48], [0.10, 0.82, -0.56],
  ], 0.026, 0x262823, 38);
  rod(metal, [0.10, 0.80, -0.55], [0.10, 1.04, -0.64], 0.030, 0x81735b);
  rod(metal, [0.10, 1.04, -0.64], [0.02, 1.03, -0.67], 0.023, 0x979485);
  // Stow the nozzle on a stand and keep the loose dock line out of the aisle.
  addPart(metal, new THREE.BoxGeometry(0.16, 0.028, 0.15), 0x6c6653, 0.22, 0.014, -0.57);
  addPart(metal, new THREE.BoxGeometry(0.064, 0.88, 0.058), 0x64594a, 0.22, 0.457, -0.57);
  addPart(metal, new THREE.BoxGeometry(0.08, 0.19, 0.10), 0x575146, 0.16, 0.77, -0.56);
  addPart(metal, new THREE.BoxGeometry(0.18, 0.034, 0.29), 0x77726a, -0.77, 0.019, -1.05);
  rod(metal, [-0.77, 0.08, -1.22], [-0.77, 0.08, -0.88], 0.025, 0x76796e);
  for (const z of [-1.17, -0.95]) rod(metal, [-0.77, 0.036, z], [-0.77, 0.08, z], 0.025, 0x565447);
  tube(rubber, [
    [-0.76, 0.031, -1.03], [-0.46, 0.029, -1.06], [-0.12, 0.019, -1.09], [0.12, 0.023, -0.94],
    [0.05, 0.032, -0.82], [-0.20, 0.024, -0.86], [-0.34, 0.027, -1.01], [-0.17, 0.017, -1.15], [0.08, 0.017, -1.06],
  ], 0.016, 0x806951, 32);

  const batch = (parts, name, options) => ({
    name, geometry: merge(parts),
    material: sharedResource(registerWetMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, ...options }))),
  });
  sharedLanding = [
    batch(floor, 'Deck floor', { map: plank(), roughness: 0.91 }),
    batch(wood, 'Piles and pallets', { map: plank(), roughness: 0.91 }),
    batch(metal, 'Hand pump and cleat', { metalness: 0.47, roughness: 0.67 }),
    batch(rubber, 'Fuel hose and loose dock line', { roughness: 0.85 }),
  ];
  return sharedLanding;
}

export function buildMulletFuelLanding(dock, fuelDrums) {
  const group = new THREE.Group();
  group.name = 'Mullet Bend fuel landing';
  group.position.set(landing.x, landing.deck, landing.z);
  for (const { name, geometry, material } of landingResources()) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.drums = fuelDrums;
  for (let i = 0; i < fuelDrums.length; i++) {
    const drum = fuelDrums[i], { x, z, yaw } = drums[i];
    drum.name = i === 0 ? 'Mullet fuel drum with pump' : 'Mullet reserve drum';
    drum.position.set(x, 0.043, z);
    drum.rotation.y = yaw;
    group.add(drum);
  }
  dock.add(group);
  showAuthoredLanding(group, group.children[0], fuelDrums);
  return group;
}

export function mulletFuelColliders(camp) {
  const { bank, tie } = camp, deltaX = tie.x - bank.x, deltaZ = tie.z - bank.z;
  const length = Math.hypot(deltaX, deltaZ);
  if (!length) return [];
  const dx = deltaX / length, dz = deltaZ / length;
  const toWorld = (x, z) => ({
    x: bank.x - dz * (landing.x + x) - dx * (landing.z + z),
    z: bank.z + dx * (landing.x + x) - dz * (landing.z + z),
  });
  // Two overlapping capsules fill the platform footprint while keeping the
  // approach beside the skiff and the existing centre walkway clear.
  const r = landing.width / 4 + 0.012, end = landing.depth / 2 - r;
  return [-landing.width / 4, landing.width / 4].map(x => {
    const a = toWorld(x, -end), b = toWorld(x, end);
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, r, tag: 'dock' };
  });
}
