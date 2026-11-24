import * as THREE from 'three';
import { bridgeDeckAt, bridgeOverheadAt, bridgeZAt, GULF_CUT } from './waterfrontlayout.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { noiseTex, scaleTextureUvs } from './textures.js';
import { buildBridgeTraffic, moveBridgeTraffic } from './bridgetraffic.js';

const concrete = waterfrontSurface(0xffffff, { bumpScale: 0.036 });
const asphalt = waterfrontSurface(0xffffff, { roughness: 0.94 });
const galvanized = waterfrontSurface(0xffffff, { roughness: 0.61, metalness: 0.42 });
const timber = waterfrontSurface(0xffffff);
const lamp = waterfrontSurface(0xffffff, { emissive: 0xc49253, emissiveIntensity: 0 });
const signalRed = waterfrontSurface(0xffffff, { emissive: 0xff4b38, emissiveIntensity: 0.22 });
const signalGreen = waterfrontSurface(0xffffff, { emissive: 0x49eb88, emissiveIntensity: 0.22 });

const { west, east, width, piers } = GULF_CUT;

const point = (x, y, lateral = 0) => new THREE.Vector3(x, y, bridgeZAt(x) + lateral);
const deckPoint = (x, lift, lateral) => point(x, bridgeDeckAt(x) + lift, lateral);

function pavedStrip(batch, from, to, stripWidth, offset, color, heightAt) {
  const geometry = new THREE.PlaneGeometry(to - from, stripWidth, Math.ceil((to - from) / 2), 2).rotateX(-Math.PI / 2);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (from + to) / 2, z = p.getZ(i) + offset + bridgeZAt(x);
    p.setXYZ(i, x, heightAt(x, z), z);
  }
  geometry.computeVertexNormals();
  tintGeometry(batch, geometry, color, (x, y, z) => 0.94 + 0.042 * Math.sin(x * 0.81 + z * 2.2) + 0.015 * Math.cos(z * 7.4));
}

function addBent(batch, x) {
  const z = bridgeZAt(x), top = bridgeDeckAt(x) - 1.02;
  addBox(batch, 0x9c988c, 1.33, 0.76, 8.44, x, top - 0.17, z);
  // Fluted columns and a dark algae belt along the high tide level.
  for (const oz of [-2.75, 0, 2.75]) {
    const h = top + 6.2;
    const geometry = new THREE.CylinderGeometry(0.51, 0.58, h, 10, 14).translate(x, top - h / 2, z + oz);
    scaleTextureUvs(geometry, 4, h * 1.5);
    tintGeometry(batch, geometry, 0x969489, (u, y, v) => {
      const damp = 1 - THREE.MathUtils.smoothstep(y, -0.8, 0.47);
      const runoff = Math.max(0, Math.sin(v * 7.3 + u * 8.7));
      const joint = Math.abs(y - 4.6 + 0.047 * Math.sin(u + oz)) < 0.16 ? 0.08 : 0;
      return 1 - damp * 0.39 - runoff * (0.07 + 0.063 * Math.sin(y * 0.6 + u * 0.51) ** 2) - joint;
    });
    // Formwork seams weather into a thin horizontal band above the water.
    const seam = new THREE.CylinderGeometry(0.546, 0.546, 0.026, 10, 1).translate(x, Math.min(top - 0.71, 2.86), z + oz);
    tintGeometry(batch, seam, 0x8a8b7e);
    addBox(batch, 0x85867c, 1.14, 0.2, 1.13, x, top - 0.58, z + oz);
  }
}

export function buildGulfCutBridge(terrain) {
  concrete.bumpMap ??= noiseTex();
  const group = new THREE.Group();
  group.name = GULF_CUT.name;
  const structure = [], road = [], metal = [], fenders = [], lights = [], red = [], green = [];
  for (let x = west; x < east; x += 4) {
    const next = Math.min(east, x + 4);
    // The road follows the curved, crowned deck through three longitudinal girders.
    addBeam(structure, 0xa3a094, deckPoint(x - 0.04, -0.28, 0), deckPoint(next + 0.04, -0.28, 0), 0.55, width);
    for (const side of [-1.0, 0, 1.0]) addBeam(structure, 0x858782, deckPoint(x - 0.07, -0.83, side * 3),
      deckPoint(next + 0.07, -0.83, side * 3), 0.7, 0.62);
    for (const side of [-1, 1]) {
      addBeam(structure, 0xb9b3a0, deckPoint(x - 0.03, 0.17, side * 4.13), deckPoint(next + 0.03, 0.17, side * 4.13), 0.37, 0.34);
      addBeam(metal, 0x8b9391, deckPoint(x - 0.03, 0.91, side * 4.07), deckPoint(next + 0.03, 0.91, side * 4.07), 0.11, 0.19);
      addBeam(metal, 0x7b807c, deckPoint(x - 0.03, 0.57, side * 4.07), deckPoint(next + 0.03, 0.57, side * 4.07), 0.08, 0.1);
      addBox(metal, 0x92938a, 0.15, 0.92, 0.15, x, bridgeDeckAt(x) + 0.46, bridgeZAt(x) + side * 4.08);
      pavedStrip(road, x, next, 0.085, side * 3.47, 0xc7c5aa, p => bridgeDeckAt(p) + 0.027);
    }
  }
  const roadY = x => bridgeDeckAt(x) + 0.014;
  pavedStrip(road, west, east, 7.88, 0, 0x535857, roadY);
  for (const side of [-1, 1]) {
    for (const offset of [0.11, 0.97]) pavedStrip(road, west, east, 0.3, side * (1.29 + offset), 0x484e4c, x => roadY(x) + 0.004);
    for (let x = west; x < east; x += 7.0) {
      pavedStrip(road, x, Math.min(east, x + 4.4), 0.1, side * 0.095, 0xb19c56, p => bridgeDeckAt(p) + 0.027);
    }
  }
  // Continuous blacktop and expansion joints carry traffic onto the approaches.
  for (const [from, to] of [[west - 10, west], [east, east + 17]]) {
    pavedStrip(road, from, to, 8.22, 0, 0x78786d, (x, z) => Math.max(roadY(x) - 0.025, terrain.hf.compute(x, z) + 0.025));
    pavedStrip(road, from, to, 7.48, 0, 0x555b57, roadY);
    for (const side of [-1, 1]) {
      pavedStrip(road, from, to, 0.085, side * 3.47, 0xb4b39d, x => roadY(x) + 0.013);
      const nearDeck = from < west ? to : from;
      const shoulder = from < west ? from + 1.2 : to - 3.2;
      addBeam(metal, 0x868d88, deckPoint(nearDeck, 0.59, side * 4.07), deckPoint(shoulder, 0.59, side * 4.07), 0.105, 0.19);
      for (let x = from + 2; x < to - 1; x += 3.1) {
        addBox(metal, 0x93968f, 0.11, 0.70, 0.11, x, bridgeDeckAt(x) + 0.32, bridgeZAt(x) + side * 4.08);
      }
    }
  }
  for (const x of [west, -58, -22, 19, 57, 95, east]) {
    pavedStrip(road, x - 0.059, x + 0.059, 7.83, 0, 0x343936, p => roadY(p) + 0.009);
    // Black elastomer pads are visible between the cap and the steel girders.
    if (piers.includes(x)) for (const lateral of [-3, 0, 3]) {
      addBox(structure, 0x424542, 0.79, 0.12, 0.83, x, bridgeDeckAt(x) - 1.07, bridgeZAt(x) + lateral);
    }
  }
  for (const x of piers) addBent(structure, x);
  for (const x of [west, east - 5]) {
    const y = bridgeDeckAt(x), z = bridgeZAt(x);
    addBox(structure, 0x919086, 2.0, 5.8, 9.18, x, y - 2.9, z);
    addBox(structure, 0xa7a696, 3.3, 0.43, 9.6, x, y - 0.58, z);
  }
  for (const x of [GULF_CUT.channelWest + 2, GULF_CUT.channelEast - 2]) {
    const z = bridgeZAt(x), batch = x < 0 ? red : green;
    const color = x < 0 ? 0xe54737 : 0x52d18c;
    for (let offset = -8; offset <= 8; offset += 3.2) {
      addBox(fenders, 0x514537, 0.36, 5.9, 0.38, x, -1.44, z + offset);
      addBox(metal, 0x75706a, 0.4, 0.09, 0.43, x, 1.53, z + offset);
    }
    for (const side of [-1, 1]) {
      addBox(batch, color, 0.36, 0.27, 0.24, x, 2.41, z + side * 7.97);
      addBox(structure, 0x7d7769, 0.44, 0.10, 0.39, x, 2.25, z + side * 7.97);
      addBox(metal, 0x6b6d68, 0.19, 0.74, 0.18, x, 1.88, z + side * 7.97);
    }
    // The squared fender rails support weathered facing planks on the channel side.
    const face = x < 0 ? 1 : -1;
    for (const cy of [-0.06, 0.43, 0.92]) addBox(fenders, 0x675849, 0.24, 0.26, 16.5, x + face * 0.22, cy, z);
  }

  let previous = null;
  for (const x of [-89, -62, -31, 0, 31, 64, 96, 127]) {
    const z = bridgeZAt(x), h = bridgeDeckAt(x);
    addBox(metal, 0x697572, 0.17, 5.3, 0.15, x, h + 2.66, z - 3.99);
    addBeam(metal, 0x77807a, point(x, h + 4.62, -3.99), point(x, h + 5.01, -2.0), 0.11, 0.12);
    addBox(lights, 0xbfa988, 0.28, 0.12, 0.46, x, h + 4.98, z - 1.95);
    for (const lift of [3.7, 4.16, 4.62]) addBox(metal, 0x787e71, 0.34, 0.13, 0.39, x, h + lift, z - 4.24);
    if (previous !== null) {
      const length = x - previous;
      for (const lift of [3.7, 4.16, 4.62]) for (let i = 0; i < 8; i++) {
        const end = i + 1, anchor = bridgeDeckAt(previous), dz = -4.23;
        const wire = index => {
          const f = index / 8;
          return point(previous + f * length, THREE.MathUtils.lerp(anchor, h, f) + lift - Math.sin(f * Math.PI) * 0.62, dz);
        };
        addBeam(metal, 0x4a504f, wire(i), wire(end), 0.022, 0.023);
      }
    }
    previous = x;
  }

  const fenderGeometry = waterfrontMesh(fenders, timber);
  fenderGeometry.name = 'Pilot channel fender fallback';
  group.add(waterfrontMesh(structure, concrete), waterfrontMesh(road, asphalt, false), waterfrontMesh(metal, galvanized),
    fenderGeometry, waterfrontMesh(lights, lamp, false), waterfrontMesh(red, signalRed, false), waterfrontMesh(green, signalGreen, false));
  return { group, vehicles: buildBridgeTraffic(group) };
}

export function updateGulfCutBridge(bridge, time, night, environment = {}) {
  lamp.emissiveIntensity = night * 1.7;
  signalRed.emissiveIntensity = 0.25 + night * 1.9;
  signalGreen.emissiveIntensity = signalRed.emissiveIntensity;
  moveBridgeTraffic(bridge, time, night, environment);
}

export function placeFabFenders(group, source) {
  if (!source) return;
  for (const x of [GULF_CUT.channelWest + 2, GULF_CUT.channelEast - 2]) {
    const facing = x < 0 ? 1 : -1;
    for (const zOffset of [-6.4, 0, 6.4]) {
      const panel = source.clone(true);
      panel.position.set(x + facing * 0.37, 0.58, bridgeZAt(x) + zOffset);
      panel.rotation.set(0, facing > 0 ? 0 : Math.PI, 0);
      panel.scale.set(2.0, 1.03, 1.9);
      group.add(panel);
    }
  }
}

export function bridgeCameraHeight(x, y, z, boatHeight) {
  const ceiling = bridgeOverheadAt(x, z);
  return boatHeight < ceiling ? Math.min(y, ceiling - 0.4) : y;
}
