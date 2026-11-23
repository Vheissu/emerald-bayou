import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cachedResource } from './cache.js';
import { registerWetMaterial } from './surfacewetness.js';

const cache = new Map();
const drumX = 1.28, drumZ = 2.15, deck = 2.18, outlet = 3.57;
const hardware = registerWetMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.36, roughness: 0.68, side: THREE.DoubleSide }));
const water = new THREE.MeshStandardMaterial({ color: 0x566e65, roughness: 0.15, metalness: 0.37 });
const drops = new THREE.LineBasicMaterial({ color: 0xb2c6c4, transparent: true, opacity: 0.7, depthWrite: false });

function buildHardware() {
  const parts = [];
  const add = (geo, hex, x, y, z) => {
    geo.translate(x, y, z);
    const p = geo.attributes.position, colors = [], tint = new THREE.Color(hex);
    for (let i = 0; i < p.count; i++) {
      const shade = 0.82 + 0.12 * Math.sin(p.getX(i) * 41 + p.getY(i) * 1.8) + 0.06 * Math.sin(p.getY(i) * 19);
      colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    parts.push(geo);
  };
  // The corrugated shack roof falls towards its front edge at z = 2.795.
  const trough = 0x858276, oxide = 0x73523c;
  add(new THREE.BoxGeometry(4.17, 0.035, 0.15), trough, 0, 3.96, 2.79);
  for (const z of [2.725, 2.855]) add(new THREE.BoxGeometry(4.17, 0.085, 0.02), trough, 0, 4.00, z);
  for (const x of [-1.65, 0, 1.65]) add(new THREE.BoxGeometry(0.048, 0.048, 0.19), oxide, x, 3.93, 2.77);
  const dist = drumZ - 2.79, fall = -0.29;
  const pipe = new THREE.CylinderGeometry(0.044, 0.044, Math.hypot(dist, fall), 12);
  pipe.rotateX(Math.atan2(dist, fall));
  add(pipe, trough, drumX, 3.91 + fall * 0.5, 2.79 + dist * 0.5);
  add(new THREE.CylinderGeometry(0.048, 0.048, 0.11, 12, 1, true), trough, drumX, outlet + 0.052, drumZ);
  const profile = [[0.285,0],[0.322,0.035],[0.323,0.12],[0.341,0.19],[0.34,0.22],
    [0.324,0.24],[0.328,0.65],[0.342,0.67],[0.342,0.70],[0.325,0.73],[0.317,0.87],
    [0.333,0.88],[0.333,0.91],[0.309,0.91],[0.307,0.88],[0.305,0.10],[0,0.10]];
  add(new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), 32), 0x486967, drumX, deck, drumZ);
  for (const y of [0.035, 0.891]) {
    const hoop = new THREE.TorusGeometry(0.322, 0.014, 6, 32); hoop.rotateX(Math.PI / 2);
    add(hoop, oxide, drumX, deck + y, drumZ);
  }
  const tap = new THREE.CylinderGeometry(0.022, 0.027, 0.13, 8); tap.rotateX(Math.PI / 2);
  add(tap, 0x9d8966, drumX, deck + 0.16, drumZ + 0.36);
  add(new THREE.BoxGeometry(0.10, 0.024, 0.025), oxide, drumX, deck + 0.20, drumZ + 0.37);
  const result = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return result;
}

export function buildRoofDrain(shack) {
  const group = new THREE.Group(); group.name = 'Porch rain barrel'; shack.add(group);
  const barrel = new THREE.Mesh(cachedResource(cache, 'hardware', buildHardware), hardware);
  barrel.castShadow = barrel.receiveShadow = true;
  const surface = new THREE.Mesh(cachedResource(cache, 'surface', () => new THREE.CircleGeometry(0.303, 28).rotateX(-Math.PI / 2)), water);
  surface.position.set(drumX, deck + 0.24, drumZ);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(drumX, deck + 0.85, drumZ), 0.9);
  const trickle = new THREE.LineSegments(geo, drops); trickle.visible = false;
  group.add(barrel, surface, trickle);
  return { group, surface, trickle, flow: 0, fill: 0.24, phase: 0, x: shack.position.x, z: shack.position.z };
}

export function updateRoofDrain(state, dt, rain, distanceSq) {
  const { group, surface, trickle } = state;
  group.visible = distanceSq < 300 ** 2;
  // The roof keeps shedding water after the cell passes. Advance the barrel at streamed
  // camps even out of sight, and only touch the droplet buffer near the porch.
  state.flow += (rain - state.flow) * -Math.expm1(-dt / (rain > state.flow ? 2.8 : 8.5));
  state.fill = THREE.MathUtils.clamp(state.fill + dt * (state.flow * 0.013 - 0.00045), 0.10, 0.875);
  surface.position.y = deck + state.fill;
  trickle.visible = state.flow > 0.025 && distanceSq < 75 ** 2;
  if (!trickle.visible) return;
  const flow = state.flow, fall = outlet - surface.position.y;
  const period = Math.sqrt(2 * fall / 9.81);
  state.phase = (state.phase + dt / period) % 1;
  const positions = trickle.geometry.attributes.position;
  const count = Math.min(6, Math.ceil(flow * 6));
  for (let i = 0; i < count; i++) {
    const cycle = (state.phase + i / count) % 1;
    const y = outlet - fall * cycle * cycle;
    const tail = Math.max(0, cycle - (0.035 + 0.16 * flow));
    const x = drumX + 0.015 * Math.sin(i * 2.4) * cycle;
    positions.setXYZ(i * 2, x, y, drumZ);
    positions.setXYZ(i * 2 + 1, x, outlet - fall * tail * tail, drumZ);
  }
  positions.needsUpdate = true; trickle.geometry.setDrawRange(0, count * 2);
}
