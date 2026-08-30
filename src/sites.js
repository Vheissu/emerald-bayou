import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { buildDock } from './tower.js';
import { buildSkiff } from './npc.js';
import * as TEX from './textures.js';
import { person, animatePerson, wave, aim, fishingUpdate, cooler, chair, bucket, fishingLine } from './folk.js';
import { spawn, SPEC } from './models.js';
import { cachedResource, sharedResource } from './cache.js';
import { registerWetMaterial } from './surfacewetness.js';

// The people who live out here: stilt houses with a dock and a washing line, public boat ramps with a truck and an
// empty trailer, tin-roof boathouses over the water, duck blinds in the shallows. One per ~800 m cell, seeded, placed
// against the procedural bank the same way the fish camps are, built only while the boat is near.
export const SITE_CELL = 800;

const geometryCache = new Map(), materialCache = new Map(), tintCache = new Map();
const geometry = (kind, args, create) => cachedResource(geometryCache, `${kind}:${args.join(':')}`, create);
const boxGeometry = (w, h, d) => geometry('box', [w, h, d], () => new THREE.BoxGeometry(w, h, d));
const cylinderGeometry = (r0, r1, h, seg = 8) => geometry('cylinder', [r0, r1, h, seg], () => new THREE.CylinderGeometry(r0, r1, h, seg));
const sphereGeometry = (r, w, h) => geometry('sphere', [r, w, h], () => new THREE.SphereGeometry(r, w, h));
const torusGeometry = (r, tube, radial, tubular) => geometry('torus', [r, tube, radial, tubular], () => new THREE.TorusGeometry(r, tube, radial, tubular));
const material = (key, params) => cachedResource(materialCache, key, () => registerWetMaterial(new THREE.MeshStandardMaterial(params)));

const wood = material('wood', { color: 0x6b5641, roughness: 0.95 });
const greyWood = material('grey-wood', { color: 0x8e877a, roughness: 0.95 });
const tin = material('tin', { color: 0x8d9391, roughness: 0.5, metalness: 0.6 });
const rustTin = material('rust-tin', { color: 0x7d6a58, roughness: 0.7, metalness: 0.45 });
const concrete = material('concrete', { color: 0x9d9a92, roughness: 0.95 });
const gravel = material('gravel', { color: 0x7e7a70, roughness: 1 });
const rubber = material('rubber', { color: 0x1c1d1c, roughness: 0.9 });
const steel = material('steel', { color: 0x5c5f5c, roughness: 0.4, metalness: 0.8 });
const reedMat = material('reed', { color: 0x9a8a55, roughness: 1 });
const white = material('white', { color: 0xe8e4da, roughness: 0.6 });
const sh = (o) => { o.castShadow = true; o.receiveShadow = true; return o; };
const box = (w, h, d, x, y, z, m = wood) => { const b = new THREE.Mesh(boxGeometry(w, h, d), m); b.position.set(x, y, z); return sh(b); };
const cyl = (r0, r1, h, x, y, z, m = wood, seg = 8) => { const c = new THREE.Mesh(cylinderGeometry(r0, r1, h, seg), m); c.position.set(x, y, z); return sh(c); };

let signCache = new Map();
function signTex(lines) {
  const key = lines.join('|'); if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#2f5a3a'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#2f5a3a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = `${i === 0 ? 'bold 34px' : '600 21px'} "Avenir Next Condensed", "Arial Narrow", Impact, sans-serif`; g.fillText(l, 128, lines.length === 1 ? 64 : 40 + i * 38); });
  const t = sharedResource(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; signCache.set(key, t); return t;
}
function signPost(lines, h = 2.2) {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.06, h, 0, h / 2, 0, greyWood, 6));
  const signKey = lines.join('|');
  const board = new THREE.Mesh(boxGeometry(1.2, 0.6, 0.04), [greyWood, greyWood, greyWood, greyWood, material(`sign:${signKey}`, { map: signTex(lines), roughness: 0.7 }), greyWood]);
  board.position.set(0, h - 0.35, 0.03); sh(board); g.add(board);
  return g;
}

function truck(rr) {
  const g = new THREE.Group();
  const paintColor = [0xd9d5c8, 0xa12f22, 0x2a4f7a, 0x4d5a3c, 0x1f1f1f][Math.floor(rr() * 5)];
  const paint = material(`truck-paint:${paintColor}`, { color: paintColor, roughness: 0.35, metalness: 0.5 });
  g.add(box(2.0, 0.55, 5.4, 0, 0.75, 0, paint)); // chassis / bed sides
  g.add(box(1.85, 0.06, 2.6, 0, 1.0, 1.2, rubber)); // bed floor
  g.add(box(1.9, 0.75, 1.7, 0, 1.4, -0.9, paint)); // cab
  g.add(box(1.7, 0.6, 1.5, 0, 1.75, -0.9, material('truck-glass', { color: 0x1a2530, roughness: 0.2, metalness: 0.6 }))); // glass
  g.add(box(1.9, 0.5, 1.6, 0, 0.98, -2.6, paint)); // hood
  g.userData.wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1.9, 1.7]) { const w = cyl(0.42, 0.42, 0.32, sx * 0.95, 0.42, sz, rubber, 12); w.rotation.z = Math.PI / 2; g.add(w); g.userData.wheels.push(w); }
  const lampM = new THREE.MeshStandardMaterial({ color: 0x6a1a12, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.4 });
  lampM.userData.streamOwned = true;
  for (const sx of [-0.8, 0.8]) g.add(box(0.18, 0.22, 0.04, sx, 0.85, 2.72, lampM));
  g.userData.lamps = lampM;
  return g;
}
function trailer() {
  const g = new THREE.Group();
  for (const sx of [-0.7, 0.7]) g.add(box(0.08, 0.1, 5.0, sx, 0.55, 0, steel));
  g.add(box(0.1, 0.1, 2.2, 0, 0.5, -3.4, steel)); g.add(box(1.5, 0.1, 0.1, 0, 0.55, 0.5, steel));
  g.userData.wheels = [];
  for (const sx of [-1, 1]) { const w = cyl(0.3, 0.3, 0.22, sx * 0.85, 0.3, 0.6, rubber, 12); w.rotation.z = Math.PI / 2; g.add(w); g.userData.wheels.push(w); }
  for (const sx of [-0.35, 0.35]) g.add(box(0.12, 0.08, 4.0, sx, 0.62, 0, material('trailer-bunk', { color: 0x8a8a8a, roughness: 0.9 }))); // bunks
  g.add(cyl(0.04, 0.04, 0.9, 0, 1.0, -4.3, steel, 6)); // winch post
  return g;
}
// a boat somebody trails to the ramp: one of the Meshy hulls with a driver at the helm, or a johnboat with its crew
function trailBoat(rr) {
  const r = rr();
  if (r < 0.45) { const g = buildSkiff({ crew: true }); recolor(g, 0x6f7570, [0x6f7570, 0x4c6b4a, 0xb8b4a8][Math.floor(rr() * 3)]); g.userData.len = 4.6; return g; }
  const name = r < 0.7 ? 'beau_boat' : r < 0.85 ? 'sandbox_boat' : 'boat_dreams';
  const g = spawn(name); g.userData.len = SPEC[name].len;
  const d = person(rr, { pose: 'sit', hat: true, drive: true }); d.position.set(name === 'boat_dreams' ? 0.45 : 0, SPEC[name].y + (name === 'boat_dreams' ? 0.35 : 0.05), name === 'boat_dreams' ? 0.4 : 0.5); d.rotation.y = Math.PI; g.add(d); g.userData.people = [d];
  return g;
}
function recolor(group, from, to) {
  group.traverse(o => {
    if (!o.isMesh || !o.material?.color || o.material.color.getHex() !== from) return;
    const source = o.material, key = `${source.uuid}:${to}`;
    o.material = cachedResource(tintCache, key, () => { const tinted = source.clone(); tinted.color.setHex(to); return registerWetMaterial(tinted); });
  });
}
// ---- kinds ----
function stiltHouse(rr, T, s) {
  const g = new THREE.Group();
  const H = 1.7, W = 6.2, D = 5.0;
  for (const sx of [-2.6, 0, 2.6]) for (const sz of [-2.1, 2.1]) g.add(cyl(0.11, 0.13, H + 0.6, sx, H / 2 - 0.2, sz));
  g.add(box(W, 0.14, D, 0, H, 0));
  const wallColor = [0x9aa08a, 0xb8b09a, 0x7f8c7a, 0xa88f72][Math.floor(rr() * 4)];
  const wall = material(`house-wall:${wallColor}`, { color: wallColor, roughness: 0.95 });
  g.add(box(W - 0.6, 2.3, D - 0.6, 0, H + 1.22, 0, wall));
  // windows and a screen door on the porch side (+z)
  const glass = material('house-glass', { color: 0x22302a, roughness: 0.3, metalness: 0.3 });
  for (const sx of [-1.7, 1.7]) g.add(box(1.0, 0.8, 0.06, sx, H + 1.5, D / 2 - 0.27, glass));
  g.add(box(0.85, 1.9, 0.06, 0, H + 1.05, D / 2 - 0.27, material('house-door', { color: 0x3a3530, roughness: 1 })));
  // porch deck out the front with a rail
  g.add(box(W, 0.12, 2.2, 0, H, D / 2 + 1.1));
  for (const sx of [-W / 2 + 0.1, -W / 4, 0, W / 4, W / 2 - 0.1]) g.add(box(0.08, 1.0, 0.08, sx, H + 0.55, D / 2 + 2.1));
  g.add(box(W, 0.06, 0.06, 0, H + 1.05, D / 2 + 2.1));
  // tin gable roof
  const roofM = rr() < 0.5 ? tin : rustTin;
  for (const sx of [-1, 1]) { const r = box(W / 2 + 0.7, 0.06, D + 3.2, sx * (W / 4 + 0.1), H + 2.9, 0.6, roofM); r.rotation.z = -sx * 0.42; g.add(r); }
  // steps down the side
  for (let i = 0; i < 5; i++) g.add(box(0.9, 0.05, 0.3, -W / 2 - 0.5, H - i * 0.34, -1.2 + i * 0.32));
  // propane tank, water butt, a satellite dish
  g.add(cyl(0.35, 0.35, 1.4, W / 2 + 0.9, 0.7, -1.4, white, 12).rotateZ(Math.PI / 2));
  g.add(cyl(0.45, 0.45, 1.0, -W / 2 - 1.3, 0.5, 1.5, material('water-butt', { color: 0x3a4d3f, roughness: 0.9 }), 12));
  const dish = cyl(0.35, 0.35, 0.04, W / 2 - 0.4, H + 3.2, -1.5, white, 16); dish.rotation.x = -0.9; g.add(dish);
  // washing line with three towels
  const lx = -W / 2 - 3.5; g.add(cyl(0.04, 0.05, 2.0, lx, 1.0, -2.5, greyWood, 6)); g.add(cyl(0.04, 0.05, 2.0, lx, 1.0, 2.5, greyWood, 6));
  const line = cyl(0.008, 0.008, 5.0, lx, 1.9, 0, steel, 4); line.rotation.x = Math.PI / 2; g.add(line);
  const tCols = [0xd9553a, 0x3c6aa3, 0xe8e0c8, 0x8ab06a]; for (let i = 0; i < 3; i++) { const towelColor = tCols[(i + Math.floor(rr() * 4)) % 4]; const tw = box(0.05, 0.7, 0.8, lx, 1.55, -1.6 + i * 1.6, material(`towel:${towelColor}`, { color: towelColor, roughness: 1, side: THREE.DoubleSide })); tw.userData.towel = true; g.add(tw); }
  g.userData.towels = g.children.filter(c => c.userData.towel);
  // somebody on the porch more often than not, in a chair, watching the water
  g.userData.people = [];
  if (rr() < 0.65) { const ch = chair(rr); ch.position.set(1.7, H + 0.07, D / 2 + 0.9); g.add(ch); const p = person(rr, { pose: 'sit' }); p.position.copy(ch.position); g.add(p); g.userData.people.push(p); }
  return g;
}
function boatRamp(rr, s, T) {
  const g = new THREE.Group();
  // the slab and the gravel pad follow the real bank (a straight slab from hBot to hTop runs under a convex bank):
  // sample the heightfield along the ramp axis in the ramp's own frame (local +z is up the bank)
  const R = Math.atan2(-Math.cos(s.ang), -Math.sin(s.ang)), cR = Math.cos(R), sR = Math.sin(R);
  const hAt = (x, z) => T.hf.compute(s.x + x * cR + z * sR, s.z - x * sR + z * cR) - s.h;
  const raw = []; for (let z = -12; z <= 20; z++) raw.push(hAt(0, z));
  const prof = raw.map((v, i) => (raw[Math.max(0, i - 1)] + v * 2 + raw[Math.min(raw.length - 1, i + 1)]) / 4);
  const P = (z) => { const f = Math.max(0, Math.min(prof.length - 1.001, z + 12)); const i = Math.floor(f); return prof[i] + (prof[i + 1] - prof[i]) * (f - i); };
  const strip = (w, z0, z1, mat, wide) => {
    const n = z1 - z0; const geo = new THREE.PlaneGeometry(w, n, wide ? 6 : 2, n); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const y = wide ? P(z) * 0.5 + hAt(x, z) * 0.5 : P(z); pos.setY(i, y + 0.12); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
  };
  g.add(strip(4.6, -11, 9, concrete, false)); g.add(strip(10, 9, 18, gravel, true));
  const sign = signPost(['BOAT RAMP', 'IDLE SPEED · NO WAKE']); sign.position.set(3.2, hAt(3.2, 7.5) + 0.05, 7.5); sign.rotation.y = Math.PI; g.add(sign);
  for (const sx of [-2.9, 2.9]) g.add(cyl(0.12, 0.14, 1.4, sx, P(-4) + 0.5, -4, greyWood, 6));
  // the launch: a pickup with a boat on the trailer, a spotter at the water's edge waving it back
  const tr = truck(rr); tr.rotation.y = Math.PI; g.add(tr);
  const tl = trailer(); tl.rotation.y = Math.PI; g.add(tl);
  const boat = trailBoat(rr); g.add(boat);
  const spot = person(rr, { pose: 'stand' }); spot.position.set(2.6, hAt(2.6, 2.0) + 0.02, 2.0); spot.rotation.y = Math.PI * 0.5; g.add(spot);
  const slabY = (z) => P(z) + 0.12;
  const pitch = (z) => -Math.atan((P(z + 1) - P(z - 1)) / 2);
  g.userData.ramp = { truck: tr, trailer: tl, boat, spot, slabY, pitch, off: rr() * 150, period: 150, far: 60, hS: s.h, wheelSpin: 0, lastZ: 14.5 };
  g.userData.people = [spot, ...(boat.userData.people || [])];
  // a second car parked up on the pad now and then
  if (rr() < 0.4) { const car = truck(rr); car.position.set(3.6, hAt(3.6, 15.5) + 0.08, 15.5); car.rotation.y = Math.PI + 0.25; g.add(car); }
  return g;
}
// piecewise-linear keyframes with smooth easing between them
function keyed(u, keys) {
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; const k = t1 > t0 ? (u - t0) / (t1 - t0) : 1; const e = k * k * (3 - 2 * k); return v0 + (v1 - v0) * e; }
  return keys[keys.length - 1][1];
}
const TRUCK_Z = [[0, 14.5], [20, 14.5], [36, -1.5], [44, -1.5], [58, 14.5], [95, 14.5], [108, -1.5], [128, -1.5], [142, 14.5], [150, 14.5]];
// the whole cycle is a function of time, so a ramp is mid-launch when you arrive and keeps going when you leave
function animateRamp(g, t, waveFn, ctx) {
  const R = g.userData.ramp, u = (t + R.off) % R.period;
  const tz = keyed(u, TRUCK_Z); const moving = Math.abs(tz - R.lastZ) > 1e-4; const dz = tz - R.lastZ; R.lastZ = tz;
  const truck = R.truck, tl = R.trailer, boat = R.boat;
  truck.position.set(0, R.slabY(tz), tz); truck.rotation.set(R.pitch(tz), Math.PI, 0);
  const tlz = tz - 5.2; tl.position.set(0, R.slabY(tlz), tlz); tl.rotation.set(R.pitch(tlz), Math.PI, 0);
  for (const w of truck.userData.wheels) w.rotation.x -= dz / 0.42; for (const w of tl.userData.wheels) w.rotation.x -= dz / 0.3;
  truck.userData.lamps.emissiveIntensity = dz < -1e-4 ? 1.6 : 0;
  // the boat: on the bunks, floating off, running out to the channel and back, winched back on
  const gx = g.position, water = () => waveFn(gx.x, gx.z, t) - R.hS;
  const bunk = R.slabY(tlz) + 0.55; let bz, by, heading = Math.PI, vis = true, speed = 0;
  if (u < 36 || u >= 128) { bz = tlz + 0.3; by = Math.max(bunk, water()) * (u >= 121 ? 1 : 1); by = Math.max(bunk, water()); }
  else if (u < 44) { const k = (u - 36) / 8; bz = tlz + 0.3 - 6 * k * k; by = Math.max(bunk, water()); heading = Math.PI; }
  else if (u < 70) { const k = (u - 44) / 26; bz = tlz - 6 - (R.far + 30) * k * k; by = water(); heading = Math.PI - Math.min(1, k * 4) * Math.PI; speed = Math.min(1, k * 3); vis = bz > -R.far; }
  else if (u < 95) { vis = false; bz = -R.far - 10; by = water(); }
  else if (u < 121) { const k = (u - 95) / 26; bz = -R.far - 10 + (R.far + 4) * (1 - (1 - k) * (1 - k)); by = water(); heading = Math.PI; speed = 1 - k * 0.7; vis = bz > -R.far; }
  else { const k = (u - 121) / 7; bz = tlz - 6 + 6.3 * k; by = Math.max(bunk, water()); }
  boat.visible = vis; boat.position.set(0, by, bz); boat.rotation.set(by <= bunk + 0.01 && (u < 36 || u >= 121) ? R.pitch(tlz) : Math.sin(t * 1.1 + R.off) * 0.01, heading, 0);
  // the spotter: at the water's edge guiding while the truck moves, otherwise hands in pockets
  R.spot.userData.guide = moving ? 1 : 0;
  if (ctx) {
    // sound and wake for the running boat, collisions for everything solid
    const wp = boat.getWorldPosition(_v3);
    const d = Math.hypot(wp.x - ctx.bx, wp.z - ctx.bz);
    if (vis && speed > 0.05 && d < 90) {
      ctx.ob = Math.max(ctx.ob, speed * Math.max(0, 1 - d / 90));
      const fx = -Math.sin(heading + g.rotation.y), fz = -Math.cos(heading + g.rotation.y);
      if (d < 75) { if (ctx.emitStamp) ctx.emitStamp(wp.x - fx * 1.8, wp.z - fz * 1.8, 1.1, 0.5 * speed, 1.4 * speed, 1); else ctx.stamps?.push({ x: wp.x - fx * 1.8, z: wp.z - fz * 1.8, radius: 1.1, height: 0.5 * speed, foam: 1.4 * speed, foamRadius: 1 }); const n = Math.floor(50 * ctx.dt * speed + Math.random()); for (let i = 0; i < n; i++) ctx.plume.emit(wp.x - fx * 2.4 + (Math.random() - 0.5) * 0.8, 0.1, wp.z - fz * 2.4 + (Math.random() - 0.5) * 0.8, -fx * 1.5 + (Math.random() - 0.5), 0.5 + Math.random() * 1.2 * speed, -fz * 1.5 + (Math.random() - 0.5), 0.25 + Math.random() * 0.3, 0.9, 0.6 + Math.random() * 0.5, 0.25); }
    }
    const tw = truck.getWorldPosition(_v3b); const dT = Math.hypot(tw.x - ctx.bx, tw.z - ctx.bz);
    if (dT < 90) ctx.truck = Math.max(ctx.truck, (moving ? 1 : 0.25) * Math.max(0, 1 - dT / 90));
    const C = g.userData.colliders; if (C) { C[0].x = tw.x; C[0].z = tw.z; const tp = tl.getWorldPosition(_v3b); C[1].x = tp.x; C[1].z = tp.z; if (vis) { const fx = -Math.sin(heading + g.rotation.y), fz = -Math.cos(heading + g.rotation.y); C[2].ax = wp.x + fx * 2; C[2].az = wp.z + fz * 2; C[2].bx = wp.x - fx * 2; C[2].bz = wp.z - fz * 2; } else { C[2].ax = C[2].bx = 1e9; C[2].az = C[2].bz = 1e9; } }
  }
}
const _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();
function boathouse(rr) {
  const g = new THREE.Group();
  const L = 7.5, W = 3.8, H = 3.2;
  for (const sx of [-W / 2, W / 2]) for (const sz of [-L / 2, 0, L / 2]) g.add(cyl(0.12, 0.14, H + 1.5, sx, H / 2 - 0.7, sz, greyWood));
  for (const sx of [-1, 1]) { const r = box(W / 2 + 0.6, 0.06, L + 1.0, sx * (W / 4 + 0.05), H + 0.55, 0, rr() < 0.5 ? tin : rustTin); r.rotation.z = -sx * 0.5; g.add(r); }
  g.add(box(W + 0.4, 0.12, 0.12, 0, H + 0.1, -L / 2)); g.add(box(W + 0.4, 0.12, 0.12, 0, H + 0.1, L / 2));
  const walk = buildDock(L, 0.9); walk.position.set(W / 2 + 0.55, 0, L / 2); g.add(walk);
  const skiff = buildSkiff({ crew: false }); skiff.position.set(-0.4, -0.05, 0); skiff.rotation.y = (rr() - 0.5) * 0.1; skiff.rotation.order = 'YXZ'; g.add(skiff); g.userData.skiff = skiff;
  // a life ring on a post and a lamp
  const ring = new THREE.Mesh(torusGeometry(0.28, 0.07, 8, 20), material('life-ring', { color: 0xe25a2a, roughness: 0.7 })); ring.position.set(W / 2 + 0.05, 1.9, -L / 2 + 0.05); ring.rotation.y = Math.PI / 2; g.add(sh(ring));
  g.userData.people = [];
  if (rr() < 0.55) { const p = person(rr, { pose: 'crouch' }); p.position.set(W / 2 + 0.55, 0.81, 0.6); p.rotation.y = -Math.PI / 2; g.add(p); g.userData.people.push(p); const bk = bucket(); bk.position.set(W / 2 + 0.55, 0.81, 1.5); g.add(bk); }
  return g;
}
function duckBlind(rr) {
  const g = new THREE.Group();
  for (const sx of [-1.1, 1.1]) for (const sz of [-1.1, 1.1]) g.add(cyl(0.08, 0.1, 2.4, sx, 0.2, sz, greyWood, 6));
  g.add(box(2.6, 0.1, 2.6, 0, 1.1, 0, greyWood));
  for (const [x, z, w, d] of [[0, -1.3, 2.6, 0.25], [-1.3, 0, 0.25, 2.6], [1.3, 0, 0.25, 2.6]]) g.add(box(w, 1.1, d, x, 1.7, z, reedMat));
  g.userData.people = [];
  if (rr() < 0.7) for (const sx of [-0.55, 0.55]) { const p = person(rr, { pose: 'crouch', gun: true }); p.position.set(sx, 1.15, 0.1); p.rotation.y = Math.PI; g.add(p); g.userData.people.push(p); }
  g.userData.shotT = 20 + rr() * 60;
  // decoys bobbing around it
  const dark = material('decoy-body', { color: 0x2f2a24, roughness: 0.9 });
  g.userData.decoys = [];
  for (let i = 0; i < 5; i++) { const d = new THREE.Group(); const b = new THREE.Mesh(sphereGeometry(0.16, 8, 6), dark); b.scale.set(1, 0.6, 1.6); d.add(b); const h = new THREE.Mesh(sphereGeometry(0.08, 8, 6), material('decoy-head', { color: 0x2f6b3a, roughness: 0.8 })); h.position.set(0, 0.16, -0.22); d.add(h); const a = rr() * 6.28, r = 3 + rr() * 4; d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); d.rotation.y = rr() * 6.28; d.userData.ph = rr() * 6; g.add(d); g.userData.decoys.push(d); }
  return g;
}

// the water at (x,z) is a real channel, not a ditch: still water 14 m either side along the bank line
export function wideHere(hf, x, z, a) {
  const px = -Math.sin(a), pz = Math.cos(a);
  return hf.compute(x + px * 14, z + pz * 14) < -1.0 && hf.compute(x - px * 14, z - pz * 14) < -1.0;
}
// Choose and place a site in a cell, or null. Everything is derived from the cell seed.
export function pickSite(hf, key, cx, cz, rr, homeDist) {
  const kinds = ['house', 'ramp', 'boathouse', 'blind', 'house'];
  const kind = kinds[Math.floor(rr() * kinds.length)];
  for (let t = 0; t < 50; t++) {
    const x = cx + 120 + rr() * (SITE_CELL - 240), z = cz + 120 + rr() * (SITE_CELL - 240);
    if (homeDist(x, z) < 900) continue;
    const c = hf.computeBase(x, z);
    if (kind === 'blind') {
      const h = hf.compute(x, z); if (h > -0.35 || h < -1.0 || c.s > 0.6) continue;
      return { key, kind, x, z, h, ang: rr() * 6.28, seed: rr() * 1e9 | 0 };
    }
    if (kind === 'boathouse' || kind === 'ramp') {
      // start in open water and walk toward the shore; the shelf and the shoreline are found on the way
      if (c.s < 0.75 || c.h > -2.4 || c.lake > 0.5) continue;
      for (let a0 = rr() * 6.28, k = 0; k < 8; k++) {
        const a = a0 + k * Math.PI / 4; const dx = Math.cos(a), dz = Math.sin(a);
        let shelf = null, shore = null, prev = c.h;
        for (let r = 2; r <= 60; r += 2) {
          const h = hf.compute(x + dx * r, z + dz * r);
          if (!shelf && h > -1.9) shelf = { r: r - 2, h: prev };
          if (h > 0.05) { shore = { r, h }; break; }
          prev = h;
        }
        if (!shore) continue;
        if (kind === 'ramp') {
          const sx = x + dx * shore.r, sz = z + dz * shore.r;
          const hBot = hf.compute(sx - dx * 9, sz - dz * 9), hTop = hf.compute(sx + dx * 9, sz + dz * 9), hPad = hf.compute(sx + dx * 15, sz + dz * 15);
          if (hBot < -2.2 || hBot > -0.35 || hTop < 0.45 || hTop > 2.4 || Math.abs(hPad - hTop) > 0.9) continue;
          if (!wideHere(hf, sx - dx * 9, sz - dz * 9, a)) continue;
          return { key, kind, x: sx, z: sz, h: shore.h, ang: a + Math.PI, hTop, hBot, seed: rr() * 1e9 | 0 };
        }
        if (!shelf || shelf.h > -1.3 || shelf.h < -2.9) continue;
        const bx = x + dx * shelf.r, bz = z + dz * shelf.r;
        const bank = hf.compute(bx + dx * 11, bz + dz * 11);
        if (bank < 0.3 || bank > 2.0 || !wideHere(hf, bx, bz, a) || hf.compute(bx - dx * 14, bz - dz * 14) > -1.4) continue;
        return { key, kind, x: bx, z: bz, h: shelf.h, ang: a, seed: rr() * 1e9 | 0 };
      }
      continue;
    }
    // house: like a camp, deep water then a bank shelf, the house a little further up
    if (c.s < 0.85 || c.lake > 0.4 || c.h > -2.0) continue;
    for (let a0 = rr() * 6.28, k = 0; k < 8; k++) {
      const a = a0 + k * Math.PI / 4; let bank = null;
      if (!wideHere(hf, x, z, a)) continue;
      for (let r = 14; r <= 34; r += 4) { const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r; const h = hf.compute(bx, bz); if (h > 0.45 && h < 1.7) { bank = { x: bx, z: bz, h, r }; break; } if (h > 1.7) break; }
      if (!bank) continue;
      const hx = x + Math.cos(a) * (bank.r + 11), hz = z + Math.sin(a) * (bank.r + 11); const hh = hf.compute(hx, hz); if (hh < 0.4 || hh > 2.6) continue;
      return { key, kind, x: hx, z: hz, h: hh, ang: a, bank, tie: { x: x + Math.cos(a) * (bank.r - 9), z: z + Math.sin(a) * (bank.r - 9) }, seed: rr() * 1e9 | 0 };
    }
  }
  return null;
}

export function buildSite(s, T) {
  const rr = mulberry32(s.seed);
  const g = new THREE.Group(); g.name = 'site'; g.userData.people = []; g.userData.site = s;
  if (s.kind === 'house') {
    const h = stiltHouse(rr, T, s); h.position.set(s.x, s.h - 0.25, s.z); h.rotation.y = Math.atan2(-Math.cos(s.ang), -Math.sin(s.ang)); g.add(h); g.userData.house = h; g.userData.people.push(...h.userData.people);
    const dock = buildDock(14, 1.8); const dx = s.tie.x - s.bank.x, dz = s.tie.z - s.bank.z, l = Math.hypot(dx, dz);
    dock.position.set(s.bank.x, 0, s.bank.z); dock.rotation.y = Math.atan2(dx / l, dz / l) + Math.PI; g.add(dock);
    if (rr() < 0.7) { const sk = buildSkiff({ crew: false }); const side = rr() < 0.5 ? -1 : 1; sk.position.set(s.bank.x + dx / l * 9 + (-dz / l) * side * 2.4, -0.05, s.bank.z + dz / l * 9 + (dx / l) * side * 2.4); sk.rotation.y = Math.atan2(dx / l, dz / l) + (rr() - 0.5) * 0.3; sk.rotation.order = 'YXZ'; g.add(sk); g.userData.skiff = sk; g.userData.skiffWater = { x: sk.position.x, z: sk.position.z, heading: sk.rotation.y }; }
    // a big live oak or two behind the house
    if (rr() < 0.75) { const ry = h.rotation.y; const n = 1 + (rr() < 0.4 ? 1 : 0); for (let i = 0; i < n; i++) { const lx = (i ? 1 : -1) * (4 + rr() * 3), lz = -(6 + rr() * 4); const wx = s.x + lx * Math.cos(ry) + lz * Math.sin(ry), wz = s.z - lx * Math.sin(ry) + lz * Math.cos(ry); const tr = spawn('tree_c'); tr.position.set(wx, T.heightAt(wx, wz) - 0.1, wz); tr.rotation.y = rr() * 6.28; tr.scale.setScalar(0.85 + rr() * 0.35); g.add(tr); } }
    // a kid or an old man off the end of the dock with a rod
    if (rr() < 0.55) { const p = person(rr, { pose: 'sitEdge', rod: true, hat: rr() < 0.7 }); p.position.set(0.72, 0.81, -12.6); p.rotation.y = Math.PI / 2; dock.add(p); g.userData.people.push(p); const bk = bucket(); bk.position.set(-0.4, 0.81, -12.0); dock.add(bk); }
    s.colliders = [{ ax: s.bank.x, az: s.bank.z, bx: s.bank.x + dx / l * 14, bz: s.bank.z + dz / l * 14, r: 1.1, tag: 'dock' }, { x: s.x, z: s.z, r: 3.6, tag: 'house' }];
  } else if (s.kind === 'ramp') {
    const r = boatRamp(rr, s, T); r.position.set(s.x, s.h, s.z); r.rotation.y = Math.atan2(-Math.cos(s.ang), -Math.sin(s.ang)); g.add(r); g.userData.rampG = r; g.userData.people.push(...r.userData.people);
    s.colliders = [{ x: 1e9, z: 1e9, r: 2.6, tag: 'truck' }, { x: 1e9, z: 1e9, r: 1.3, tag: 'truck' }, { ax: 1e9, az: 1e9, bx: 1e9, bz: 1e9, r: 1.0, tag: 'boat' }];
    r.userData.colliders = s.colliders;
  } else if (s.kind === 'boathouse') {
    const b = boathouse(rr); b.position.set(s.x, 0, s.z); b.rotation.y = -s.ang; g.add(b); g.userData.skiff = b.userData.skiff; g.userData.people.push(...b.userData.people);
    const sk = b.userData.skiff, cy = Math.cos(b.rotation.y), sy = Math.sin(b.rotation.y);
    g.userData.skiffWater = { x: s.x + sk.position.x * cy + sk.position.z * sy, z: s.z - sk.position.x * sy + sk.position.z * cy, heading: b.rotation.y + sk.rotation.y };
    const fx = -Math.sin(b.rotation.y), fz = -Math.cos(b.rotation.y); // local -z
    const px = Math.cos(b.rotation.y), pz = -Math.sin(b.rotation.y); // local +x
    s.colliders = [];
    for (const sx of [-1.9, 1.9]) s.colliders.push({ ax: s.x + px * sx + fx * 3.75, az: s.z + pz * sx + fz * 3.75, bx: s.x + px * sx - fx * 3.75, bz: s.z + pz * sx - fz * 3.75, r: 0.35, tag: 'dock' });
    s.colliders.push({ ax: s.x + fx * 2, az: s.z + fz * 2, bx: s.x - fx * 2, bz: s.z - fz * 2, r: 1.0, tag: 'boat' });
  } else {
    const b = duckBlind(rr); b.position.set(s.x, 0, s.z); b.rotation.y = s.ang; g.add(b); g.userData.decoys = b.userData.decoys; g.userData.blind = b; g.userData.people.push(...b.userData.people);
    s.colliders = [{ x: s.x, z: s.z, r: 1.8, tag: 'blind' }];
  }
  for (const p of g.userData.people) if (p.userData.rod) { const ln = fishingLine(); ln.visible = false; g.add(ln); p.userData.line = ln; p.userData.lineTarget = new THREE.Vector3(); p.userData.castCd = 3 + rr() * 12; }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// per-frame life for a built site: boats bob, decoys bob, towels flap, the ramp runs its launch, people watch and wave
// ctx = { bx, bz, speed, dt, stamps, plume, spray, audio, fish, ob, truck } (ob / truck are written back: the loudest engine near the boat)
const _tip = new THREE.Vector3(), _dir = new THREE.Vector3();
const siteWaterAt = (waveFn, wakeAt, x, z, t) => waveFn(x, z, t) + (wakeAt ? wakeAt(x, z, t) : 0);
export function animateSite(g, t, waveFn, wind, ctx) {
  const sk = g.userData.skiff;
  if (sk) {
    const W = g.userData.skiffWater, wx = W ? W.x : sk.position.x, wz = W ? W.z : sk.position.z, heading = W ? W.heading : sk.rotation.y;
    const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading), wakeAt = ctx?.playerWakeAt;
    const center = siteWaterAt(waveFn, wakeAt, wx, wz, t);
    const bow = siteWaterAt(waveFn, wakeAt, wx + fx * 1.8, wz + fz * 1.8, t), stern = siteWaterAt(waveFn, wakeAt, wx - fx * 1.8, wz - fz * 1.8, t);
    const right = siteWaterAt(waveFn, wakeAt, wx + rx * 0.72, wz + rz * 0.72, t), left = siteWaterAt(waveFn, wakeAt, wx - rx * 0.72, wz - rz * 0.72, t);
    const pitch = Math.max(-0.22, Math.min(0.22, Math.atan2(bow - stern, 3.6)));
    const roll = Math.max(-0.3, Math.min(0.3, Math.atan2(right - left, 1.44)));
    const k = ctx ? 1 - Math.exp(-ctx.dt * 5) : 1;
    sk.userData.waterPitch = (sk.userData.waterPitch || 0) + (pitch - (sk.userData.waterPitch || 0)) * k;
    sk.userData.waterRoll = (sk.userData.waterRoll || 0) + (roll - (sk.userData.waterRoll || 0)) * k;
    sk.position.y = center - 0.05; sk.rotation.x = sk.userData.waterPitch; sk.rotation.z = sk.userData.waterRoll + Math.sin(t * 0.8 + wx) * 0.012;
  }
  if (g.userData.decoys) for (const d of g.userData.decoys) { d.position.y = waveFn(d.position.x, d.position.z, t) - 0.06; d.rotation.z = Math.sin(t * 1.4 + d.userData.ph) * 0.1; }
  const house = g.userData.house; if (house) { const w = wind ? wind.y : 0.5; let i = 0; for (const tw of house.userData.towels) { tw.rotation.x = 0.15 * w + Math.sin(t * 2.2 + i * 1.7) * 0.18 * w; i++; } }
  if (g.userData.rampG) animateRamp(g.userData.rampG, t, waveFn, ctx);
  if (!ctx) return;
  const dt = ctx.dt, boat = { x: ctx.bx, z: ctx.bz, speed: ctx.speed };
  const site = g.userData.site; const dSite = site ? Math.hypot(site.x - ctx.bx, site.z - ctx.bz) : 1e9;
  if ((ctx.humanActivity ?? 1) <= 0.2) return;
  // a shotgun from the blind now and then, when you are not right on top of it
  if (g.userData.blind && g.userData.blind.userData.people.length) { const b = g.userData.blind; b.userData.shotT -= dt; if (b.userData.shotT < 2.2 && dSite < 520 && !b.userData.aiming) { b.userData.aiming = true; aim(b.userData.people[Math.floor(Math.random() * b.userData.people.length)], 3.2); } if (b.userData.shotT <= 0) { b.userData.aiming = false; b.userData.shotT = 30 + Math.random() * 70; if (dSite > 40 && dSite < 520 && ctx.audio) { ctx.audio.shot(0.4 * (1 - dSite / 520), site.x, site.z); if (ctx.onShot) ctx.onShot(site.x, site.z); } } }
  if (dSite > 220) return; // people only move when you can see them
  for (const p of g.userData.people) {
    const u = p.userData;
    animatePerson(p, t, dt, boat, ctx);
    fishingUpdate(p, t, dt, waveFn, ctx);
    // a wave for a boat idling past
    u.waveCd = Math.max(0, (u.waveCd || 0) - dt);
    if (u.pose !== 'crouch' && !u.guide && u.waveCd <= 0) { p.getWorldPosition(_tip); const d = Math.hypot(_tip.x - ctx.bx, _tip.z - ctx.bz); if (d < 30 && ctx.speed < 6) { wave(p); u.waveCd = 45; } }
  }
}
