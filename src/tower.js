import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TEX from './textures.js';
import { sharedResource } from './cache.js';
import { registerWetMaterial } from './surfacewetness.js';

function box(w, h, d, x, y, z, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export function buildTower() {
  const parts = []; const plankParts = [];
  const W = 5.6, D = 5.6;
  const levels = [4.3, 8.6, 12.9];
  const top = 15.6;
  // posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.28, top + 0.6, 0.28, sx * W / 2, top / 2 + 0.2, sz * D / 2));
  for (const sx of [-1, 1]) parts.push(box(0.2, top, 0.2, sx * W / 2, top / 2, 0));
  for (const sz of [-1, 1]) parts.push(box(0.2, top, 0.2, 0, top / 2, sz * D / 2));
  // cross bracing on faces
  for (const lv of [0, ...levels]) {
    const h = (levels.find(l => l > lv + 0.1) ?? top) - lv;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      parts.push(box(0.12, Math.hypot(h, W / 2) - 0.2, 0.12, sx * W / 4, lv + h / 2, sz * D / 2, 0, sx * Math.atan2(W / 2, h)));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = box(0.12, Math.hypot(h, D / 2) - 0.2, 0.12, 0, 0, 0, 0, sz * Math.atan2(D / 2, h));
      g.rotateY(Math.PI / 2); g.translate(sx * W / 2, lv + h / 2, sz * D / 4); parts.push(g);
    }
  }
  const railing = (y, side, openFrom = null, openTo = null) => {
    // side: 0:+z 1:-z 2:+x 3:-x
    const along = (side < 2) ? W : D;
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = -along / 2 + (i / n) * along;
      if (openFrom !== null && t > openFrom - 0.01 && t < openTo + 0.01) continue;
      const px = side === 0 ? t : side === 1 ? t : side === 2 ? W / 2 : -W / 2;
      const pz = side === 0 ? D / 2 : side === 1 ? -D / 2 : t;
      parts.push(box(0.09, 1.15, 0.09, px, y + 0.57, pz));
    }
    for (const ry of [1.12, 0.65, 0.25]) {
      if (openFrom === null) parts.push(side < 2 ? box(along, 0.06, 0.06, 0, y + ry, side === 0 ? D / 2 : -D / 2) : box(0.06, 0.06, along, side === 2 ? W / 2 : -W / 2, y + ry, 0));
      else {
        const a = -along / 2, b = openFrom, c = openTo, d = along / 2;
        for (const [s0, s1] of [[a, b], [c, d]]) {
          const len = s1 - s0; if (len < 0.2) continue;
          const mid = (s0 + s1) / 2;
          parts.push(side < 2 ? box(len, 0.06, 0.06, mid, y + ry, side === 0 ? D / 2 : -D / 2) : box(0.06, 0.06, len, side === 2 ? W / 2 : -W / 2, y + ry, mid));
        }
      }
    }
  };
  // platforms with stair openings; stairs run along +x side, alternating direction
  let prev = 0;
  levels.forEach((lv, idx) => {
    const dir = idx % 2 === 0 ? 1 : -1;
    // stair flight from prev to lv along z, at x = W/2 - 0.7
    const rise = lv - prev, run = D - 1.2, steps = Math.round(rise / 0.21);
    const x = W / 2 - 0.65;
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const f = sIdx / steps;
      const z = dir * (-run / 2 + f * run);
      plankParts.push(box(1.1, 0.05, run / steps + 0.03, x, prev + f * rise + 0.02, z));
    }
    // stringers
    const ang = Math.atan2(rise, run);
    for (const ox of [-0.5, 0.5]) {
      const g = new THREE.BoxGeometry(0.08, 0.3, Math.hypot(rise, run));
      g.rotateX(-dir * ang); g.translate(x + ox, prev + rise / 2 - 0.1, 0); parts.push(g);
    }
    // stair handrail
    for (const ox of [-0.55, 0.55]) {
      const g = new THREE.BoxGeometry(0.06, 0.06, Math.hypot(rise, run));
      g.rotateX(-dir * ang); g.translate(x + ox, prev + rise / 2 + 0.95, 0); parts.push(g);
      for (let k = 0; k <= 4; k++) { const f = k / 4; parts.push(box(0.06, 1.0, 0.06, x + ox, prev + f * rise + 0.5, dir * (-run / 2 + f * run))); }
    }
    // platform (floor with an opening above the stair top end)
    const openZ = dir * (run / 2 - 0.9);
    plankParts.push(box(W - 1.3, 0.14, D, -0.65, lv, 0));
    // the strip over the stairs, minus opening
    const stripLen = D - 2.2;
    plankParts.push(box(1.3, 0.14, stripLen, W / 2 - 0.65, lv, -dir * 1.1));
    // railings
    railing(lv, 0, null); railing(lv, 1, null); railing(lv, 3, null);
    railing(lv, 2, dir > 0 ? openZ - 1.0 : openZ - 1.0, dir > 0 ? openZ + 1.0 : openZ + 1.0);
    prev = lv;
  });
  // top roof frame
  plankParts.push(box(W + 0.6, 0.12, D + 0.6, 0, top, 0));
  for (const sx of [-1, 1]) parts.push(box(0.14, 0.14, D + 0.6, sx * (W / 2 + 0.2), top - 0.15, 0));
  for (const sz of [-1, 1]) parts.push(box(W + 0.6, 0.14, 0.14, 0, top - 0.15, sz * (D / 2 + 0.2)));

  const frameGeo = mergeGeometries(parts.map(g => g.toNonIndexed()), false);
  const plankGeo = mergeGeometries(plankParts.map(g => g.toNonIndexed()), false);
  const woodTex = TEX.plank();
  const frameMat = registerWetMaterial(new THREE.MeshStandardMaterial({ color: 0x3a352f, roughness: 0.85, metalness: 0.1 }));
  const plankMat = registerWetMaterial(new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9a8f80, roughness: 0.9 }));
  const group = new THREE.Group();
  const frame = new THREE.Mesh(frameGeo, frameMat); frame.castShadow = true; frame.receiveShadow = true;
  const planks = new THREE.Mesh(plankGeo, plankMat); planks.castShadow = true; planks.receiveShadow = true;
  group.add(frame, planks);
  return group;
}

const dockCache = new Map();
let sharedDockMaterials = null;

function dockMaterials() {
  if (sharedDockMaterials) return sharedDockMaterials;
  const woodTex = sharedResource(TEX.plank());
  sharedDockMaterials = {
    frameMat: sharedResource(registerWetMaterial(new THREE.MeshStandardMaterial({ color: 0x3a352f, roughness: 0.85 }))),
    plankMat: sharedResource(registerWetMaterial(new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9a8f80, roughness: 0.9 }))),
  };
  return sharedDockMaterials;
}

function dockResources(length, width) {
  const key = `${length}:${width}`;
  if (dockCache.has(key)) return dockCache.get(key);
  const parts = [], plankParts = [];
  const n = Math.ceil(length / 3);
  for (let i = 0; i <= n; i++) {
    const z = -(i / n) * length;
    for (const sx of [-1, 1]) parts.push(box(0.2, 3.4, 0.2, sx * (width / 2 - 0.15), -0.9, z));
    parts.push(box(width, 0.14, 0.14, 0, 0.6, z));
  }
  plankParts.push(box(width, 0.12, length + 0.4, 0, 0.75, -length / 2));
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= n * 2; i++) parts.push(box(0.08, 1.0, 0.08, sx * width / 2, 1.25, -(i / (n * 2)) * length));
    parts.push(box(0.06, 0.06, length, sx * width / 2, 1.75, -length / 2));
  }
  const frameGeo = sharedResource(mergeGeometries(parts.map(g => g.toNonIndexed()), false));
  const plankGeo = sharedResource(TEX.scaleTextureUvs(mergeGeometries(plankParts.map(g => g.toNonIndexed()), false), 1, 4));
  const { frameMat, plankMat } = dockMaterials();
  const resources = { frameGeo, plankGeo, frameMat, plankMat };
  dockCache.set(key, resources);
  return resources;
}

export function buildDock(length = 14, width = 2.0) {
  const { frameGeo, plankGeo, frameMat, plankMat } = dockResources(length, width);
  const g = new THREE.Group();
  const a = new THREE.Mesh(frameGeo, frameMat); a.castShadow = true; a.receiveShadow = true;
  const b = new THREE.Mesh(plankGeo, plankMat); b.castShadow = true; b.receiveShadow = true;
  g.add(a, b);
  return g;
}
