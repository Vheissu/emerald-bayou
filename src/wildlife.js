import * as THREE from 'three';
import { spawn } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

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
    for (const kind of FLOCKS) {
      const K = BIRD_KINDS[kind]; const fi = this.flocks.length;
      this.flocks.push({ kind, K, cx: center.x + (r() - 0.5) * 300, cz: center.z + (r() - 0.5) * 300, radius: K.radius[0] + r() * (K.radius[1] - K.radius[0]), alt: K.alt[0] + r() * (K.alt[1] - K.alt[0]), speed: (K.speed[0] + r() * (K.speed[1] - K.speed[0])) * (r() < 0.5 ? 1 : -1), ph: r() * 7, callT: 5 + r() * 20 });
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
      const d = Math.hypot(f.cx - cam.x, f.cz - cam.z);
      if (d > 900) this.relocate(f, cam);
      if (f.K.call && this.audio) { f.callT -= dt; if (f.callT <= 0) { f.callT = 18 + Math.random() * 30; if (d < 260) this.audio.osprey(0.2 * (1 - d / 300)); } }
    }
    for (let i = 0; i < this.count; i++) {
      const b = this.birds[i]; const f = this.flocks[b.flock]; const K = f.K;
      const a = t * f.speed + f.ph - (K.line ? b.i * K.line / f.radius * Math.sign(f.speed) : 0);
      const wob = Math.sin(t * (K.kind === 'swallow' ? 3.1 : 0.7) + i) * K.wob;
      const x = f.cx + Math.cos(a) * f.radius + b.off.x + wob, z = f.cz + Math.sin(a) * f.radius * 0.7 + b.off.z, y = f.alt + b.off.y + Math.sin(t * 0.9 + i * 2) * (K.kind === 'pelican' ? 0.3 : 1.5);
      const a2 = a + 0.02 * Math.sign(f.speed);
      const nx = f.cx + Math.cos(a2) * f.radius + b.off.x + wob, nz = f.cz + Math.sin(a2) * f.radius * 0.7 + b.off.z;
      this._p.set(x, y, z); this._tgt.set(nx, y, nz);
      this._look.lookAt(this._tgt, this._p, this._up);
      this._q.setFromRotationMatrix(this._look);
      this._bank.setFromAxisAngle(this._z, Math.sign(f.speed) * K.bank);
      this._q.multiply(this._bank);
      this._s.setScalar(i < this.count * this.activity ? K.scale : 0);
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

export function wadingBird() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), white); body.scale.set(1, 0.9, 1.9); body.position.y = 0.72; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.48, 6), white); neck.position.set(0, 0.97, -0.16); neck.rotation.x = 0.5; g.add(neck);
  const neck2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), white); neck2.position.set(0, 1.25, -0.1); neck2.rotation.x = -0.4; g.add(neck2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), white); head.scale.set(1, 0.9, 1.6); head.position.set(0, 1.4, -0.16); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.24, 6), new THREE.MeshStandardMaterial({ color: 0xd9b24a })); beak.rotation.x = -Math.PI / 2 - 0.15; beak.position.set(0, 1.38, -0.34); g.add(beak);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 4), dark); leg.position.set(sx * 0.05, 0.36, 0.05); g.add(leg); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function manateeMesh() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5e5f5a, roughness: 0.85 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), mat); body.scale.set(1, 0.8, 2.6); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat); head.position.set(0, -0.02, -1.45); head.scale.set(1, 0.85, 1.1); g.add(head);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.5, 0.9, 12), mat); tail.rotation.x = Math.PI / 2; tail.scale.set(1.6, 1, 0.25); tail.position.set(0, 0, 1.75); g.add(tail);
  for (const sx of [-1, 1]) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat); fl.scale.set(0.5, 0.25, 1); fl.position.set(sx * 0.55, -0.2, -0.6); fl.rotation.y = sx * 0.4; g.add(fl); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export class Manatees {
  constructor(terrain, count, start) {
    this.T = terrain; this.list = []; this.surfaceActivity = 1;
    const r = mulberry32(31);
    for (let i = 0; i < count; i++) {
      const m = manateeMesh();
      const z = start.z - 20 - i * 35, x = terrain.riverCenterX(z) + (r() - 0.5) * 30;
      this.list.push({ mesh: m, pos: new THREE.Vector3(x, -0.7, z), heading: r() * Math.PI * 2, t: r() * 50, speed: 0.6 + r() * 0.5, ph: r() * 6 });
    }
  }
  update(dt, t, bx = 0, bz = 0) {
    if (!this.rand) this.rand = mulberry32(77);
    for (const m of this.list) {
      if (!m.held && Math.hypot(m.pos.x - bx, m.pos.z - bz) > 700) {
        const spot = findNear(this.T, this.rand, bx, bz, 180, 450, -6, -2.4);
        if (spot) { m.pos.x = spot.x; m.pos.z = spot.z; }
      }
      // wander, steer toward deep water
      const ahead = 8;
      const fx = -Math.sin(m.heading), fz = -Math.cos(m.heading);
      const hAhead = this.T.heightAt(m.pos.x + fx * ahead, m.pos.z + fz * ahead);
      const hL = this.T.heightAt(m.pos.x + (fx * 0.7 - fz * 0.7) * ahead, m.pos.z + (fz * 0.7 + fx * 0.7) * ahead);
      const hR = this.T.heightAt(m.pos.x + (fx * 0.7 + fz * 0.7) * ahead, m.pos.z + (fz * 0.7 - fx * 0.7) * ahead);
      if (hAhead > -1.6) m.heading += (hL < hR ? 1 : -1) * dt * 0.8;
      m.heading += Math.sin(t * 0.3 + m.ph) * dt * 0.15;
      m.pos.x += fx * m.speed * dt; m.pos.z += fz * m.speed * dt;
      const surf = Math.sin(t * 0.25 + m.ph);
      m.pos.y = -0.75 + Math.max(0, surf - 0.75) * 2.0 * this.surfaceActivity;
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.set(Math.sin(t * 0.5 + m.ph) * 0.05 - Math.max(0, surf - 0.75) * 0.6, m.heading, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Alligators: the bayou's other residents. They cruise the channel edges and the pools with just the head and back
// showing, and slip under when a boat comes at them fast. A hull that runs over one gets a thump and loses its chain.
// ---------------------------------------------------------------------------
// the Meshy alligator (head toward -z, belly at y = 0) with the old procedural gator as a stand-in while it loads
export function gatorMesh(scale = 1) { const g = spawn('realistic_alligator', gatorProc()); g.scale.setScalar(scale); return g; }
function gatorProc() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: 0x2e3a26, roughness: 0.92 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x5c6440, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), hide); body.scale.set(1, 0.55, 3.2); g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.95), hide); head.position.set(0, 0.02, -1.45); g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.5), hide); snout.position.set(0, -0.01, -2.1); g.add(snout);
  for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), hide); eye.position.set(sx * 0.16, 0.14, -1.2); g.add(eye); }
  // scute ridges down the back
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 4), hide); s.position.set(sx * 0.13, 0.17 - i * 0.008, -0.8 + i * 0.22); g.add(s); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.3, 2.2, 8), hide); tail.rotation.x = Math.PI / 2; tail.scale.set(1, 1, 0.6); tail.position.set(0, -0.05, 2.0); g.add(tail);
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), belly); under.scale.set(1, 0.3, 3); under.position.y = -0.12; g.add(under);
  for (const sx of [-1, 1]) for (const sz of [-0.7, 0.7]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 6), hide); leg.position.set(sx * 0.38, -0.12, sz); leg.rotation.z = sx * 1.2; g.add(leg); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.y = 0.36; // belly on the origin like the model
  return g;
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
export class Gators {
  constructor(terrain, count, seed = 77) {
    this.T = terrain; this.list = [];
    const r = mulberry32(seed);
    let tries = 0;
    while (this.list.length < count && tries++ < 40000) {
      const big = this.list.length === 0; // one old bull
      const m = gatorMesh(big ? 1.55 : 0.8 + r() * 0.35);
      const g = { mesh: m, float: -(0.68 * m.scale.x - 0.08), pos: new THREE.Vector3(0, 0, 0), heading: r() * Math.PI * 2, speed: 0.35 + r() * 0.3, ph: r() * 6, dive: 0, big, hitT: 0, bask: false, slide: 0, charge: 0, chargeCd: 8, bellowT: 5 + r() * 20 };
      if (!big && this.list.length % 5 === 2) {
        const z = 120 - r() * 780; const sp = baskSpot(terrain, r, terrain.riverCenterX(z), z, 10, 120);
        if (sp) { g.pos.set(sp.x, sp.h + 0.02, sp.z); g.bask = true; g.toWater = sp.ang; g.heading = sp.ang + Math.PI + (r() - 0.5) * 1.2; this.list.push(g); continue; }
      }
      const z = 120 - r() * 780, x = terrain.riverCenterX(z) + (r() - 0.5) * 2 * (terrain.riverHalfWidth(z) + 40);
      const h = terrain.heightAt(x, z); if (h > -0.9 || h < -3.5) continue; // shallows and pool edges
      g.pos.set(x, g.float, z); this.list.push(g);
    }
    this.calm = false; this.onCharge = null; this.onSlide = null; this.audio = null; this.spooked = 0; this.activity = 1;
  }
  // scare(x, z, radius): gators inside the radius slip under for a while
  scare(x, z, radius = 24) { for (const g of this.list) if (Math.hypot(g.pos.x - x, g.pos.z - z) < radius && g.dive <= 0) g.dive = 6 + Math.random() * 4; }
  update(dt, t, boatX, boatZ, boatSpeed) {
    if (!this.rand) this.rand = mulberry32(91);
    for (const g of this.list) {
      if (!g.towed && !g.parked && Math.hypot(g.pos.x - boatX, g.pos.z - boatZ) > 700) {
        const sp = (!g.big && this.rand() < 0.4) ? baskSpot(this.T, this.rand, boatX, boatZ, 160, 450) : null;
        if (sp) { g.pos.set(sp.x, sp.h + 0.02, sp.z); g.bask = true; g.slide = 0; g.toWater = sp.ang; g.heading = sp.ang + Math.PI + (this.rand() - 0.5) * 1.2; g.dive = 0; }
        else { const spot = findNear(this.T, this.rand, boatX, boatZ, 160, 450, -3.5, -0.9); if (spot) { g.pos.x = spot.x; g.pos.z = spot.z; g.pos.y = g.float; g.dive = 0; g.bask = false; } }
      }
      if (g.towed) { g.mesh.position.copy(g.pos); g.mesh.rotation.set(0.05, g.heading, Math.sin(t * 5) * 0.12); g.surfaced = true; continue; }
      const dB = Math.hypot(boatX - g.pos.x, boatZ - g.pos.z);
      if (g.bask) {
        // sunning on the bank: the boat coming close sends it down the mud and into the water
        g.surfaced = false;
        if (g.slide <= 0) {
          g.mesh.position.copy(g.pos); g.mesh.rotation.set(0, g.heading, 0);
          if ((dB < 32 && boatSpeed > 2) || dB < 12) { g.slide = 3.5; g.heading = g.toWater; this.spooked++; if (this.audio) this.audio.hiss(0.4 * Math.max(0, 1 - dB / 50)); if (this.onSlide) this.onSlide(g, dB); }
          continue;
        }
        g.slide -= dt;
        const fx = -Math.sin(g.heading), fz = -Math.cos(g.heading); const sp = 2.8;
        g.pos.x += fx * sp * dt; g.pos.z += fz * sp * dt;
        const gh = this.T.heightAt(g.pos.x, g.pos.z);
        g.pos.y = Math.max(gh + 0.02, g.float);
        g.mesh.position.copy(g.pos); g.mesh.rotation.set(Math.sin(t * 14) * 0.03, g.heading, Math.sin(t * 14) * 0.08); // scramble
        if (gh < -0.35 || g.slide <= 0) { g.bask = false; g.dive = 5 + this.rand() * 3; g.pos.y = g.float; if (this.onSplash) this.onSplash(g.pos.x, g.pos.z, g.mesh.scale.x); }
        continue;
      }
      // the bull: idle near him for long and he comes at the hull
      g.chargeCd = Math.max(0, g.chargeCd - dt);
      if (g.big && !this.calm && !g.parked && g.charge <= 0 && g.chargeCd <= 0 && g.dive <= 0 && g.hitT <= 0 && dB < 16 && dB > 3 && boatSpeed < 3) {
        g.charge = 3.5; g.chargeCd = 30; g.heading = Math.atan2(-(boatX - g.pos.x), -(boatZ - g.pos.z)); if (this.audio) this.audio.bellow(0.6);
      }
      if (g.charge > 0) {
        g.charge -= dt;
        const want = Math.atan2(-(boatX - g.pos.x), -(boatZ - g.pos.z)); let dh = want - g.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); g.heading += Math.max(-1.5, Math.min(1.5, dh * 3)) * dt;
        const fx = -Math.sin(g.heading), fz = -Math.cos(g.heading); g.pos.x += fx * 5.5 * dt; g.pos.z += fz * 5.5 * dt;
        g.pos.y += (g.float + 0.15 - g.pos.y) * (1 - Math.exp(-dt * 4));
        g.mesh.position.copy(g.pos); g.mesh.rotation.set(-0.08, g.heading, Math.sin(t * 12) * 0.12); g.surfaced = true;
        if (dB < 3.4) { g.charge = 0; g.dive = 6; g.hitT = 4; if (this.onCharge) this.onCharge(g); }
        else if (dB > 40) g.charge = 0;
        continue;
      }
      // bellows carry across the water now and then
      if (g.big && this.audio) { g.bellowT -= dt; if (g.bellowT <= 0) { g.bellowT = 25 + this.rand() * 40; if (dB < 120 && g.dive <= 0) this.audio.bellow(0.35 * (1 - dB / 140)); } }
      const ahead = 6, fx = -Math.sin(g.heading), fz = -Math.cos(g.heading);
      const hAhead = this.T.heightAt(g.pos.x + fx * ahead, g.pos.z + fz * ahead);
      const hL = this.T.heightAt(g.pos.x + (fx * 0.7 - fz * 0.7) * ahead, g.pos.z + (fz * 0.7 + fx * 0.7) * ahead);
      const hR = this.T.heightAt(g.pos.x + (fx * 0.7 + fz * 0.7) * ahead, g.pos.z + (fz * 0.7 - fx * 0.7) * ahead);
      if (hAhead > -0.7 || hAhead < -3.6) g.heading += (Math.abs(hL + 2) < Math.abs(hR + 2) ? 1 : -1) * dt * 0.9;
      g.heading += Math.sin(t * 0.2 + g.ph) * dt * 0.2;
      const d = Math.hypot(boatX - g.pos.x, boatZ - g.pos.z);
      if (!g.parked && g.dive <= 0 && d < 22 && boatSpeed > 4.5) g.dive = 7 + Math.random() * 4; // a boat coming in fast: under it goes
      const under = g.dive > 0;
      if (under) g.dive -= dt;
      g.hitT = Math.max(0, g.hitT - dt);
      const sp = g.speed * this.activity * (under ? 1.6 : 1) * (g.parked ? 0.3 : 1);
      g.pos.x += fx * sp * dt; g.pos.z += fz * sp * dt;
      const tgtY = under ? g.float - 1.0 : g.float + Math.sin(t * 0.7 + g.ph) * 0.02;
      g.pos.y += (tgtY - g.pos.y) * (1 - Math.exp(-dt * 2.2));
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.set(under ? -0.25 : 0, g.heading, Math.sin(t * 1.6 + g.ph) * 0.03);
      g.surfaced = g.pos.y > g.float - 0.3;
    }
  }
}
