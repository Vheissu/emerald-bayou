import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedResource } from './cache.js';
import { registerWetMaterial } from './surfacewetness.js';

const mastX = -0.87, swivelY = 3.42, mastZ = 0.28;
const painted = 0x9a9d8c, steel = 0x515656, iron = 0x713d26;
const sectors = 14, tau = 2 * Math.PI;
const rings = [0, 0.025, 0.075, 0.14, 0.197, 0.203, 0.3, 0.397, 0.403, 0.5,
  0.597, 0.603, 0.7, 0.797, 0.803, 0.9, 0.972, 1];
const radial = Array.from({ length: sectors }, (_, i) => {
  const angle = i / sectors * tau;
  return { sin: Math.sin(angle), cos: Math.cos(angle) };
});
const digits = {
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '–': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '0': ['.###.', '##.##', '#...#', '#...#', '#...#', '##.##', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};
let hardware, swivel, hardwareMaterial, fabricMaterial;

function dockWeatherHardware() {
  if (hardware) return hardware;
  const parts = [], color = new THREE.Color();
  const add = (geometry, tint, x, y, z) => {
    geometry.translate(x, y, z);
    color.setHex(tint);
    const rgb = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < rgb.length; i += 3) color.toArray(rgb, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    parts.push(geometry);
  };
  const box = (w, h, d, tint, x, y, z) => add(new THREE.BoxGeometry(w, h, d), tint, x, y, z);
  const tube = (top, base, h, tint, x, y, z) => add(new THREE.CylinderGeometry(top, base, h, 10), tint, x, y, z);
  const paint = (w, h, tint, x, y, z) => add(new THREE.PlaneGeometry(w, h).rotateY(Math.PI), tint, x, y, z);
  // The socket clamps to the end railing. Lift the swivel above head height so the sock clears the deck in a lull.
  box(0.21, 0.032, 0.19, steel, mastX, 0.83, mastZ);
  tube(0.055, 0.064, 0.21, iron, mastX, 0.93, mastZ);
  tube(0.028, 0.042, 1.61, painted, mastX, 1.73, mastZ);
  tube(0.024, 0.027, 0.84, 0x777e77, mastX, 2.94, mastZ);
  tube(0.043, 0.046, 0.068, steel, mastX, swivelY - 0.088, mastZ);
  tube(0.027, 0.032, 0.112, painted, mastX, swivelY - 0.029, mastZ);
  for (const y of [1.15, 1.73]) {
    box(0.12, 0.062, 0.11, iron, mastX + 0.019, y, mastZ);
    box(0.023, 0.031, 0.022, steel, mastX - 0.052, y, mastZ - 0.04);
  }

  // The other end pile carries a tide staff in feet, referenced to the game's zero water level.
  // The board is fixed and the real tide and waves reach a different mark as the water moves.
  const staffX = 0.85, staffZ = -0.14, staffY = 0.42, cream = 0xc7c5a8, black = 0x252b28;
  box(0.26, 2.98, 0.095, steel, staffX, staffY, staffZ + 0.07);
  box(0.235, 2.86, 0.026, cream, staffX, staffY, staffZ);
  box(0.29, 0.11, 0.13, iron, staffX, 1.89, staffZ + 0.02);
  const mark = (label, height) => {
    for (let i = 0; i < label.length; i++) {
      digits[label[i]].forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '#') paint(0.009, 0.009, black, staffX - 0.015 - i * 0.052 - x * 0.009, height + 0.082 - y * 0.009, staffZ - 0.0145);
        }
      });
    }
  };
  for (let fifth = -15; fifth <= 28; fifth++) {
    const height = fifth * (0.3048 / 5), whole = fifth % 5 === 0;
    const width = whole ? 0.15 : 0.062;
    paint(width, whole ? 0.013 : 0.009, black, staffX + (0.19 - width) / 2, height, staffZ - 0.0145);
    if (!whole) continue;
    const feet = fifth / 5;
    mark(feet < 0 ? `–${-feet}` : feet > 0 ? `+${feet}` : '0', height);
  }
  mark('FT', 1.735);
  // Water-stained base, chipped paint and bands that meet the nearest dock post.
  for (const [x, y, w, h, shade] of [
    [0.06, -0.75, 0.026, 0.42, 0x776e51], [-0.10, -0.61, 0.013, 0.51, 0x81755d],
    [0.11, 0.83, 0.014, 0.14, 0x8f6a48], [-0.10, 1.62, 0.011, 0.20, 0x95907a],
  ]) paint(w, h, shade, staffX + x, y, staffZ - 0.0165);
  for (const y of [0.74, 1.24]) {
    box(0.28, 0.043, 0.12, steel, staffX, y, staffZ + 0.081);
    for (const x of [-0.108, 0.108]) box(0.024, 0.022, 0.008, iron, staffX + x, y, staffZ - 0.017);
  }

  hardware = sharedResource(mergeGeometries(parts));
  for (const part of parts) part.dispose();
  hardwareMaterial = sharedResource(registerWetMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.74, metalness: 0.22,
  })));
  parts.length = 0;
  const anchor = new THREE.Vector3(0, 0, -0.038), end = new THREE.Vector3(), axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  for (const side of [-1, 1]) {
    end.set(side * 0.21, 0.205, 0.295);
    axis.subVectors(end, anchor);
    const length = axis.length();
    q.setFromUnitVectors(up, axis.divideScalar(length));
    const brace = new THREE.CylinderGeometry(0.009, 0.012, length, 6).applyQuaternion(q);
    add(brace, steel, (end.x + anchor.x) * 0.5, end.y * 0.5, (end.z + anchor.z) * 0.5);
  }
  add(new THREE.TorusGeometry(0.29, 0.014, 6, sectors), steel, 0, 0, 0.286);
  swivel = sharedResource(mergeGeometries(parts));
  for (const part of parts) part.dispose();
  return hardware;
}

function sleeveGeometry() {
  const geometry = new THREE.BufferGeometry(), indices = [];
  const positions = new Float32Array(rings.length * sectors * 3), colors = new Float32Array(positions.length);
  const orange = new THREE.Color(0xdf6428), linen = new THREE.Color(0xdecfb0), hem = new THREE.Color(0x805335), color = new THREE.Color();
  for (let row = 0; row < rings.length; row++) {
    const u = rings[row], band = Math.floor(u * 5);
    for (let s = 0; s < sectors; s++) {
      const i = row * sectors + s;
      color.copy(u < 0.01 || u > 0.99 ? hem : band % 2 ? linen : orange);
      color.multiplyScalar(s === 0 ? 0.78 : 0.89 + 0.11 * Math.sin(u * 11 - s + 0.4));
      color.toArray(colors, i * 3);
      if (row === rings.length - 1) continue;
      const next = row * sectors + (s + 1) % sectors;
      indices.push(i, next, i + sectors, next, next + sectors, i + sectors);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.45, 0.9), 1.5);
  return geometry;
}

function dockSockInflation(speed) {
  return THREE.MathUtils.smoothstep(speed, 0.65, 8.1);
}

// Arc-length steps keep the fabric the same length as it hangs, snaps and twists.
// The mouth stays circular against its metal hoop. The open tail collapses when unpressurised.
function poseSleeve(geometry, inflation, phase) {
  const attr = geometry.attributes.position;
  const inflationSag = 1 - inflation;
  const pitch = t => (0.10 + 1.39 * inflationSag) * (1 - Math.exp(-6 * t));
  let previous = 0, y = 0, z = 0.295;
  for (let row = 0; row < rings.length; row++) {
    const u = rings[row];
    const bend = pitch((previous + u) / 2), span = (u - previous) * 1.64;
    y -= span * Math.sin(bend);
    z += span * Math.cos(bend);
    previous = u;
    const flutter = Math.sin(u * 13 - phase) * (0.035 + 0.14 * inflation) * u * u;
    const ripple = Math.sin(u * 19 - phase * 1.15) * (0.023 + 0.069 * inflation) * u * u;
    const roll = 0.24 * Math.sin(u * 5.5 - phase * 0.81) * inflationSag * u;
    const droop = pitch(u), upY = Math.cos(droop), upZ = Math.sin(droop);
    const radius = 0.295 - u * 0.202;
    const fold = 1 - inflationSag * THREE.MathUtils.smoothstep(u, 0.14, 0.88) * 0.77;
    for (let s = 0; s < sectors; s++) {
      const { sin, cos } = radial[s];
      const sx = radius * cos, sy = radius * sin * fold;
      attr.setXYZ(row * sectors + s, sx + flutter, y + sy * upY + sx * roll + ripple, z + sy * upZ);
    }
  }
  attr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
}

export function buildDockWeather(dock, length) {
  const group = new THREE.Group();
  group.name = 'Dock windsock and tide staff';
  group.position.z = -length;
  const geometry = dockWeatherHardware();
  const frame = new THREE.Mesh(geometry, hardwareMaterial);
  frame.castShadow = frame.receiveShadow = true;
  group.add(frame);
  dock.add(group);

  const head = new THREE.Group(); head.name = 'Windsock swivel'; head.position.set(mastX, swivelY, mastZ);
  group.add(head);
  head.add(new THREE.Mesh(swivel, hardwareMaterial));
  fabricMaterial ||= sharedResource(registerWetMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.91, side: THREE.DoubleSide,
  }), { minRoughness: 0.64 }));
  const sleeve = new THREE.Mesh(sleeveGeometry(), fabricMaterial);
  sleeve.name = 'Windsock fabric'; sleeve.castShadow = sleeve.receiveShadow = true;
  head.add(sleeve);
  poseSleeve(sleeve.geometry, 0, 0);
  return { group, head, sleeve, inflation: 0, phase: 0, untilNextPose: 0, initialised: false };
}

export function updateDockWeather(instruments, dt, bx, bz, environment) {
  if (!instruments || !environment) return;
  const { group, head, sleeve } = instruments, dock = group.parent;
  // Both the permanent dock and the streamed camp docks are flat, with no rotated or scaled ancestors.
  const yaw = dock.rotation.y;
  const x = dock.position.x + group.position.z * Math.sin(yaw);
  const z = dock.position.z + group.position.z * Math.cos(yaw);
  if ((x - bx) ** 2 + (z - bz) ** 2 > 175 ** 2) {
    instruments.initialised = false;
    return;
  }
  if (environment.game?.paused && instruments.initialised) return;
  const direction = environment.windDir;
  const speed = environment.sampleWindAt(x, z) * environment.gust;
  const target = dockSockInflation(speed);
  if (speed > 0.3) {
    const delta = Math.atan2(direction.x, direction.z) - yaw - head.rotation.y;
    head.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta)) * (instruments.initialised ? 1 - Math.exp(-dt * (1.4 + target * 4.1)) : 1);
  }
  instruments.inflation += (target - instruments.inflation) * (instruments.initialised ? 1 - Math.exp(-dt * 3.7) : 1);
  if (!instruments.initialised) instruments.untilNextPose = 0;
  instruments.initialised = true;
  instruments.phase = (instruments.phase + dt * (2.6 + Math.min(22, speed) * 0.57)) % (tau * 100);
  instruments.untilNextPose -= dt;
  if (instruments.untilNextPose > 0) return;
  instruments.untilNextPose = Math.max(0, 1 / 30 + instruments.untilNextPose);
  poseSleeve(sleeve.geometry, instruments.inflation, instruments.phase + x * 0.17 + z * 0.11);
}
