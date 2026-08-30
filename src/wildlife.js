import * as THREE from 'three';
import { spawn } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { emitWakeStamp } from './wakestamps.js';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = v => v - Math.floor(v);
const GATOR_WAKE_RANGE_SQ = 70 * 70;
const feedingDive = (phase, osprey, scatter) => smooth(osprey ? 0.48 : 0.52, osprey ? 0.64 : 0.67, phase) * (1 - smooth(osprey ? 0.74 : 0.76, osprey ? 0.9 : 0.91, phase)) * (1 - scatter);

function birdGeo() {
  const body = new THREE.SphereGeometry(0.11, 10, 8); body.scale(1, 0.75, 2.3);
  const neck = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 6); neck.rotateX(-Math.PI / 2 + 0.25); neck.translate(0, 0.06, -0.38);
  const head = new THREE.SphereGeometry(0.06, 8, 6); head.scale(1, 0.9, 1.5); head.translate(0, 0.13, -0.55);
  const beak = new THREE.ConeGeometry(0.02, 0.22, 6); beak.rotateX(-Math.PI / 2); beak.translate(0, 0.12, -0.72);
  const legs = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4); legs.rotateX(Math.PI / 2); legs.translate(0, -0.05, 0.45);
  const wingL = new THREE.PlaneGeometry(0.95, 0.42, 6, 1); wingL.translate(0.5, 0.03, 0.02);
  const wingR = new THREE.PlaneGeometry(0.95, 0.42, 6, 1); wingR.translate(-0.5, 0.03, 0.02);
  wingL.rotateX(-Math.PI / 2); wingR.rotateX(-Math.PI / 2);
  const tail = new THREE.PlaneGeometry(0.22, 0.3); tail.rotateX(-Math.PI / 2); tail.translate(0, 0.02, 0.36);
  const parts = [body, neck, head, beak, legs, wingL, wingR, tail].map(g => g.toNonIndexed());
  const geo = mergeGeometries(parts, false);
  // mark wing verts via attribute: wing factor = |x|
  return geo;
}

// Bird kinds: white ibis flocks wheeling over the trees, pelicans in single file a few metres off the water, vultures
// turning high on the thermals, swallows skimming the surface, one osprey working the channel.
const BIRD_KINDS = {
  ibis: { n: 8, scale: 1, color: 0xf4f2ec, alt: [14, 40], radius: [60, 180], speed: [0.05, 0.1], flap: [0.6, 1.1], freq: 7.5, spread: 22, vspread: 6, wob: 4, bank: 0.35 },
  pelican: { n: 5, scale: 2.3, color: 0x8e847a, alt: [4, 9], radius: [220, 380], speed: [0.028, 0.04], flap: [0.12, 0.28], freq: 3.0, spread: 0, vspread: 0.6, line: 5.5, wob: 0.4, bank: 0.2, water: true },
  vulture: { n: 3, scale: 1.9, color: 0x1e1c1a, alt: [55, 120], speed: [0.07, 0.1], radius: [40, 90], flap: [0.04, 0.09], freq: 2.5, spread: 25, vspread: 12, wob: 2, bank: 0.3 },
  swallow: { n: 10, scale: 0.45, color: 0x2f3a46, alt: [1.5, 6], radius: [14, 36], speed: [0.4, 0.7], flap: [0.9, 1.2], freq: 15, spread: 10, vspread: 3, wob: 3, bank: 0.6, water: true },
  osprey: { n: 1, scale: 1.6, color: 0xe4ded2, alt: [40, 75], radius: [50, 110], speed: [0.05, 0.07], flap: [0.15, 0.3], freq: 4, spread: 0, vspread: 0, wob: 1, bank: 0.25, call: true },
};
const FLOCKS = ['ibis', 'ibis', 'ibis', 'ibis', 'ibis', 'pelican', 'pelican', 'vulture', 'vulture', 'swallow', 'swallow', 'osprey'];

export class Birds {
  constructor(terrain, center = new THREE.Vector3()) {
    this.T = terrain;
    const geo = birdGeo();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = { value: 0 };
      this.shader = s;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aPhase; attribute float aFlap; attribute float aFreq;')
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          float wing = smoothstep(0.08, 0.2, abs(position.x));
          float f = sin(uTime * aFreq + aPhase) * aFlap;
          transformed.y += wing * f * (abs(position.x) * 0.9 + 0.12 * abs(position.x) * abs(position.x));
          transformed.x *= 1.0 - wing * abs(f) * 0.12;`);
    };
    const r = mulberry32(77);
    this.flocks = []; this.birds = [];
    let feedingPelicansAssigned = false;
    for (const kind of FLOCKS) {
      const K = BIRD_KINDS[kind]; const fi = this.flocks.length;
      const feedingRole = kind === 'osprey' ? 'osprey' : kind === 'pelican' && !feedingPelicansAssigned ? 'pelican' : '';
      if (feedingRole === 'pelican') feedingPelicansAssigned = true;
      this.flocks.push({ kind, K, cx: center.x + (r() - 0.5) * 300, cz: center.z + (r() - 0.5) * 300, radius: K.radius[0] + r() * (K.radius[1] - K.radius[0]), alt: K.alt[0] + r() * (K.alt[1] - K.alt[0]), speed: (K.speed[0] + r() * (K.speed[1] - K.speed[0])) * (r() < 0.5 ? 1 : -1), ph: r() * 7, callT: 5 + r() * 20, feedingRole, feedBlend: 0 });
      for (let i = 0; i < K.n; i++) this.birds.push({ flock: fi, i, off: new THREE.Vector3((r() - 0.5) * K.spread, (r() - 0.5) * K.vspread, (r() - 0.5) * K.spread), phase: r() * Math.PI * 2, flap: K.flap[0] + r() * (K.flap[1] - K.flap[0]) });
    }
    this.count = this.birds.length;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    const phase = new Float32Array(this.count), flap = new Float32Array(this.count), freq = new Float32Array(this.count);
    const col = new THREE.Color();
    for (let i = 0; i < this.count; i++) { const b = this.birds[i], K = this.flocks[b.flock].K; phase[i] = b.phase; flap[i] = b.flap; freq[i] = K.freq * (0.9 + 0.2 * (i % 3) / 2); col.setHex(K.color); this.mesh.setColorAt(i, col); }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flap, 1));
    geo.setAttribute('aFreq', new THREE.InstancedBufferAttribute(freq, 1));
    this.mesh.instanceColor.needsUpdate = true;
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
    this._look = new THREE.Matrix4(); this._up = new THREE.Vector3(0, 1, 0); this._tgt = new THREE.Vector3(); this._bank = new THREE.Quaternion(); this._z = new THREE.Vector3(0, 0, 1);
    this.audio = null; this.activity = 1;
    // Feeding birds redirect existing instance slots. The event never allocates another flock or draw call.
    this.feeding = { active: false, x: 0, z: 0, intensity: 0, scatter: 0 };
  }
  setFeedingActivity(activity = null) {
    const F = this.feeding;
    if (!activity || activity.active === false) { F.active = false; F.intensity = 0; F.scatter = 0; return; }
    F.active = true; F.x = Number(activity.x) || 0; F.z = Number(activity.z) || 0;
    F.intensity = clamp(Number(activity.intensity) || 0); F.scatter = clamp(Number(activity.scatter) || 0);
  }
  feedingSnapshot() {
    return { ...this.feeding, redirectedFlocks: this.flocks.filter(f => f.feedingRole).length, birdCapacity: this.count };
  }
  relocate(f, cam) {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 400; const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      if (f.K.water && this.T && this.T.heightAt(x, z) > -1.0) continue; // low flyers stay over the water
      f.cx = x; f.cz = z; return;
    }
  }
  update(t, cam, dt = 1 / 60) {
    if (this.shader) this.shader.uniforms.uTime.value = t;
    if (cam) for (const f of this.flocks) {
      const feedTarget = f.feedingRole && this.feeding.active ? this.feeding.intensity : 0;
      f.feedBlend += (feedTarget - f.feedBlend) * (1 - Math.exp(-dt * (feedTarget > f.feedBlend ? 0.95 : 0.28)));
      const d = Math.hypot(f.cx - cam.x, f.cz - cam.z);
      if (d > 900 && f.feedBlend < 0.035) this.relocate(f, cam);
      if (f.K.call && this.audio) { f.callT -= dt; if (f.callT <= 0) { f.callT = 18 + Math.random() * 30; if (d < 260) this.audio.osprey(0.2 * (1 - d / 300), f.cx, f.cz); } }
    }
    for (let i = 0; i < this.count; i++) {
      const b = this.birds[i]; const f = this.flocks[b.flock]; const K = f.K;
      const a = t * f.speed + f.ph - (K.line ? b.i * K.line / f.radius * Math.sign(f.speed) : 0);
      const wob = Math.sin(t * (f.kind === 'swallow' ? 3.1 : 0.7) + i) * K.wob;
      let x = f.cx + Math.cos(a) * f.radius + b.off.x + wob, z = f.cz + Math.sin(a) * f.radius * 0.7 + b.off.z;
      let y = f.alt + b.off.y + Math.sin(t * 0.9 + i * 2) * (f.kind === 'pelican' ? 0.3 : 1.5);
      const a2 = a + 0.02 * Math.sign(f.speed);
      let nx = f.cx + Math.cos(a2) * f.radius + b.off.x + wob, nz = f.cz + Math.sin(a2) * f.radius * 0.7 + b.off.z, ny = y;
      if (f.feedingRole && f.feedBlend > 0.001) {
        const osprey = f.feedingRole === 'osprey', cycleRate = osprey ? 0.086 : 0.071, cycleOffset = osprey ? 0 : b.i * 0.173;
        const cycle = fract(t * cycleRate + cycleOffset + f.ph * 0.09);
        const nextCycle = fract((t + 0.055) * cycleRate + cycleOffset + f.ph * 0.09);
        const dive = feedingDive(cycle, osprey, this.feeding.scatter), nextDive = feedingDive(nextCycle, osprey, this.feeding.scatter), orbit = osprey ? 24 : 34;
        const feedA = t * (osprey ? 0.42 : 0.27) + f.ph + b.i * (osprey ? 0 : 1.18);
        const feedA2 = (t + 0.055) * (osprey ? 0.42 : 0.27) + f.ph + b.i * (osprey ? 0 : 1.18);
        const spread = 1 + this.feeding.scatter * 1.35;
        const radius = orbit * (1 - dive * 0.9) * spread, radius2 = orbit * (1 - nextDive * 0.9) * spread;
        const baseY = osprey ? 17 : 7.2;
        const feedX = this.feeding.x + Math.cos(feedA) * radius + b.off.x * 0.18;
        const feedZ = this.feeding.z + Math.sin(feedA) * radius * 0.76 + b.off.z * 0.18;
        const feedY = baseY - dive * (baseY - 0.42) + this.feeding.scatter * (osprey ? 18 : 12) + Math.sin(t * 0.8 + i) * 0.35;
        const feedNX = this.feeding.x + Math.cos(feedA2) * radius2 + b.off.x * 0.18;
        const feedNZ = this.feeding.z + Math.sin(feedA2) * radius2 * 0.76 + b.off.z * 0.18;
        const feedNY = baseY - nextDive * (baseY - 0.42) + this.feeding.scatter * (osprey ? 18 : 12) + Math.sin((t + 0.055) * 0.8 + i) * 0.35;
        x += (feedX - x) * f.feedBlend; y += (feedY - y) * f.feedBlend; z += (feedZ - z) * f.feedBlend;
        nx += (feedNX - nx) * f.feedBlend; ny += (feedNY - ny) * f.feedBlend; nz += (feedNZ - nz) * f.feedBlend;
      }
      this._p.set(x, y, z); this._tgt.set(nx, y, nz);
      this._tgt.y = ny;
      this._look.lookAt(this._tgt, this._p, this._up);
      this._q.setFromRotationMatrix(this._look);
      this._bank.setFromAxisAngle(this._z, Math.sign(f.speed) * K.bank);
      this._q.multiply(this._bank);
      this._s.setScalar(i < this.count * this.activity || (f.feedingRole && f.feedBlend > 0.035) ? K.scale : 0);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// A spot with ground height in [hMin,hMax] between rMin and rMax metres of (bx,bz). Used to keep wildlife around the
// boat wherever it is in the world instead of pinning it to the start area.
export function findNear(T, rand, bx, bz, rMin, rMax, hMin, hMax, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const a = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin);
    const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
    const h = T.heightAt(x, z); if (h >= hMin && h <= hMax) return { x, z, h };
  }
  return null;
}

// Wading birds (egrets): stand in the shallows, flush when a boat comes in fast, settle again further off.
export class Waders {
  constructor(terrain, count, cx, cz) {
    this.T = terrain; this.list = []; this.rand = mulberry32(5); this.activity = 1;
    for (let i = 0; i < count; i++) {
      const spot = findNear(terrain, this.rand, cx, cz, 20, 260, -0.35, 0.05, 400) || { x: cx, z: cz, h: 0 };
      const mesh = wadingBird(); mesh.position.set(spot.x, Math.max(spot.h, -0.1) + 0.02, spot.z); mesh.rotation.y = this.rand() * Math.PI * 2;
      this.list.push({ mesh, x: spot.x, z: spot.z, y: mesh.position.y, fly: 0, vx: 0, vz: 0, vy: 0, ph: this.rand() * 6 });
    }
  }
  update(dt, t, bx, bz, bs) {
    for (let wi = 0; wi < this.list.length; wi++) {
      const w = this.list[wi]; w.mesh.visible = wi < this.list.length * this.activity;
      if (!w.mesh.visible) continue;
      const d = Math.hypot(w.x - bx, w.z - bz);
      if (w.fly <= 0) {
        if (d > 650) { // too far behind: reappear somewhere ahead
          const spot = findNear(this.T, this.rand, bx, bz, 150, 420, -0.35, 0.05);
          if (spot) { w.x = spot.x; w.z = spot.z; w.y = Math.max(spot.h, -0.1) + 0.02; w.mesh.position.set(w.x, w.y, w.z); }
          continue;
        }
        if (d < 22 && bs > 3) { // flush
          const ax = (w.x - bx) / (d || 1), az = (w.z - bz) / (d || 1);
          const side = this.rand() < 0.5 ? -1 : 1;
          w.vx = (ax * 0.8 - az * 0.4 * side) * 7; w.vz = (az * 0.8 + ax * 0.4 * side) * 7; w.vy = 2.2; w.fly = 5 + this.rand() * 3;
          w.mesh.rotation.y = Math.atan2(-w.vx, -w.vz);
          if (this.onFlush) this.onFlush(w, d);
        }
        w.mesh.rotation.z = Math.sin(t * 0.8 + w.ph) * 0.02;
        continue;
      }
      w.fly -= dt;
      const prog = 1 - w.fly / 8;
      w.x += w.vx * dt; w.z += w.vz * dt;
      w.vy += (Math.sin(t * 9 + w.ph) * 1.5 - 0.4 - (w.fly < 2 ? 1.2 : 0)) * dt * 1.2;
      w.y += w.vy * dt;
      const gh = Math.max(this.T.heightAt(w.x, w.z), -0.1) + 0.02;
      if (w.fly < 2.5 && w.y <= gh + 0.05) { w.y = gh; w.fly = 0; w.vy = 0; }
      w.y = Math.max(w.y, gh);
      w.mesh.position.set(w.x, w.y, w.z);
      w.mesh.rotation.x = -0.25 + Math.sin(t * 9 + w.ph) * 0.08;
      w.mesh.rotation.z = Math.sin(t * 9 + w.ph) * 0.35;
      if (w.fly <= 0) { w.mesh.rotation.x = 0; w.mesh.rotation.z = 0; if (this.T.heightAt(w.x, w.z) > 0.3 || this.T.heightAt(w.x, w.z) < -0.6) { const spot = findNear(this.T, this.rand, w.x, w.z, 5, 60, -0.35, 0.05); if (spot) { w.x = spot.x; w.z = spot.z; w.y = Math.max(spot.h, -0.1) + 0.02; w.mesh.position.set(w.x, w.y, w.z); } } }
    }
  }
}

let wadingBirdTemplate = null;
function buildWadingBird() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), white); body.scale.set(1, 0.9, 1.9); body.position.y = 0.72; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.48, 6), white); neck.position.set(0, 0.97, -0.16); neck.rotation.x = 0.5; g.add(neck);
  const neck2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), white); neck2.position.set(0, 1.25, -0.1); neck2.rotation.x = -0.4; g.add(neck2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), white); head.scale.set(1, 0.9, 1.6); head.position.set(0, 1.4, -0.16); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.24, 6), new THREE.MeshStandardMaterial({ color: 0xd9b24a })); beak.rotation.x = -Math.PI / 2 - 0.15; beak.position.set(0, 1.38, -0.34); g.add(beak);
  const legGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.72, 4);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(legGeometry, dark); leg.position.set(sx * 0.05, 0.36, 0.05); g.add(leg); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// These animals are permanent residents. Clone their transform trees while sharing the immutable geometry and
// materials, instead of uploading an identical set of buffers for every animal in the population.
export function wadingBird() {
  if (!wadingBirdTemplate) wadingBirdTemplate = buildWadingBird();
  return wadingBirdTemplate.clone(true);
}

let manateeTemplate = null;
function buildManatee() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5e5f5a, roughness: 0.85 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), mat); body.scale.set(1, 0.8, 2.6); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat); head.position.set(0, -0.02, -1.45); head.scale.set(1, 0.85, 1.1); g.add(head);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.5, 0.9, 12), mat); tail.rotation.x = Math.PI / 2; tail.scale.set(1.6, 1, 0.25); tail.position.set(0, 0, 1.75); g.add(tail);
  const flipperGeometry = new THREE.SphereGeometry(0.22, 10, 8);
  for (const sx of [-1, 1]) { const fl = new THREE.Mesh(flipperGeometry, mat); fl.scale.set(0.5, 0.25, 1); fl.position.set(sx * 0.55, -0.2, -0.6); fl.rotation.y = sx * 0.4; g.add(fl); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function manateeMesh() {
  if (!manateeTemplate) manateeTemplate = buildManatee();
  return manateeTemplate.clone(true);
}

export class Manatees {
  constructor(terrain, count, start) {
    this.T = terrain; this.list = []; this.surfaceActivity = 1;
    const r = mulberry32(31);
    for (let i = 0; i < count; i++) {
      const m = manateeMesh();
      const z = start.z - 20 - i * 35, x = terrain.riverCenterX(z) + (r() - 0.5) * 30;
      const speed = 0.6 + r() * 0.5;
      this.list.push({
        mesh: m, pos: new THREE.Vector3(x, -0.7, z), heading: r() * Math.PI * 2, escapeHeading: 0,
        t: r() * 50, speed, cruiseSpeed: speed, ph: r() * 6, zoneKey: `manatee:${i}`,
        avoidT: 0, diveT: 0, diveBlend: 0, zoneT: 0, strikeT: 0, nearMissT: 0, surfaced: false,
      });
    }
  }
  alert(m, bx, bz, severity = 1) {
    if (!m) return;
    const dx = m.pos.x - bx, dz = m.pos.z - bz;
    if (dx * dx + dz * dz > 0.01) m.escapeHeading = Math.atan2(-dx, -dz);
    m.avoidT = Math.max(m.avoidT, 4.5 + severity * 2.5);
    m.diveT = Math.max(m.diveT, 5.5 + severity * 3.5);
    m.zoneT = Math.max(m.zoneT, 10);
  }
  update(dt, t, bx = 0, bz = 0) {
    if (!this.rand) this.rand = mulberry32(77);
    for (const m of this.list) {
      m.avoidT = Math.max(0, m.avoidT - dt); m.diveT = Math.max(0, m.diveT - dt);
      m.zoneT = Math.max(0, m.zoneT - dt); m.strikeT = Math.max(0, m.strikeT - dt); m.nearMissT = Math.max(0, m.nearMissT - dt);
      if (!m.held && Math.hypot(m.pos.x - bx, m.pos.z - bz) > 700) {
        const spot = findNear(this.T, this.rand, bx, bz, 180, 450, -6, -2.4);
        if (spot) {
          m.pos.x = spot.x; m.pos.z = spot.z; m.avoidT = 0; m.diveT = 0; m.diveBlend = 0;
          m.zoneT = 0; m.strikeT = 0; m.nearMissT = 0;
        }
      }
      // Wander in deep water. A fast hull makes them turn away and dive rather than waiting under the prop line.
      if (m.avoidT > 0) {
        const dh = Math.atan2(Math.sin(m.escapeHeading - m.heading), Math.cos(m.escapeHeading - m.heading));
        m.heading += Math.max(-dt * 1.25, Math.min(dt * 1.25, dh));
      } else m.heading += Math.sin(t * 0.3 + m.ph) * dt * 0.15;
      const ahead = 8;
      let fx = -Math.sin(m.heading), fz = -Math.cos(m.heading);
      const hAhead = this.T.heightAt(m.pos.x + fx * ahead, m.pos.z + fz * ahead);
      const hL = this.T.heightAt(m.pos.x + (fx * 0.7 - fz * 0.7) * ahead, m.pos.z + (fz * 0.7 + fx * 0.7) * ahead);
      const hR = this.T.heightAt(m.pos.x + (fx * 0.7 + fz * 0.7) * ahead, m.pos.z + (fz * 0.7 - fx * 0.7) * ahead);
      if (hAhead > -1.6) m.heading += (hL < hR ? 1 : -1) * dt * 0.8;
      const targetSpeed = m.avoidT > 0 ? Math.min(1.85, m.cruiseSpeed * 1.75) : m.cruiseSpeed;
      m.speed += (targetSpeed - m.speed) * (1 - Math.exp(-dt * (m.avoidT > 0 ? 1.8 : 0.35)));
      fx = -Math.sin(m.heading); fz = -Math.cos(m.heading);
      m.pos.x += fx * m.speed * dt; m.pos.z += fz * m.speed * dt;
      const surf = Math.sin(t * 0.25 + m.ph);
      m.diveBlend += ((m.diveT > 0 ? 1 : 0) - m.diveBlend) * (1 - Math.exp(-dt * (m.diveT > 0 ? 4.2 : 0.5)));
      m.pos.y = -0.75 + Math.max(0, surf - 0.75) * 2.0 * this.surfaceActivity - m.diveBlend * 1.15;
      m.surfaced = m.diveBlend < 0.12 && m.pos.y > -0.58;
      if (m.surfaced) m.zoneT = Math.max(m.zoneT, 8);
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.set(Math.sin(t * 0.5 + m.ph) * 0.05 - Math.max(0, surf - 0.75) * 0.6 + m.diveBlend * 0.18, m.heading, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Alligators: the bayou's other residents. They cruise the channel edges and the pools with just the head and back
// showing, and slip under when a boat comes at them fast. A hull that runs over one gets a thump and loses its chain.
// ---------------------------------------------------------------------------
// the Meshy alligator (head toward -z, belly at y = 0) with the old procedural gator as a stand-in while it loads
export function gatorMesh(scale = 1) { const g = spawn('realistic_alligator', gatorProc()); g.scale.setScalar(scale); return g; }
let gatorTemplate = null;
function buildGator() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: 0x2e3a26, roughness: 0.92 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x5c6440, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), hide); body.scale.set(1, 0.55, 3.2); g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.95), hide); head.position.set(0, 0.02, -1.45); g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.5), hide); snout.position.set(0, -0.01, -2.1); g.add(snout);
  const eyeGeometry = new THREE.SphereGeometry(0.065, 8, 6);
  for (const sx of [-1, 1]) { const eye = new THREE.Mesh(eyeGeometry, hide); eye.position.set(sx * 0.16, 0.14, -1.2); g.add(eye); }
  // scute ridges down the back
  const scuteGeometry = new THREE.ConeGeometry(0.05, 0.11, 4);
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) { const s = new THREE.Mesh(scuteGeometry, hide); s.position.set(sx * 0.13, 0.17 - i * 0.008, -0.8 + i * 0.22); g.add(s); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.3, 2.2, 8), hide); tail.rotation.x = Math.PI / 2; tail.scale.set(1, 1, 0.6); tail.position.set(0, -0.05, 2.0); g.add(tail);
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), belly); under.scale.set(1, 0.3, 3); under.position.y = -0.12; g.add(under);
  const legGeometry = new THREE.CapsuleGeometry(0.07, 0.3, 4, 6);
  for (const sx of [-1, 1]) for (const sz of [-0.7, 0.7]) { const leg = new THREE.Mesh(legGeometry, hide); leg.position.set(sx * 0.38, -0.12, sz); leg.rotation.z = sx * 1.2; g.add(leg); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.y = 0.36; // belly on the origin like the model
  return g;
}

function gatorProc() {
  if (!gatorTemplate) gatorTemplate = buildGator();
  return gatorTemplate.clone(true);
}

// A bank to sun on: low ground with water within a few metres, and the direction to that water.
function baskSpot(T, rand, cx, cz, rMin, rMax) {
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin); const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const h = T.heightAt(x, z); if (h < 0.08 || h > 0.7) continue;
    for (let k = 0; k < 8; k++) { const b = k * Math.PI / 4; if (T.heightAt(x + Math.cos(b) * 6, z + Math.sin(b) * 6) < -0.5 && T.heightAt(x + Math.cos(b) * 3, z + Math.sin(b) * 3) < 0.15) return { x, z, h, ang: b }; }
  }
  return null;
}

export function alligatorEyeshineExposure(distance = Infinity, beamDot = -1, facingDot = -1, night = 0, spotlight = false, surfaced = false, fog = 0, storm = 0, blink = 1) {
  const d = Number(distance), beamAngle = Number(beamDot), facing = Number(facingDot);
  if (!spotlight || !surfaced || !Number.isFinite(d) || d < 1.5 || !Number.isFinite(beamAngle) || !Number.isFinite(facing)) return 0;
  const fogN = clamp(Number(fog) || 0), stormN = clamp(Number(storm) || 0), maximum = 108 - fogN * 32 - stormN * 10;
  if (d >= maximum) return 0;
  const beam = smooth(Math.cos(0.31), Math.cos(0.08), beamAngle);
  const lookingBack = smooth(-0.18, 0.62, facing);
  const range = 1 - smooth(maximum * 0.48, maximum, d);
  const darkness = smooth(0.18, 0.82, Number(night) || 0);
  return clamp(beam * lookingBack * range * darkness * (1 - fogN * 0.45) * (1 - stormN * 0.18) * clamp(Number(blink) || 0));
}

export function alligatorFloatHeight(relativeFloat = -0.6, waterLevel = 0, diveDepth = 0) {
  const float = Number(relativeFloat), water = Number(waterLevel), dive = Number(diveDepth);
  return (Number.isFinite(water) ? water : 0) + (Number.isFinite(float) ? float : -0.6) - Math.max(0, Number.isFinite(dive) ? dive : 0);
}

// The player can catch thirty-six eyes without creating thirty-six meshes or lights. Visible pairs compact into the
// front of one retained instance buffer; when the spotlight is off the draw disappears entirely.
export class GatorEyeshinePool {
  constructor(gatorCapacity = 18) {
    this.capacity = Math.max(1, Math.trunc(Number(gatorCapacity) || 1) * 2);
    this.geometry = new THREE.SphereGeometry(1, 6, 4);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity); this.mesh.name = 'alligator-eyeshine';
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._matrix = new THREE.Matrix4(); this._position = new THREE.Vector3(); this._quaternion = new THREE.Quaternion(); this._scale = new THREE.Vector3(); this._color = new THREE.Color(1, 0.3, 0.02);
    this.mesh.setColorAt(0, this._color); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); this.mesh.instanceColor.needsUpdate = true;
    this.active = 0; this.peak = 0; this.matrixWrites = 0; this.colorWrites = 0;
  }

  update(gators, t, boatX, boatZ, boatHeading, spotlight, night, fog = 0, storm = 0) {
    let slot = 0;
    if (spotlight && night > 0.18) {
      const boatForwardX = -Math.sin(boatHeading), boatForwardZ = -Math.cos(boatHeading);
      for (let index = 0; index < gators.length; index++) {
        const g = gators[index];
        if (slot + 1 >= this.capacity) break;
        if (!g?.pos || g.mesh?.visible === false) continue;
        const dx = g.pos.x - boatX, dz = g.pos.z - boatZ, distance = Math.hypot(dx, dz); if (distance < 1e-4) continue;
        const inverse = 1 / distance, gatorForwardX = -Math.sin(g.heading), gatorForwardZ = -Math.cos(g.heading);
        const beamDot = (dx * boatForwardX + dz * boatForwardZ) * inverse;
        const facingDot = (-dx * gatorForwardX - dz * gatorForwardZ) * inverse;
        const blinkPhase = fract(t * 0.115 + (g.ph || 0) * 0.071), blink = blinkPhase > 0.965 && blinkPhase < 0.993 ? 0 : 1;
        const surfaced = Boolean(g.bask || g.surfaced || g.towed) && g.dive <= 0.35;
        const exposure = alligatorEyeshineExposure(distance, beamDot, facingDot, night, true, surfaced, fog, storm, blink);
        if (exposure < 0.012) continue;

        const scale = Math.max(0.35, Number(g.mesh?.scale?.x) || 1), head = 1.2 * scale;
        const rightX = Math.cos(g.heading), rightZ = -Math.sin(g.heading), eyeY = g.pos.y + 0.5 * scale;
        const glintSize = (0.035 + Math.min(distance, 100) * 0.00025) * scale * (0.82 + exposure * 0.3);
        this._scale.setScalar(glintSize); this._color.setRGB(3.1 * exposure, 0.72 * exposure, 0.055 * exposure);
        const centreX = g.pos.x + gatorForwardX * head, centreZ = g.pos.z + gatorForwardZ * head, halfEye = 0.16 * scale;
        for (let side = -1; side <= 1; side += 2) {
          this._position.set(centreX + rightX * side * halfEye, eyeY, centreZ + rightZ * side * halfEye);
          this._matrix.compose(this._position, this._quaternion, this._scale); this.mesh.setMatrixAt(slot, this._matrix); this.mesh.setColorAt(slot, this._color);
          slot++; this.matrixWrites++; this.colorWrites++;
        }
      }
    }
    this.mesh.count = slot; this.mesh.visible = slot > 0; this.active = slot; this.peak = Math.max(this.peak, slot);
    if (slot) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
    return slot;
  }

  resourceStats() {
    return {
      active: this.active, peak: this.peak, capacity: this.capacity, drawCalls: this.active ? 1 : 0,
      geometries: 1, materials: 1, textures: 0, pointLights: 0,
      instanceBytes: this.mesh.instanceMatrix.array.byteLength + this.mesh.instanceColor.array.byteLength,
      matrixWrites: this.matrixWrites, colorWrites: this.colorWrites,
    };
  }

  dispose() { this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}

export class Gators {
  constructor(terrain, count, seed = 77) {
    this.T = terrain; this.list = [];
    const r = mulberry32(seed);
    let tries = 0;
    while (this.list.length < count && tries++ < 40000) {
      const big = this.list.length === 0; // one old bull
      const m = gatorMesh(big ? 1.55 : 0.8 + r() * 0.35);
      const g = { mesh: m, float: -(0.68 * m.scale.x - 0.08), pos: new THREE.Vector3(0, 0, 0), heading: r() * Math.PI * 2, speed: 0.35 + r() * 0.3, ph: r() * 6, dive: 0, big, hitT: 0, bask: false, slide: 0, charge: 0, chargeCd: 8, bellowT: 5 + r() * 20, wakeKick: 0, wakeSpeed: 0 };
      if (!big && this.list.length % 5 === 2) {
        const z = 120 - r() * 780; const sp = baskSpot(terrain, r, terrain.riverCenterX(z), z, 10, 120);
        if (sp) { g.pos.set(sp.x, sp.h + 0.02, sp.z); g.bask = true; g.toWater = sp.ang; g.heading = sp.ang + Math.PI + (r() - 0.5) * 1.2; this.list.push(g); continue; }
      }
      const z = 120 - r() * 780, x = terrain.riverCenterX(z) + (r() - 0.5) * 2 * (terrain.riverHalfWidth(z) + 40);
      const h = terrain.heightAt(x, z); if (h > -0.9 || h < -3.5) continue; // shallows and pool edges
      g.pos.set(x, g.float, z); this.list.push(g);
    }
    this.eyeshinePool = new GatorEyeshinePool(count); this.eyeshine = this.eyeshinePool.mesh;
    this.calm = false; this.onCharge = null; this.onSlide = null; this.audio = null; this.spooked = 0; this.activity = 1;
    this.wakeBoatX = 0; this.wakeBoatZ = 0; this.wakeActive = 0;
  }
  // scare(x, z, radius): gators inside the radius slip under for a while
  scare(x, z, radius = 24) {
    for (const g of this.list) if (Math.hypot(g.pos.x - x, g.pos.z - z) < radius && g.dive <= 0) {
      g.dive = 6 + Math.random() * 4;
      g.wakeKick = Math.max(Number(g.wakeKick) || 0, 0.85);
    }
  }
  update(dt, t, boatX, boatZ, boatSpeed, boatHeading = 0, spotlight = false, night = 0, fog = 0, storm = 0, waterLevel = 0) {
    if (!this.rand) this.rand = mulberry32(91);
    this.wakeBoatX = boatX; this.wakeBoatZ = boatZ;
    for (const g of this.list) {
      g.wakeKick = Math.max(0, (Number(g.wakeKick) || 0) - dt * 1.35);
      g.wakeSpeed = 0;
      if (!g.towed && !g.parked && Math.hypot(g.pos.x - boatX, g.pos.z - boatZ) > 700) {
        const sp = (!g.big && this.rand() < 0.4) ? baskSpot(this.T, this.rand, boatX, boatZ, 160, 450) : null;
        if (sp) { g.pos.set(sp.x, sp.h + 0.02, sp.z); g.bask = true; g.slide = 0; g.toWater = sp.ang; g.heading = sp.ang + Math.PI + (this.rand() - 0.5) * 1.2; g.dive = 0; g.wakeKick = 0; }
        else { const spot = findNear(this.T, this.rand, boatX, boatZ, 160, 450, waterLevel - 3.5, waterLevel - 0.9); if (spot) { g.pos.x = spot.x; g.pos.z = spot.z; g.pos.y = alligatorFloatHeight(g.float, waterLevel); g.dive = 0; g.bask = false; g.wakeKick = 0; } }
      }
      if (g.towed) { g.pos.y += (alligatorFloatHeight(g.float, waterLevel) - g.pos.y) * (1 - Math.exp(-dt * 4)); g.mesh.position.copy(g.pos); g.mesh.rotation.set(0.05, g.heading, Math.sin(t * 5) * 0.12); g.surfaced = true; g.wakeSpeed = Math.min(5.5, Math.abs(boatSpeed) * 0.65); continue; }
      const dB = Math.hypot(boatX - g.pos.x, boatZ - g.pos.z);
      if (g.bask) {
        // sunning on the bank: the boat coming close sends it down the mud and into the water
        g.surfaced = false;
        if (g.slide <= 0) {
          g.mesh.position.copy(g.pos); g.mesh.rotation.set(0, g.heading, 0);
          if ((dB < 32 && boatSpeed > 2) || dB < 12) { g.slide = 3.5; g.heading = g.toWater; this.spooked++; if (this.audio) this.audio.hiss(0.4 * Math.max(0, 1 - dB / 50), g.pos.x, g.pos.z); if (this.onSlide) this.onSlide(g, dB); }
          continue;
        }
        g.slide -= dt;
        const fx = -Math.sin(g.heading), fz = -Math.cos(g.heading); const sp = 2.8;
        g.pos.x += fx * sp * dt; g.pos.z += fz * sp * dt;
        const gh = this.T.heightAt(g.pos.x, g.pos.z);
        g.pos.y = Math.max(gh + 0.02, alligatorFloatHeight(g.float, waterLevel));
        g.mesh.position.copy(g.pos); g.mesh.rotation.set(Math.sin(t * 14) * 0.03, g.heading, Math.sin(t * 14) * 0.08); // scramble
        if (gh < waterLevel - 0.35 || g.slide <= 0) { g.bask = false; g.dive = 5 + this.rand() * 3; g.wakeKick = Math.max(g.wakeKick, 1); g.pos.y = alligatorFloatHeight(g.float, waterLevel); if (this.onSplash) this.onSplash(g.pos.x, g.pos.z, g.mesh.scale.x); }
        continue;
      }
      // the bull: idle near him for long and he comes at the hull
      g.chargeCd = Math.max(0, g.chargeCd - dt);
      if (g.big && !this.calm && !g.parked && g.charge <= 0 && g.chargeCd <= 0 && g.dive <= 0 && g.hitT <= 0 && dB < 16 && dB > 3 && boatSpeed < 3) {
        g.charge = 3.5; g.chargeCd = 30; g.heading = Math.atan2(-(boatX - g.pos.x), -(boatZ - g.pos.z)); if (this.audio) this.audio.bellow(0.6, g.pos.x, g.pos.z);
      }
      if (g.charge > 0) {
        g.charge -= dt;
        const want = Math.atan2(-(boatX - g.pos.x), -(boatZ - g.pos.z)); let dh = want - g.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); g.heading += Math.max(-1.5, Math.min(1.5, dh * 3)) * dt;
        const fx = -Math.sin(g.heading), fz = -Math.cos(g.heading); g.pos.x += fx * 5.5 * dt; g.pos.z += fz * 5.5 * dt; g.wakeSpeed = 5.5;
        g.pos.y += (alligatorFloatHeight(g.float, waterLevel) + 0.15 - g.pos.y) * (1 - Math.exp(-dt * 4));
        g.mesh.position.copy(g.pos); g.mesh.rotation.set(-0.08, g.heading, Math.sin(t * 12) * 0.12); g.surfaced = true;
        if (dB < 3.4) { g.charge = 0; g.dive = 6; g.hitT = 4; g.wakeKick = Math.max(g.wakeKick, 1.2); if (this.onCharge) this.onCharge(g); }
        else if (dB > 40) g.charge = 0;
        continue;
      }
      // bellows carry across the water now and then
      if (g.big && this.audio) { g.bellowT -= dt; if (g.bellowT <= 0) { g.bellowT = 25 + this.rand() * 40; if (dB < 120 && g.dive <= 0) this.audio.bellow(0.35 * (1 - dB / 140), g.pos.x, g.pos.z); } }
      const ahead = 6, fx = -Math.sin(g.heading), fz = -Math.cos(g.heading);
      const hAhead = this.T.heightAt(g.pos.x + fx * ahead, g.pos.z + fz * ahead);
      const hL = this.T.heightAt(g.pos.x + (fx * 0.7 - fz * 0.7) * ahead, g.pos.z + (fz * 0.7 + fx * 0.7) * ahead);
      const hR = this.T.heightAt(g.pos.x + (fx * 0.7 + fz * 0.7) * ahead, g.pos.z + (fz * 0.7 - fx * 0.7) * ahead);
      const depthAhead = waterLevel - hAhead;
      if (depthAhead < 0.7 || depthAhead > 3.6) g.heading += (Math.abs(waterLevel - hL - 2) < Math.abs(waterLevel - hR - 2) ? 1 : -1) * dt * 0.9;
      g.heading += Math.sin(t * 0.2 + g.ph) * dt * 0.2;
      const d = Math.hypot(boatX - g.pos.x, boatZ - g.pos.z);
      if (!g.parked && g.dive <= 0 && d < 22 && boatSpeed > 4.5) { g.dive = 7 + Math.random() * 4; g.wakeKick = Math.max(g.wakeKick, 0.85); } // a boat coming in fast: under it goes
      const under = g.dive > 0;
      if (under) g.dive -= dt;
      g.hitT = Math.max(0, g.hitT - dt);
      const sp = g.speed * this.activity * (under ? 1.6 : 1) * (g.parked ? 0.3 : 1);
      if (!under) g.wakeSpeed = sp;
      g.pos.x += fx * sp * dt; g.pos.z += fz * sp * dt;
      const tgtY = alligatorFloatHeight(g.float, waterLevel, under ? 1 : 0) + (under ? 0 : Math.sin(t * 0.7 + g.ph) * 0.02);
      g.pos.y += (tgtY - g.pos.y) * (1 - Math.exp(-dt * 2.2));
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.set(under ? -0.25 : 0, g.heading, Math.sin(t * 1.6 + g.ph) * 0.03);
      g.surfaced = g.pos.y > alligatorFloatHeight(g.float, waterLevel) - 0.3;
    }
    this.eyeshinePool.update(this.list, t, boatX, boatZ, boatHeading, spotlight, night, fog, storm);
  }
  // One nearest animal can disturb the existing wake field. A dive pulse replaces its two travelling stamps, keeping
  // wildlife bounded to two frame slots without creating another texture, mesh, particle pool or per-frame object.
  stamps(out) {
    let nearest = null, nearestDistanceSq = GATOR_WAKE_RANGE_SQ;
    for (const g of this.list) {
      const speed = Math.max(0, Number(g.wakeSpeed) || 0), kick = Math.max(0, Number(g.wakeKick) || 0);
      if (g.mesh?.visible === false || g.bask || (kick <= 0.035 && (!g.surfaced || speed <= 0.12))) continue;
      const dx = g.pos.x - this.wakeBoatX, dz = g.pos.z - this.wakeBoatZ, distanceSq = dx * dx + dz * dz;
      if (distanceSq < nearestDistanceSq) { nearest = g; nearestDistanceSq = distanceSq; }
    }
    this.wakeActive = 0;
    if (!nearest) return 0;

    const scale = clamp(Number(nearest.mesh?.scale?.x) || 1, 0.6, 1.8);
    const kick = clamp(Number(nearest.wakeKick) || 0);
    if (kick > 0.035) {
      const radius = scale * (1.05 + kick * 0.72);
      if (emitWakeStamp(out, nearest.pos.x, nearest.pos.z, radius, -0.48 * kick, 0.82 * kick, radius * 1.18) !== null) this.wakeActive = 1;
      return this.wakeActive;
    }

    const speed = Math.max(0, Number(nearest.wakeSpeed) || 0), drive = clamp(speed / 5.5);
    if (drive <= 0.02) return 0;
    const fx = -Math.sin(nearest.heading), fz = -Math.cos(nearest.heading);
    const pressureRadius = scale * (0.4 + drive * 0.12), tailRadius = scale * (0.54 + drive * 0.2);
    if (emitWakeStamp(out, nearest.pos.x + fx * scale * 0.72, nearest.pos.z + fz * scale * 0.72, pressureRadius, -0.2 * drive, 0.015 * drive, pressureRadius) !== null) this.wakeActive++;
    if (emitWakeStamp(out, nearest.pos.x - fx * scale * 0.92, nearest.pos.z - fz * scale * 0.92, tailRadius, 0.16 * drive, 0.04 * drive + 0.42 * drive * drive, tailRadius * 1.25) !== null) this.wakeActive++;
    return this.wakeActive;
  }
  resourceStats() { return { animals: this.list.length, wakeActive: this.wakeActive, wakeCapacity: 2, eyeshine: this.eyeshinePool.resourceStats() }; }
}
