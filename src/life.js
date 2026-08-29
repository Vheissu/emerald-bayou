import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { buildSkiff } from './npc.js';
import { buildAirboat, loadDriver } from './airboat.js';
import { HOME_X, HOME_Z, WORLD_HALF } from './heightfield.js';
import * as TEX from './textures.js';
import { spawn, loadGeo, SPEC } from './models.js';
import { person, animatePerson, wave, pair, walkAlong, canoe, paddleAnim, cooler, bucket, fishingLine } from './folk.js';
import { animateSite } from './sites.js';
import { cachedResource, sharedResource, trimOldest } from './cache.js';
import { MAX_SHIFT_WAKE_COMPLAINTS, wakeConsequence, wakeSeverity } from './wakeconduct.js';
import { hornYieldSpeedScale, hornYieldStrength, pursuitYieldSpeedScale, pursuitYieldStrength } from './trafficresponse.js';
import { WakeStampPool } from './wakestamps.js';
import { navigationLightVisibility } from './navigationrules.js';
import { waterspoutAvoidanceStrength, waterspoutProbeScore, waterspoutReactionReady } from './waterspout.js';

// The bayou's small life: mullet jumping, bait boiling away from the bow, deadhead logs and dead snags in the still
// water (with an anhinga drying its wings), other boats running the channels, and anglers anchored in the pools who
// have opinions about your wake.

const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const jitter = () => Math.random() - 0.5;
const homeDist = (x, z) => Math.hypot(x - HOME_X, z - HOME_Z);
const DEBRIS_CACHE_LIMIT = 384, ANGLER_CACHE_LIMIT = 192, FOLK_CACHE_LIMIT = 192;

// ---------------------------------------------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------------------------------------------
function fishGeo() {
  const body = new THREE.SphereGeometry(0.06, 10, 7); body.scale(1, 0.85, 3.4);
  const tail = new THREE.ConeGeometry(0.075, 0.13, 3); tail.rotateX(Math.PI / 2); tail.scale(0.3, 1, 1); tail.translate(0, 0, 0.25);
  const fin = new THREE.ConeGeometry(0.04, 0.07, 3); fin.scale(0.3, 1, 1); fin.translate(0, 0.07, 0.02);
  return mergeGeometries([body, tail, fin].map(g => g.toNonIndexed()), false);
}
export class Fish {
  constructor(terrain, scene, fx) {
    this.T = terrain; this.fx = fx; // fx: { plume, spray, audio, emitStamp }
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4dbd6, roughness: 0.3, metalness: 0.6 });
    this.n = 48; this.mesh = new THREE.InstancedMesh(fishGeo(), mat, this.n); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.fallbackReleased = false;
    this.list = []; for (let i = 0; i < this.n; i++) this.list.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, s: 1, hops: 0, roll: 0 });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) { this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
    scene.add(this.mesh);
    this.nextT = 1; this.boilT = 0; this.activity = 1;
    loadGeo('fish_a').then(r => {
      if (!r) return;
      const fallbackGeometry = this.mesh.geometry, fallbackMaterial = this.mesh.material;
      this.mesh.geometry = r.geo; this.mesh.material = r.mat;
      if (fallbackGeometry !== r.geo) fallbackGeometry.dispose();
      if (fallbackMaterial !== r.mat) fallbackMaterial.dispose();
      this.fallbackReleased = true;
    });
  }
  free() { for (const f of this.list) if (!f.on) return f; return null; }
  launch(x, z, vy, vx, vz, s = 1, hops = 0, quiet = false) {
    const f = this.free(); if (!f) return null;
    Object.assign(f, { on: true, x, y: -0.15, z, vx, vy, vz, t: 0, s, hops, roll: (Math.random() - 0.5) * 2.4 });
    if (!quiet) this.splash(x, z, 0.45 * s);
    return f;
  }
  splash(x, z, k, bx, bz) {
    const { plume, spray, audio, emitStamp } = this.fx;
    const n = Math.floor(3 + 4 * k);
    for (let i = 0; i < n; i++) plume.emit(x + jitter() * 0.3, 0.05, z + jitter() * 0.3, jitter() * 1.2 * k, 0.8 + Math.random() * 1.6 * k, jitter() * 1.2 * k, 0.1 + Math.random() * 0.12 * k, 0.9, 0.45 + Math.random() * 0.3, 0.3);
    for (let i = 0; i < n * 4; i++) spray.emit(x + jitter() * 0.3, 0.03, z + jitter() * 0.3, jitter() * 2.2 * k, 0.8 + Math.random() * 2.4 * k, jitter() * 2.2 * k, 0.012 + Math.random() * 0.02, 0.35 + Math.random() * 0.3, 0.6);
    emitStamp(x, z, 0.45 + k * 0.3, -0.3 * k, 0.9 * k, 0.5 + k * 0.3);
    if (bx !== undefined) { const d = Math.hypot(x - bx, z - bz); audio.plip(Math.min(0.45, 0.6 * k) * Math.max(0, 1 - d / 70), x, z); }
  }
  update(dt, t, phys) {
    const bx = phys.pos.x, bz = phys.pos.y;
    // a mullet somewhere near the boat every second or two
    this.nextT -= dt;
    if (this.nextT <= 0) {
      this.nextT = (0.6 + Math.random() * 1.6) / Math.max(0.16, this.activity);
      if (Math.random() < this.activity) for (let k = 0; k < 20; k++) {
        const a = Math.random() * 6.283, r = 12 + Math.random() * 60; const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
        if (this.T.heightAt(x, z) > -0.8) continue;
        const ang = Math.random() * 6.283, hs = 0.8 + Math.random() * 2.2;
        this.launch(x, z, 3.0 + Math.random() * 1.6, Math.cos(ang) * hs, Math.sin(ang) * hs, 0.85 + Math.random() * 0.4, 2);
        break;
      }
    }
    // bait boiling away from the bow in the shallows
    if (phys.wet > 0.5 && phys.speed > 5 && phys.groundH > -1.9 && phys.groundH < -0.45) {
      this.boilT -= dt;
      if (this.boilT <= 0) {
        this.boilT = 0.5 + Math.random() * 1.6;
        const f = phys.forward(), rgt = phys.right(); const n = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) { const side = Math.random() < 0.5 ? -1 : 1; const x = bx + f.x * (3 + Math.random() * 4) + rgt.x * side * (1 + Math.random() * 2), z = bz + f.y * (3 + Math.random() * 4) + rgt.y * side * (1 + Math.random() * 2); this.launch(x, z, 1.6 + Math.random() * 1.4, rgt.x * side * (2 + Math.random() * 2) + f.x * 1.5, rgt.y * side * (2 + Math.random() * 2) + f.y * 1.5, 0.45 + Math.random() * 0.2, 0, true); }
      }
    }
    for (let i = 0; i < this.n; i++) {
      const f = this.list[i]; if (!f.on) continue;
      f.t += dt; f.vy -= 9.8 * dt; f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt;
      if (f.y < -0.2 && f.vy < 0) {
        this.splash(f.x, f.z, 0.7 * f.s, bx, bz);
        if (f.hops > 0 && Math.random() < 0.6) { f.hops--; f.y = -0.15; f.vy = Math.abs(f.vy) * (0.55 + Math.random() * 0.25); f.roll = (Math.random() - 0.5) * 2.4; }
        else { f.on = false; this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); continue; }
      }
      const hs = Math.hypot(f.vx, f.vz);
      this._e.set(-Math.atan2(f.vy, hs), Math.atan2(-f.vx, -f.vz), f.roll * Math.sin(Math.min(1, f.t * 2.5) * Math.PI), 'YXZ');
      this._q.setFromEuler(this._e); this._p.set(f.x, f.y, f.z); this._s.setScalar(f.s);
      this._m.compose(this._p, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Debris: deadhead logs adrift in the still water, and dead snags standing in it
// ---------------------------------------------------------------------------------------------------------------
const DEB_CELL = 240;
function logGeo(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.8, 1.0, 1, 9); trunk.rotateX(Math.PI / 2); parts.push(trunk);
  for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {
    const b = new THREE.CylinderGeometry(0.12, 0.3, 0.9 + r() * 0.8, 6); b.translate(0, 0.5, 0);
    b.rotateZ((r() - 0.5) * 1.6); b.rotateX(r() * 6.28); b.translate(0, 0, -0.45 + r() * 0.9); parts.push(b);
  }
  return mergeGeometries(parts.map(g => g.toNonIndexed()), false);
}
function snagGeo(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 1, 8); trunk.translate(0, 0.5, 0); parts.push(trunk);
  for (let i = 0; i < 3; i++) { const L = 0.5 + r() * 0.7; const b = new THREE.CylinderGeometry(0.025, 0.07, L, 5); b.translate(0, L / 2, 0); b.rotateZ(0.8 + r() * 0.7); b.rotateY(r() * 6.28); b.translate(0, 0.5 + r() * 0.4, 0); parts.push(b); }
  return mergeGeometries(parts.map(g => g.toNonIndexed()), false);
}
const ANHINGA_GEO = Object.freeze({
  body: sharedResource(new THREE.SphereGeometry(0.13, 10, 8)),
  neck: sharedResource(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 6)),
  head: sharedResource(new THREE.ConeGeometry(0.035, 0.32, 6)),
  wing: sharedResource(new THREE.PlaneGeometry(0.62, 0.3, 4, 1)),
  tail: sharedResource(new THREE.PlaneGeometry(0.16, 0.34)),
});
const ANHINGA_MAT = sharedResource(new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }));
function anhinga() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(ANHINGA_GEO.body, ANHINGA_MAT); body.scale.set(1, 0.9, 1.9); body.position.y = 0.2; g.add(body);
  const neck = new THREE.Mesh(ANHINGA_GEO.neck, ANHINGA_MAT); neck.position.set(0, 0.5, -0.1); neck.rotation.x = 0.3; g.add(neck);
  const head = new THREE.Mesh(ANHINGA_GEO.head, ANHINGA_MAT); head.rotation.x = -Math.PI / 2 + 0.5; head.position.set(0, 0.76, -0.25); g.add(head);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(ANHINGA_GEO.wing, ANHINGA_MAT); w.position.set(sx * 0.36, 0.3, 0.02); w.rotation.z = sx * 0.35; w.rotation.y = sx * 0.1; g.add(w); }
  const tail = new THREE.Mesh(ANHINGA_GEO.tail, ANHINGA_MAT); tail.rotation.x = -1.2; tail.position.set(0, 0.16, 0.36); g.add(tail);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export class Debris {
  constructor(terrain, scene, phys) {
    this.T = terrain; this.scene = scene; this.phys = phys;
    this.cells = new Map(); this.live = new Map(); this.checkT = 0; this.cacheEvictions = 0;
    const bark = TEX.bark();
    this.logMats = [new THREE.MeshStandardMaterial({ map: bark, color: 0x7d7368, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: bark, color: 0x5e5148, roughness: 0.95 })];
    this.snagMat = new THREE.MeshStandardMaterial({ map: bark, color: 0x6a6358, roughness: 0.95 });
    this.logGeos = [logGeo(1), logGeo(2), logGeo(3)]; this.snagGeos = [snagGeo(4), snagGeo(5)];
    this.obs = []; phys.addObs('debris', this.obs);
    this.spooked = 0; this._flow = new THREE.Vector2();
  }
  cellAt(ci, cj) {
    const key = `${ci},${cj}`; if (this.cells.has(key)) return this.cells.get(key);
    const out = []; const cx = ci * DEB_CELL, cz = cj * DEB_CELL;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF - 600 && homeDist(cx, cz) > 420) {
      const rr = mulberry32(hash2(ci + 17, cj + 501) ^ 0x77a1);
      const hf = this.T.hf;
      const nLogs = rr() < 0.55 ? 1 + Math.floor(rr() * 2) : 0;
      for (let n = 0; n < nLogs; n++) for (let t = 0; t < 10; t++) {
        const x = cx + rr() * DEB_CELL, z = cz + rr() * DEB_CELL; const h = hf.compute(x, z); if (h > -0.9 || h < -4.5) continue;
        out.push({ kind: 'log', key: `${key}:l${n}`, x, z, ang: rr() * 6.28, len: 4.5 + rr() * 4.5, r: 0.22 + rr() * 0.12, ph: rr() * 6, v: Math.floor(rr() * 3), m: Math.floor(rr() * 2), vx: 0, vz: 0, av: 0, nt: rr() < 0.55 ? 1 + Math.floor(rr() * 3) : 0, ts: rr() * 1e9 | 0 }); break;
      }
      if (rr() < 0.4) for (let t = 0; t < 10; t++) {
        const x = cx + rr() * DEB_CELL, z = cz + rr() * DEB_CELL; const h = hf.compute(x, z); if (h > -0.5 || h < -2.6) continue;
        out.push({ kind: 'snag', key: `${key}:s`, x, z, h, hgt: 2.5 + rr() * 3.5, ang: rr() * 6.28, v: Math.floor(rr() * 2), bird: rr() < 0.6, ph: rr() * 6, fly: 0, gone: 0 }); break;
      }
    }
    this.cells.set(key, out); this.cacheEvictions += trimOldest(this.cells, DEBRIS_CACHE_LIMIT, this.live); return out;
  }
  near(x, z, r) {
    const out = []; const i0 = Math.floor((x - r) / DEB_CELL), i1 = Math.floor((x + r) / DEB_CELL), j0 = Math.floor((z - r) / DEB_CELL), j1 = Math.floor((z + r) / DEB_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const d of this.cellAt(i, j)) if (Math.hypot(d.x - x, d.z - z) <= r) out.push(d);
    return out;
  }
  build(d) {
    if (d.kind === 'log') {
      const m = new THREE.Mesh(this.logGeos[d.v], this.logMats[d.m]); m.scale.set(d.r, d.r, d.len); m.castShadow = true; m.receiveShadow = true;
      const g = new THREE.Group(); g.add(m); g.position.set(d.x, -0.1, d.z); g.rotation.y = d.ang;
      // cooters sunning in a row on top, ready to drop off
      if (d.nt) { const rr = mulberry32(d.ts); g.userData.turtles = []; for (let i = 0; i < d.nt; i++) { const side = rr() < 0.5 ? -1 : 1; const tt = spawn('turtle_boat'); tt.position.set(side * 0.05, d.r * 0.95, (i - (d.nt - 1) / 2) * 1.0 + (rr() - 0.5) * 0.3); tt.rotation.y = side * Math.PI / 2 + (rr() - 0.5) * 1.2; tt.scale.setScalar(0.8 + rr() * 0.5); g.add(tt); g.userData.turtles.push({ m: tt, home: tt.position.clone(), rot: tt.rotation.y, side, st: 0, t: 0 }); } }
      return g;
    }
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.snagGeos[d.v], this.snagMat); m.scale.set(1, d.hgt - d.h, 1); m.castShadow = true; m.receiveShadow = true; m.rotation.y = d.ang; g.add(m);
    if (d.bird) { const b = anhinga(); b.scale.setScalar(1.5); b.position.set(0, d.hgt - d.h + 0.02, 0); b.rotation.y = d.ang + 1.2; g.add(b); g.userData.bird = b; }
    g.position.set(d.x, d.h, d.z); return g;
  }
  update(dt, t, phys, waveFn, audio, currents = null) {
    const bx = phys.pos.x, bz = phys.pos.y;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      for (const d of this.near(bx, bz, 420)) if (!this.live.has(d.key)) { const m = this.build(d); this.scene.add(m); this.live.set(d.key, { d, m }); }
      for (const [key, l] of this.live) if (Math.hypot(l.d.x - bx, l.d.z - bz) > 520) { this.scene.remove(l.m); this.live.delete(key); }
    }
    this.obs.length = 0;
    for (const { d, m } of this.live.values()) {
      const dist = Math.hypot(d.x - bx, d.z - bz);
      if (d.kind === 'log') {
        // A loose deadhead belongs to the same water as the hull. Collision impulse rides on top of the slower tidal drift.
        let flowX = 0, flowZ = 0;
        if (currents) { const f = currents.flowAt(d.x, d.z, this._flow); flowX = f.x * 0.72; flowZ = f.y * 0.72; }
        const follow = 1 - Math.exp(-dt * (currents ? 0.32 : 0.9));
        d.vx += (flowX - d.vx) * follow; d.vz += (flowZ - d.vz) * follow;
        // shoved by the hull: drifts and swings, then settles back into the current
        if (d.vx || d.vz || d.av) {
          d.x += d.vx * dt; d.z += d.vz * dt; d.ang += d.av * dt; const k = Math.exp(-dt * 0.9); d.av *= k;
          if (Math.abs(d.vx) < 0.01 && Math.abs(d.vz) < 0.01) { d.vx = d.vz = 0; }
          if (this.T.heightAt(d.x, d.z) > -0.5) { d.vx = -d.vx * 0.3; d.vz = -d.vz * 0.3; }
          m.position.x = d.x; m.position.z = d.z; m.rotation.y = d.ang;
        }
        m.position.y = waveFn(d.x, d.z, t) - 0.08 + Math.sin(t * 0.7 + d.ph) * 0.03; m.rotation.z = Math.sin(t * 0.5 + d.ph) * 0.04; m.rotation.x = Math.sin(t * 0.8 + d.ph * 2) * 0.02;
        const tts = m.userData.turtles;
        if (tts && dist < 120) for (const tt of tts) {
          if (tt.st === 0) { if (dist < 24 && (phys.speed > 1.5 || dist < 9)) { tt.st = 1; tt.t = 0; if (audio) audio.plip(0.25 * Math.max(0, 1 - dist / 30), d.x, d.z); this.spooked++; } else tt.m.position.y = tt.home.y + Math.sin(t * 0.9 + tt.home.z) * 0.004; }
          else if (tt.st === 1) { tt.t += dt; const k = tt.t; tt.m.position.x = tt.home.x + tt.side * k * 1.8; tt.m.position.y = tt.home.y - k * k * 4; tt.m.rotation.z = tt.side * Math.min(1.4, k * 2.5); if (k > 0.45) { tt.m.visible = false; tt.st = 2; tt.t = 40 + Math.random() * 40; } }
          else { tt.t -= dt; if (tt.t <= 0 && dist > 35) { tt.st = 0; tt.m.visible = true; tt.m.position.copy(tt.home); tt.m.rotation.set(0, tt.rot, 0); } }
        }
        if (dist < 60) {
          const hx = -Math.sin(d.ang) * d.len * 0.5, hz = -Math.cos(d.ang) * d.len * 0.5;
          if (!d.obs) d.obs = { tag: 'log', r: d.r + 0.2, onHit: (into, nx, nz) => { d.vx += -nx * into * 0.35; d.vz += -nz * into * 0.35; d.av += (Math.random() - 0.5) * into * 0.25; } };
          d.obs.ax = d.x + hx; d.obs.az = d.z + hz; d.obs.bx = d.x - hx; d.obs.bz = d.z - hz; this.obs.push(d.obs);
        }
      } else {
        if (dist < 60) { if (!d.obs) d.obs = { tag: 'snag', x: d.x, z: d.z, r: 0.5 }; this.obs.push(d.obs); }
        const b = m.userData.bird; if (!b) continue;
        if (d.fly > 0) {
          d.fly -= dt; const p = 1 - d.fly / 4; b.position.y += (1.2 - p * 0.4) * dt; b.position.x += Math.sin(d.ang + 1.2) * -6 * dt; b.position.z += Math.cos(d.ang + 1.2) * -6 * dt;
          b.rotation.z = Math.sin(t * 9) * 0.5; b.rotation.x = -0.4;
          if (d.fly <= 0) { b.visible = false; d.gone = 45; }
        } else if (d.gone > 0) { d.gone -= dt; if (d.gone <= 0) { b.visible = true; b.position.set(0, d.hgt - d.h + 0.02, 0); b.rotation.set(0, d.ang + 1.2, 0); } }
        else {
          b.rotation.z = Math.sin(t * 1.3 + d.ph) * 0.04; // wings held out to dry, a little shrug now and then
          if (dist < 30 && phys.speed > 2.5) { d.fly = 4; this.spooked++; if (audio) audio.squawk(0.15, d.x, d.z); }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Traffic: other boats on the water
// ---------------------------------------------------------------------------------------------------------------
const YELLS = ['Watch it!', 'Hey! Learn to drive that thing!', 'You blind, son?', 'Easy! Easy!', 'That is a new hull, dammit!'];
const ANGLER_SLOW = ['Any luck?', 'Nothin\' but gar, all morning', 'They were biting at first light', 'Got a nice bream. Go on, quiet now'];
const ANGLER_WAKE = ['Slow down! You are rocking my boat!', 'Idle speed, you fool!', 'There goes my whole morning', 'I got a line out here!'];
const STEER_PROBES = [-0.7, -0.35, 0, 0.35, 0.7];
const SHELTER_RELEASE_MARGIN = 0.09;
const TOW_BERTH_RADII = [6.5, 8.5, 10.5, 12.5];
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const TRAFFIC_PROFILES = [
  { id: 'net-nine', callsign: 'NET BOAT 9', operator: 'EDDIE MORA', job: 'mullet netter', duty: [4.5, 14], threshold: 0.12, cruise: 0.72, work: [18, 34, 0.72], maxStorm: 0.58, channel: 'CH 16', faction: 'locals', color: '#78a6bd' },
  { id: 'marsh-ice', callsign: 'MARSH ICE', operator: 'ROSA MENDEZ', job: 'fish buyer', duty: [5.25, 16.2], threshold: 0.38, cruise: 0.82, work: [10, 22, 0.42], maxStorm: 0.66, channel: 'CH 68', faction: 'locals', color: '#8eb895' },
  { id: 'bay-star', callsign: 'BAY STAR', operator: 'GABE NOLAN', job: 'guide boat', duty: [8, 18.5], threshold: 0.66, cruise: 0.72, work: [8, 16, 0.2], maxStorm: 0.4, channel: 'CH 16', faction: 'locals', color: '#d7c98d' },
  { id: 'bird-crew', callsign: 'BIRD CREW', operator: 'IMANI WELLS', job: 'rookery survey', duty: [6.25, 19.25], threshold: 0.5, cruise: 0.64, work: [24, 44, 0.68], maxStorm: 0.5, channel: 'CH 68', faction: 'fwc', color: '#a8c8bf' },
  { id: 'fwc-27', callsign: 'FWC 27', operator: 'WARDEN SOTO', job: 'backcountry patrol', duty: [5.5, 23], threshold: 0.16, cruise: 0.84, work: [5, 10, 0.08], maxStorm: 0.94, channel: 'FWC TAC', faction: 'fwc', color: '#5aa7ff', essential: true },
  { id: 'back-line', callsign: 'BACK LINE', operator: 'RAFE MERCER', job: 'night courier', duty: [18.5, 5.2], threshold: 0.07, cruise: 0.94, work: [5, 12, 0.12], maxStorm: 0.72, channel: 'CH 72', faction: 'runners', color: '#cf7e43' },
  { id: 'glades-field', callsign: 'GLADES FIELD 3', operator: 'TESS WARD + MALIK JONES', job: 'water survey', duty: [6.5, 18], threshold: 0.72, cruise: 0.9, work: [30, 52, 0.75], maxStorm: 0.28, channel: 'CH 68', faction: 'fwc', color: '#dbc98f' },
];
function callsignAssets() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = '700 18px "Arial Narrow", "Avenir Next Condensed", sans-serif';
  for (let i = 0; i < TRAFFIC_PROFILES.length; i++) {
    const y = i * 32; ctx.fillStyle = '#111816'; ctx.fillRect(0, y, 256, 32); ctx.fillStyle = TRAFFIC_PROFILES[i].color; ctx.fillRect(0, y, 9, 32);
    ctx.fillStyle = '#e9eee8'; ctx.fillText(TRAFFIC_PROFILES[i].callsign, 132, y + 16, 224); ctx.strokeStyle = 'rgba(235,241,234,.32)'; ctx.strokeRect(0.5, y + 0.5, 255, 31);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const geometries = TRAFFIC_PROFILES.map((_, i) => {
    const geo = new THREE.PlaneGeometry(1.55, 0.26), uv = geo.attributes.uv, v0 = 1 - (i + 1) / 8, v1 = 1 - i / 8;
    for (let j = 0; j < uv.count; j++) uv.setY(j, v0 + uv.getY(j) * (v1 - v0)); return geo;
  });
  return { material, geometries };
}
const CALLSIGN = callsignAssets();
const GEAR_BOX = new THREE.BoxGeometry(0.52, 0.32, 0.42);
const GEAR_LINE = new THREE.CylinderGeometry(0.009, 0.009, 1.5, 4);
const GEAR_FLOAT = new THREE.SphereGeometry(0.075, 7, 5);
const GEAR_ROD = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
const GEAR_LAMP = new THREE.CylinderGeometry(0.08, 0.105, 0.16, 8);
const NAV_LIGHT = new THREE.SphereGeometry(0.04, 7, 5);
const GEAR_MATS = {
  white: new THREE.MeshStandardMaterial({ color: 0xd9ddd4, roughness: 0.72 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x292d29, roughness: 0.9 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe06b2f, roughness: 0.7 }),
  line: new THREE.MeshBasicMaterial({ color: 0xd8d1bd }),
  red: new THREE.MeshBasicMaterial({ color: 0xff3028, toneMapped: false }), green: new THREE.MeshBasicMaterial({ color: 0x35ff86, toneMapped: false }),
  blue: new THREE.MeshBasicMaterial({ color: 0x2d82ff, toneMapped: false }), warm: new THREE.MeshBasicMaterial({ color: 0xffe7b3, toneMapped: false }),
};
const SEARCH_BEAM_GEO = new THREE.PlaneGeometry(1, 1);
const searchBeamMaterial = color => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 color; varying vec2 vUv; void main(){float v=vUv.y;float width=mix(0.06,0.7,v);float side=1.0-smoothstep(width*0.54,width,abs(vUv.x-0.5)*2.0);float fade=smoothstep(0.0,0.09,v)*(1.0-smoothstep(0.68,1.0,v));gl_FragColor=vec4(color,side*fade*0.075);}',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
});
const SEARCH_BEAM_MATS = { patrol: searchBeamMaterial(0xd9efff), courier: searchBeamMaterial(0xffe1b5) };
const shiftOn = (hour, duty) => duty[0] < duty[1] ? hour >= duty[0] && hour < duty[1] : hour >= duty[0] || hour < duty[1];
function wakeSampleAt(sx, sz, heading, speed, maxSpeed, scale, x, z, t) {
  const strength = Math.max(0, Math.min(1, (speed - 2.2) / Math.max(1, maxSpeed - 2.2))); if (strength <= 0) return 0;
  const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = -Math.cos(heading), rz = Math.sin(heading);
  const dx = x - sx, dz = z - sz, aft = -(dx * fx + dz * fz); if (aft < 1.5 || aft > 95) return 0;
  const lateral = Math.abs(dx * rx + dz * rz), arm = 1.1 + aft * 0.34, width = 0.7 + aft * 0.025;
  const edge = Math.abs(lateral - arm), ridge = Math.exp(-(edge * edge) / (width * width));
  const centerWidth = 1.4 + aft * 0.055, trough = Math.exp(-(lateral * lateral) / (centerWidth * centerWidth));
  if (ridge < 0.002 && trough < 0.002) return 0;
  const phase = t * (4.2 + strength * 0.8) - aft * (0.46 + strength * 0.08) + (sx + sz) * 0.013;
  return scale * strength * strength * Math.exp(-aft / 85) * (ridge * Math.sin(phase) - trough * 0.27 * Math.sin(phase * 0.73 + 1.2));
}
const RECOLOR_MATERIALS = new Map();
function recolor(group, from, to) {
  if (from === to) return;
  group.traverse(o => {
    if (!o.isMesh || !o.material?.color || o.material.color.getHex() !== from) return;
    const original = o.material, key = `${original.uuid}:${to}`;
    o.material = cachedResource(RECOLOR_MATERIALS, key, () => { const material = original.clone(); material.color.setHex(to); return material; });
  });
}
const FISHERMAN_GEO = Object.freeze({
  torso: sharedResource(new THREE.CapsuleGeometry(0.17, 0.4, 4, 8)),
  head: sharedResource(new THREE.SphereGeometry(0.11, 10, 8)),
  brim: sharedResource(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 12)),
  crown: sharedResource(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 10)),
  leg: sharedResource(new THREE.CapsuleGeometry(0.06, 0.3, 4, 6)),
  arm: sharedResource(new THREE.CapsuleGeometry(0.05, 0.35, 4, 6)),
  rod: sharedResource(new THREE.CylinderGeometry(0.008, 0.016, 2.4, 5)),
});
const FISHERMAN_MAT = Object.freeze({
  skin: sharedResource(new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.85 })),
  shirts: [0xd8d2c0, 0x3b5f8a, 0x8a3b2f, 0x6b7a4a].map(color => sharedResource(new THREE.MeshStandardMaterial({ color, roughness: 0.9 }))),
  hat: sharedResource(new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 0.9 })),
  pants: sharedResource(new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9 })),
  rod: sharedResource(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 })),
});
const ANGLER_GEO = Object.freeze({
  anchorLine: sharedResource(new THREE.CylinderGeometry(0.006, 0.006, 2.2, 4)),
  cooler: sharedResource(new THREE.BoxGeometry(0.5, 0.35, 0.35)),
  bobber: sharedResource(new THREE.SphereGeometry(0.05, 8, 6)),
});
const ANGLER_MAT = Object.freeze({
  anchorLine: sharedResource(new THREE.MeshStandardMaterial({ color: 0xd9d4c4 })),
  cooler: sharedResource(new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 })),
  bobber: sharedResource(new THREE.MeshStandardMaterial({ color: 0xe2552a })),
});
function fisherman(rr) {
  const g = new THREE.Group();
  const shirt = FISHERMAN_MAT.shirts[Math.floor(rr() * FISHERMAN_MAT.shirts.length)];
  const torso = new THREE.Mesh(FISHERMAN_GEO.torso, shirt); torso.position.y = 0.42; g.add(torso);
  const head = new THREE.Mesh(FISHERMAN_GEO.head, FISHERMAN_MAT.skin); head.position.y = 0.82; g.add(head);
  const hat = new THREE.Mesh(FISHERMAN_GEO.brim, FISHERMAN_MAT.hat); hat.position.y = 0.9; g.add(hat);
  const crown = new THREE.Mesh(FISHERMAN_GEO.crown, FISHERMAN_MAT.hat); crown.position.y = 0.96; g.add(crown);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(FISHERMAN_GEO.leg, FISHERMAN_MAT.pants); leg.position.set(sx * 0.1, 0.12, -0.15); leg.rotation.x = -1.1; g.add(leg); }
  const arm = new THREE.Mesh(FISHERMAN_GEO.arm, FISHERMAN_MAT.skin); arm.position.set(0.22, 0.5, -0.15); arm.rotation.x = -1.1; arm.rotation.z = -0.5; g.add(arm);
  const rod = new THREE.Mesh(FISHERMAN_GEO.rod, FISHERMAN_MAT.rod); rod.position.set(0.32, 0.9, -0.9); rod.rotation.x = -1.0; rod.rotation.z = -0.15; g.add(rod); g.userData.rod = rod;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export class Traffic {
  constructor(terrain, scene, phys, fx) {
    this.T = terrain; this.scene = scene; this.phys = phys; this.fx = fx; // { plume, spray, audio, waveFn, emitStamp, game }
    this.rand = mulberry32(4242);
    this.boats = [];
    const saved = fx.game.save.traffic;
    this.state = saved && saved.version === 1 ? saved : { version: 1, operators: {} };
    this.state.operators ||= {}; fx.game.save.traffic = this.state;
    const john = (hull) => { const m = buildSkiff({ crew: true }); if (hull) recolor(m, 0x6f7570, hull); return { kind: 'john', mesh: m, crew: m.userData.crew, people: m.userData.people, max: 6.5 + this.rand() * 2.5 }; };
    const air = (hull) => { const b = buildAirboat(); recolor(b.group, 0xd8dcda, hull); loadDriver(b.group).catch(() => {}); return { kind: 'air', mesh: b.group, prop: b.prop, blur: b.blur, rudders: b.rudders, max: 10.5 + this.rand() * 2.5 }; };
    const cruiser = () => { const m = spawn('boat_dreams'); const rr = this.rand; const d = person(rr, { pose: 'sit', hat: true, drive: true }); d.position.set(0.45, 0.95, 0.3); d.rotation.y = Math.PI; m.add(d); const pas = person(rr, { pose: 'sit', hat: false, vest: true }); pas.position.set(-0.45, 0.95, 0.3); pas.rotation.y = Math.PI; m.add(pas); pair(d, pas); return { kind: 'cruiser', mesh: m, max: 8.5 + rr() * 2, people: [d, pas] }; };
    const skiff = () => { const m = spawn('beau_boat'); const rr = this.rand; const d = person(rr, { pose: 'sit', hat: true, drive: true }); d.position.set(0, 0.32, 0.7); d.rotation.y = Math.PI; m.add(d); return { kind: 'skiff', mesh: m, max: 5 + rr() * 1.5, people: [d] }; };
    const paddlers = () => ({ kind: 'canoe', mesh: canoe(this.rand), max: 1.3 + this.rand() * 0.4 });
    const hulls = [john(0), john(0x4c6b4a), cruiser(), skiff(), air(0x315e50), air(0x4b3527), paddlers()];
    for (let i = 0; i < hulls.length; i++) {
      const b = hulls[i], profile = TRAFFIC_PROFILES[i];
      const record = this.state.operators[profile.id] ||= { shifts: 0, passes: 0, collisions: 0, lastMet: '', lastShift: '' };
      record.seriousCollisions = Number(record.seriousCollisions) || 0; record.aidedAfterCollision = Number(record.aidedAfterCollision) || 0; record.leftDisabled = Number(record.leftDisabled) || 0;
      record.wakeComplaints = Math.max(0, Math.min(9999, Number(record.wakeComplaints) || 0)); record.wakeReports = Math.max(0, Math.min(9999, Number(record.wakeReports) || 0));
      record.wakeShiftKey = typeof record.wakeShiftKey === 'string' ? record.wakeShiftKey : ''; record.wakeShiftComplaints = Math.max(0, Math.min(MAX_SHIFT_WAKE_COMPLAINTS, Number(record.wakeShiftComplaints) || 0)); record.lastWakeSeverity = Math.max(0, Math.min(2, Number(record.lastWakeSeverity) || 0));
      const shelter = { active: false, arrived: false, kind: '', key: '', name: '', x: 0, z: 0, heading: 0, distance: 0 };
      const collision = { active: false, stage: '', t: 0, elapsed: 0, hold: 0, farT: 0, signalT: 0, impact: 0, distance: Infinity, prevState: 'transit', prevRetiring: false, prevLeg: 0, prevWorkT: 0, prevWorkRig: false, marker: { x: 0, z: 0, label: '', color: '#f06c38', trafficCollision: profile.id } };
      Object.assign(b, { profile, record, shelter, collision, shelterSlot: i, assisting: false, active: false, retiring: false, state: 'off', spawnT: 3 + i * 2.7, leg: 0, routeBias: 0, workT: 0, greetT: 0, wakeT: 0, x: 1e9, z: 1e9, heading: 0, speed: 0, turn: 0, roll: 0, pitch: 0, waterRoll: 0, waterPitch: 0, weatherSpeedScale: 1, hornT: 0, fogHornT: 6 + i * 16, fogSignalIndex: i, signalYield: 0, signalT: 0, signalSide: -1, signalReplyT: 0, signalReplyLong: false, yellT: 0, ground: 0, shx: 0, shz: 0, pursuitYield: 0, pursuitNoticeT: 0, pursuitReactionDelay: 0.42 + this.rand() * 0.58, pursuitYieldSide: i & 1 ? 1 : -1, pursuitReacted: false, spoutAvoidance: 0, spoutDistance: Infinity, spoutNoticeT: 0, spoutReactionDelay: 0.65 + this.rand() * 1.1, spoutReacted: false });
      this.addWorkingDetails(b, i);
      b.mesh.visible = false; scene.add(b.mesh); this.boats.push(b);
      b.obs = { tag: 'boat', r: b.kind === 'air' ? 1.35 : b.kind === 'cruiser' ? 1.3 : b.kind === 'canoe' ? 0.5 : 1.1, boat: b, onHit: (into, nx, nz) => {
        b.shx += -nx * into * 0.5; b.shz += -nz * into * 0.5; b.speed *= 0.5;
        let pursuit = false;
        if (b.yellT <= 0 && into > 2.5) { b.yellT = 8; b.record.collisions++; pursuit = fx.game.boatHit(b, into); fx.game.persist(); }
        if (pursuit) { this.retire(b, 90); return; }
        if (into >= 6) this.beginCollisionAftermath(b, into);
      } };
    }
    this.obs = []; phys.addObs('traffic', this.obs);
    this.activity = 1; this.anglerActivity = 1; this.collisionBoat = null; this.radio = null; this.pursuitCallMade = false; this.pursuitClearT = 0;
    this.assist = { active: false, failed: false, berthSafe: false, berthDepth: 0, boat: null, boatId: '', phase: '', side: 0, fore: 0, headingOffset: 0, targetX: 0, targetZ: 0, distance: 0, eta: 0, arrived: false, holdT: 0 };
    // anchored anglers
    this.anglerCells = new Map(); this.liveAnglers = new Map(); this.checkT = 0; this.anglerCacheEvictions = 0;
    this.idlePasses = 0; this._flow = new THREE.Vector2(); this._pf = new THREE.Vector2(); this._bob = new THREE.Vector3();
    this._navVisibility = { port: true, starboard: true, stern: true };
  }
  addWorkingDetails(b, profileIndex) {
    const deck = b.kind === 'air' ? 0.55 : b.kind === 'canoe' ? 0.3 : b.kind === 'cruiser' ? 0.85 : 0.42;
    const beam = b.kind === 'canoe' ? 0.35 : b.kind === 'air' ? 0.85 : 0.65;
    const cargo = new THREE.Group(); cargo.name = `work-gear:${b.profile.id}`;
    const boxes = b.profile.id === 'marsh-ice' ? 3 : ['net-nine', 'bird-crew', 'back-line', 'glades-field'].includes(b.profile.id) ? 1 : 0;
    for (let i = 0; i < boxes; i++) {
      const mat = b.profile.id === 'back-line' ? GEAR_MATS.dark : GEAR_MATS.white;
      const box = new THREE.Mesh(GEAR_BOX, mat); box.position.set((i - (boxes - 1) / 2) * 0.48, deck, b.kind === 'canoe' ? 0 : -0.55); box.castShadow = true; cargo.add(box);
    }
    if (b.profile.id === 'net-nine') {
      for (let i = 0; i < 4; i++) { const marker = new THREE.Mesh(GEAR_FLOAT, i % 2 ? GEAR_MATS.white : GEAR_MATS.orange); marker.position.set(-0.55 + i * 0.36, deck + 0.18, -1.05); cargo.add(marker); }
    } else if (b.profile.id === 'bird-crew' || b.profile.id === 'glades-field') {
      const sampler = new THREE.Mesh(GEAR_ROD, GEAR_MATS.orange); sampler.position.set(-beam * 0.55, deck + 0.45, -0.45); cargo.add(sampler);
      const cap = new THREE.Mesh(GEAR_FLOAT, GEAR_MATS.white); cap.scale.setScalar(0.72); cap.position.set(-beam * 0.55, deck + 0.97, -0.45); cargo.add(cap);
    } else if (b.profile.id === 'fwc-27') {
      const aerial = new THREE.Mesh(GEAR_ROD, GEAR_MATS.dark); aerial.scale.y = 1.25; aerial.position.set(-0.38, deck + 0.78, 0.42); cargo.add(aerial);
      const lamp = new THREE.Mesh(GEAR_LAMP, GEAR_MATS.warm); lamp.rotation.x = Math.PI / 2; lamp.position.set(0.35, deck + 0.78, -0.38); cargo.add(lamp);
    }
    b.mesh.add(cargo); b.cargo = cargo;
    const identity = new THREE.Group(); identity.name = `callsign:${b.profile.id}`;
    const hullBeam = b.kind === 'john' ? 0.875 : b.kind === 'air' ? 0.9 : b.kind === 'cruiser' ? 0.98 : b.kind === 'canoe' ? 0.38 : 0.7;
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(CALLSIGN.geometries[profileIndex], CALLSIGN.material); plate.position.set(side * hullBeam, deck - 0.13, 0.25); plate.rotation.y = side * Math.PI / 2;
      const scale = b.kind === 'canoe' ? 0.72 : b.kind === 'air' ? 0.9 : b.kind === 'john' ? 0.86 : 1; plate.scale.set(scale, scale, scale); identity.add(plate);
    }
    b.mesh.add(identity); b.identity = identity;
    const work = new THREE.Group(); work.name = `working:${b.profile.id}`;
    const line = new THREE.Mesh(GEAR_LINE, GEAR_MATS.line); line.position.set(beam + 0.14, deck - 0.68, -0.25); line.rotation.z = -0.08;
    const flt = new THREE.Mesh(GEAR_FLOAT, GEAR_MATS.orange); flt.position.set(beam + 0.18, deck - 1.42, -0.25); work.add(line, flt); work.visible = false;
    b.mesh.add(work); b.workRig = work;
    const nav = new THREE.Group(); nav.name = `nav-lights:${b.profile.id}`;
    const port = new THREE.Mesh(NAV_LIGHT, GEAR_MATS.red), starboard = new THREE.Mesh(NAV_LIGHT, GEAR_MATS.green), stern = new THREE.Mesh(NAV_LIGHT, GEAR_MATS.warm);
    port.position.set(-beam, deck + 0.42, -0.1); starboard.position.set(beam, deck + 0.42, -0.1); stern.position.set(0, deck + 0.34, 1.35); nav.add(port, starboard, stern);
    const deckLight = new THREE.PointLight(0xffe0ad, 0, 11, 2); deckLight.position.set(0, deck + 0.72, 0.15); nav.add(deckLight); nav.visible = false;
    b.mesh.add(nav); b.navLights = nav; b.navBulbs = { port, starboard, stern };
    b.deckLight = deckLight;
    if (b.profile.id === 'fwc-27' || b.profile.id === 'back-line') {
      const patrol = b.profile.id === 'fwc-27', rig = new THREE.Group(); rig.name = `searchlight:${b.profile.id}`; rig.position.set(0, deck + 0.72, -0.65);
      const target = new THREE.Object3D(); target.position.set(0, -0.5, -70);
      const light = new THREE.SpotLight(patrol ? 0xd9efff : 0xffe1b5, 0, patrol ? 135 : 95, patrol ? 0.13 : 0.11, 0.52, 1.65); light.target = target;
      const length = patrol ? 36 : 28, width = patrol ? 5.5 : 3.8, beam = new THREE.Mesh(SEARCH_BEAM_GEO, patrol ? SEARCH_BEAM_MATS.patrol : SEARCH_BEAM_MATS.courier); beam.rotation.x = -Math.PI / 2; beam.scale.set(width, length, 1); beam.renderOrder = 34; beam.visible = false;
      rig.add(light, target); rig.visible = false; b.mesh.add(rig); (this.fx.waterScene || this.scene).add(beam); b.searchRig = rig; b.searchLight = light; b.searchBeam = beam; b.searchLength = length; b.searchWidth = width;
    }
    if (b.profile.id === 'fwc-27') {
      const beacon = new THREE.Group(); const blue = new THREE.Mesh(NAV_LIGHT, GEAR_MATS.blue), red = new THREE.Mesh(NAV_LIGHT, GEAR_MATS.red);
      blue.scale.setScalar(1.45); red.scale.setScalar(1.45); blue.position.x = -0.1; red.position.x = 0.1;
      const blueLight = new THREE.PointLight(0x2d82ff, 0, 18, 2), redLight = new THREE.PointLight(0xff3028, 0, 18, 2);
      blueLight.position.x = -0.1; redLight.position.x = 0.1; beacon.add(blue, red, blueLight, redLight); beacon.position.set(0, deck + 1.35, 0.35); beacon.visible = false; b.mesh.add(beacon);
      b.beacon = beacon; b.beaconBulbs = { blue, red, blueLight, redLight };
    }
  }
  shiftKey(b) {
    if (!this.environment) return '0';
    const d = this.environment.day - (b.profile.duty[0] > b.profile.duty[1] && this.environment.hour < b.profile.duty[1] ? 1 : 0);
    return `${d}:${b.profile.id}`;
  }
  onDuty(b) { return !this.environment || shiftOn(this.environment.hour, b.profile.duty); }
  shouldOperate(b) {
    if (!this.onDuty(b)) return false;
    const storm = this.environment?.values.storm || 0;
    if (storm > b.profile.maxStorm) return false;
    return b.profile.essential ? this.activity > 0.08 : this.activity >= b.profile.threshold;
  }
  stormUnsafe(b) { return (this.environment?.values.storm || 0) > b.profile.maxStorm; }
  clearShelter(b) {
    const s = b.shelter; s.active = false; s.arrived = false; s.kind = ''; s.key = ''; s.name = ''; s.distance = 0;
  }
  chooseShelter(b) {
    const s = b.shelter, world = this.fx.game.world;
    s.active = true; s.arrived = false; s.kind = 'lee'; s.key = ''; s.name = 'the lee bank'; s.x = b.x; s.z = b.z; s.distance = 0;
    const wind = this.environment?.windDir, wx = wind?.x || 1, wz = wind?.z || 0;
    s.heading = Math.atan2(wx, wz); // bow toward the weather while holding

    // Named camps are preferred. Fixed berth slots keep the seven persistent crews from stacking on one tie-up.
    const nearest = world?.nearestCamp(b.x, b.z, 1400);
    if (nearest?.camp) {
      const c = nearest.camp, preferred = (b.shelterSlot & 1 ? 1 : -1) * (7.5 + Math.floor(b.shelterSlot / 2) * 7.5);
      for (let k = 0; k < 11; k++) {
        const side = k === 0 ? preferred : (k & 1 ? 1 : -1) * (7.5 + Math.floor((k - 1) / 2) * 7.5);
        const x = c.tie.x - Math.sin(c.ang) * side, z = c.tie.z + Math.cos(c.ang) * side;
        if (this.T.heightAt(x, z) > -0.65 || world.blockedAt(x, z) || !this.waterPathClear(b.x, b.z, x, z, 0.58)) continue;
        let occupied = false;
        for (const other of this.boats) if (other !== b && other.shelter.active && other.shelter.key === c.key && Math.hypot(other.shelter.x - x, other.shelter.z - z) < 7) { occupied = true; break; }
        if (occupied) continue;
        s.kind = 'camp'; s.key = c.key; s.name = c.name; s.x = x; s.z = z;
        const outX = -Math.cos(c.ang), outZ = -Math.sin(c.ang); s.heading = Math.atan2(-outX, -outZ);
        s.distance = Math.hypot(s.x - b.x, s.z - b.z); return s;
      }
    }

    // If no camp is close enough, find deep water with a bank on the upwind side and hold there.
    let best = -1e9;
    for (let ring = 0; ring < 5; ring++) for (let i = 0; i < 24; i++) {
      const a = i / 24 * 6.283 + b.shelterSlot * 0.17, r = 55 + ring * 38;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      const h = this.T.heightAt(x, z), mh = this.T.heightAt((b.x + x) * 0.5, (b.z + z) * 0.5), holdFx = -Math.sin(s.heading), holdFz = -Math.cos(s.heading);
      const footprint = Math.max(h, this.T.heightAt(x + holdFx * 3.2, z + holdFz * 3.2), this.T.heightAt(x - holdFx * 3.2, z - holdFz * 3.2));
      if (footprint > -0.62 || mh > -0.58 || Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 650 || world?.blockedAt(x, z) || !this.waterPathClear(b.x, b.z, x, z, 0.58)) continue;
      const upwind = this.T.heightAt(x - wx * 34, z - wz * 34);
      const score = Math.min(4, -h) + Math.max(-1, Math.min(2.5, upwind + 0.7)) * 1.8 - ring * 0.12;
      if (score > best) { best = score; s.x = x; s.z = z; }
    }
    if (best === -1e9) { s.kind = 'hold'; s.name = 'deep-water hold'; s.heading = b.heading; }
    s.distance = Math.hypot(s.x - b.x, s.z - b.z); return s;
  }
  beginShelter(b) {
    this.chooseShelter(b); b.state = 'shelter-run'; b.retiring = false; b.workT = 0; b.leg = 0; b.routeBias = 0;
    // A skipper caught on the wrong heading first comes off the throttle, then turns into the sounded escape lane.
    b.speed = Math.min(b.speed, b.max * 0.12); b.turn = 0;
    if (b.workRig) b.workRig.visible = false;
  }
  requestTow() {
    const A = this.assist; if (A.active) return true;
    const b = this.boats.find(q => q.profile.id === 'fwc-27'); if (!b) { A.failed = true; return false; }
    if (b.collision.active) { A.failed = true; return false; }
    if (!this.chooseTowBerth()) { A.failed = true; return false; }
    const d = b.active ? Math.hypot(b.x - A.targetX, b.z - A.targetZ) : Infinity;
    if (!b.active || d > 220 || !this.waterPathClear(b.x, b.z, A.targetX, A.targetZ)) { if (b.active) this.retire(b, 4); if (!this.spawnTowSpot(b)) { A.failed = true; return false; } }
    this.clearShelter(b); b.assisting = true; b.retiring = false; b.state = 'tow-response'; b.routeBias = 0; b.workT = 0; b.leg = 0; b.speed = Math.min(b.speed, b.max * 0.5); b.turn = 0;
    if (b.workRig) b.workRig.visible = false;
    A.active = true; A.failed = false; A.boat = b; A.boatId = b.profile.id; A.phase = 'tow-response'; A.distance = Math.hypot(b.x - this.phys.pos.x, b.z - this.phys.pos.y); A.eta = 0; A.arrived = false; A.holdT = 0;
    return true;
  }
  cancelTow() {
    const A = this.assist, b = A.boat;
    if (b) { b.assisting = false; if (b.active) { this.beginLeg(b); b.retiring = !this.shouldOperate(b); } }
    A.active = false; A.failed = false; A.berthSafe = false; A.berthDepth = 0; A.boat = null; A.boatId = ''; A.phase = ''; A.side = 0; A.fore = 0; A.headingOffset = 0; A.targetX = 0; A.targetZ = 0; A.distance = 0; A.eta = 0; A.arrived = false; A.holdT = 0;
  }
  failTow(b) {
    const A = this.assist; if (b) { b.assisting = false; this.retire(b, 8); }
    A.active = false; A.failed = true; A.berthSafe = false; A.berthDepth = 0; A.boat = null; A.boatId = ''; A.phase = 'failed'; A.side = 0; A.fore = 0; A.headingOffset = 0; A.targetX = 0; A.targetZ = 0; A.distance = 0; A.eta = 0; A.arrived = false; A.holdT = 0;
  }
  towStatus() { return this.assist; }
  chooseTowBerth() {
    const A = this.assist, P = this.phys, world = this.fx.game.world, bx = P.pos.x, bz = P.pos.y;
    const pfx = -Math.sin(P.heading), pfz = -Math.cos(P.heading), prx = Math.cos(P.heading), prz = -Math.sin(P.heading);
    let best = -1e9; A.berthSafe = false; A.berthDepth = 0;
    // Sound a short ring around the disabled hull. The responder may need to lie at an angle in a narrow cut,
    // so test both the berth and the patrol boat's complete footprint rather than assuming open water to starboard.
    for (const radius of TOW_BERTH_RADII) for (let i = 0; i < 16; i++) {
      const a = P.heading + i * Math.PI / 8, x = bx + Math.cos(a) * radius, z = bz + Math.sin(a) * radius;
      const dx = x - bx, dz = z - bz, sideMetres = dx * prx + dz * prz, fore = dx * pfx + dz * pfz;
      for (let j = 0; j < 8; j++) {
        const heading = P.heading + j * Math.PI / 4, fx = -Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
        const depth = Math.min(-this.T.heightAt(x, z), -this.T.heightAt(x + fx * 3.2, z + fz * 3.2), -this.T.heightAt(x - fx * 3.2, z - fz * 3.2), -this.T.heightAt(x + rx * 1.2, z + rz * 1.2), -this.T.heightAt(x - rx * 1.2, z - rz * 1.2));
        if (depth < 0.5 || world?.blockedAt(x, z) || world?.blockedAt(x + fx * 3.2, z + fz * 3.2) || world?.blockedAt(x - fx * 3.2, z - fz * 3.2) || world?.blockedAt(x + rx * 1.2, z + rz * 1.2) || world?.blockedAt(x - rx * 1.2, z - rz * 1.2)) continue;
        const headingOffset = wrapAngle(heading - P.heading);
        const score = Math.min(4, depth) * 2 + Math.abs(sideMetres) * 0.035 - Math.abs(fore) * 0.012 + Math.cos(headingOffset) * 0.22 - Math.abs(radius - 8.5) * 0.035;
        if (score > best) { best = score; A.berthSafe = true; A.berthDepth = depth; A.side = sideMetres / 8.5; A.fore = fore; A.headingOffset = headingOffset; A.targetX = x; A.targetZ = z; }
      }
    }
    return A.berthSafe;
  }
  waterPathClear(ax, az, bx, bz, clearance = 0.62) {
    const world = this.fx.game.world, d = Math.hypot(bx - ax, bz - az), steps = Math.max(2, Math.ceil(d / 7));
    for (let i = 1; i < steps; i++) { const k = i / steps, x = ax + (bx - ax) * k, z = az + (bz - az) * k; if (this.T.heightAt(x, z) > -clearance || world?.blockedAt(x, z)) return false; }
    return true;
  }
  spawnTowSpot(b) {
    const A = this.assist, world = this.fx.game.world, phase = this.rand() * 6.283;
    for (let pass = 0; pass < 3; pass++) {
      // The last pass is a dense local sweep used only in winding cuts where the two broad searches found no
      // straight approach. It makes dispatch dependable without keeping a route grid or allocating path nodes.
      const count = pass === 0 ? 220 : pass === 1 ? 180 : 1440;
      for (let k = 0; k < count; k++) {
        const ring = pass === 2 ? Math.floor(k / 96) : 0;
        const a = pass === 2 ? phase + ring * 0.019 + (k % 96) * Math.PI / 48 : phase + pass * 0.71 + k * 2.399963;
        const r = pass === 0 ? 72 + (k % 10) * 12 + this.rand() * 10 : pass === 1 ? 38 + (k % 7) * 7 + this.rand() * 6 : 26 + ring * 2;
        const x = A.targetX + Math.cos(a) * r, z = A.targetZ + Math.sin(a) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 650 || Math.hypot(x - this.phys.pos.x, z - this.phys.pos.y) < 26 || this.T.heightAt(x, z) > (pass === 0 ? -0.9 : pass === 1 ? -0.72 : -0.62) || world?.blockedAt(x, z)) continue;
        if (!this.waterPathClear(x, z, A.targetX, A.targetZ, pass === 0 ? 0.58 : pass === 1 ? 0.54 : 0.52)) continue;
        b.x = x; b.z = z; b.heading = Math.atan2(-(A.targetX - x), -(A.targetZ - z)); b.speed = b.max * 0.45; b.mesh.visible = true; b.ground = 0; b.active = true; b.retiring = false; this.beginLeg(b, true);
        const key = this.shiftKey(b); if (b.record.lastShift !== key) { b.record.lastShift = key; b.record.shifts++; this.fx.game.persist(); }
        return true;
      }
    }
    return false;
  }
  beginLeg(b, first = false) {
    b.state = 'transit'; b.workT = 0; b.leg = (first ? 220 : 280) + this.rand() * (first ? 260 : 520); b.routeBias = (this.rand() - 0.5) * (b.profile.id === 'back-line' ? 0.72 : 0.46);
    if (b.workRig) b.workRig.visible = false;
  }
  beginWork(b) {
    const [lo, hi] = b.profile.work; b.state = 'work'; b.workT = lo + this.rand() * (hi - lo); b.routeBias = 0;
    if (b.workRig) b.workRig.visible = !['bay-star', 'fwc-27', 'back-line'].includes(b.profile.id);
  }
  activeCollision() { return this.collisionBoat?.collision.active ? this.collisionBoat : null; }
  collisionWorldFree(b) {
    const G = this.fx.game;
    return b.active && b.kind !== 'canoe' && !b.assisting && !b.shelter.active && !G.paused && !G.state && !G.story?.blocking() && !G.aftermath?.blocking() && !G.encounters?.active && !G.incidents?.active;
  }
  signalCollisionCrew(b) {
    const C = b.collision; if (!C.active || C.stage !== 'disabled') return;
    if (b.people?.length) wave(b.people[b.people.length - 1]);
    const d = C.distance;
    if (d < 115) this.fx.audio.horn(Math.max(0.08, 0.26 * (1 - d / 130)), b.x, b.z);
    C.signalT = 4.6;
  }
  beginCollisionAftermath(b, impact) {
    if (!this.collisionWorldFree(b) || this.activeCollision() || b.collision.active) return false;
    const C = b.collision, P = b.profile;
    C.active = true; C.stage = 'disabled'; C.t = 0; C.elapsed = 0; C.hold = 0; C.farT = 0; C.signalT = 0; C.impact = impact; C.distance = Math.hypot(b.x - this.phys.pos.x, b.z - this.phys.pos.y);
    C.prevState = b.state; C.prevRetiring = b.retiring; C.prevLeg = b.leg; C.prevWorkT = b.workT; C.prevWorkRig = Boolean(b.workRig?.visible);
    C.marker.x = b.x; C.marker.z = b.z; C.marker.label = `${P.callsign} disabled · hold alongside`;
    b.state = 'collision-disabled'; b.retiring = false; b.speed = Math.min(b.speed, 1.1); b.turn = 0; b.greetT = 18;
    if (b.workRig) b.workRig.visible = false;
    this.collisionBoat = b; this.fx.game.wpTarget = C.marker;
    b.record.seriousCollisions++; this.fx.game.persist();
    this.fx.game.toast('Their engine stopped', `${P.callsign} · idle below 5.5 mph and hold alongside`, 4.2);
    this.radio?.transmit({ channel: P.channel, speaker: `${P.callsign} · ${P.operator}`, text: 'Tower Boat, you hit us hard. Engine is down. Kill your prop and hold alongside while we check everybody.', priority: 3, key: `working-collision:${P.id}:${b.record.seriousCollisions}`, cooldown: 99999 });
    this.signalCollisionCrew(b); return true;
  }
  restoreAfterCollision(b) {
    const C = b.collision, wasWork = C.prevState === 'work' && !C.prevRetiring;
    b.retiring = C.prevRetiring || !this.shouldOperate(b); b.turn = 0; b.speed = Math.min(b.speed, b.max * 0.16);
    if (wasWork && !b.retiring) { b.state = 'work'; b.workT = Math.max(10, C.prevWorkT); if (b.workRig) b.workRig.visible = C.prevWorkRig; }
    else { b.state = 'transit'; b.leg = Math.max(90, C.prevLeg); if (b.workRig) b.workRig.visible = false; }
    C.active = false; C.stage = ''; C.t = 0; C.elapsed = 0; C.hold = 0; C.farT = 0; C.signalT = 0; C.distance = Infinity;
    if (this.fx.game.wpTarget === C.marker) this.fx.game.wpTarget = null;
    if (this.collisionBoat === b) this.collisionBoat = null;
  }
  abandonCollision(b) {
    const C = b.collision, P = b.profile; if (!C.active || C.stage !== 'disabled') return;
    C.stage = 'reported'; C.t = 0; C.hold = 0; C.marker.label = `${P.callsign} disabled · incident reported`;
    if (this.fx.game.wpTarget === C.marker) this.fx.game.wpTarget = null;
    b.record.leftDisabled++; this.fx.game.persist();
    this.law?.add(0.95, `left ${P.callsign} disabled after collision`, true);
    this.reputation?.change(P.faction, -0.55, 'left-disabled-boat', `${P.callsign} told the district the tower boat struck them and left.`, false);
    this.fx.game.toast('Hit-and-run reported', `${P.callsign} put your hull and direction over the radio`, 4.2);
    this.radio?.transmit({ channel: 'CH 16', speaker: `${P.callsign} · ${P.operator}`, text: 'All stations, tower airboat struck us and left. We are disabled in the channel. Logging their direction now.', priority: 3, key: `working-abandoned:${P.id}:${b.record.leftDisabled}`, cooldown: 99999 });
  }
  updateCollisionAftermath(b, dt, d) {
    const C = b.collision, P = b.profile; if (!C.active) return;
    C.t += dt; C.elapsed += dt; C.distance = d; C.signalT -= dt; C.marker.x = b.x; C.marker.z = b.z;
    if (C.stage === 'disabled') {
      const holding = d < 24 && this.phys.speed * 2.23694 < 5.5 && !this.phys.airborne && this.phys.wipeT <= 0;
      C.hold = holding ? Math.min(7, C.hold + dt) : Math.max(0, C.hold - dt * 0.55);
      C.farT = C.elapsed > 4 && d > 120 ? C.farT + dt : Math.max(0, C.farT - dt * 1.5);
      C.marker.label = C.hold > 0.2 ? `${P.callsign} · crew check ${Math.ceil(7 - C.hold)}s` : `${P.callsign} disabled · hold alongside`;
      this.fx.game.wpTarget = C.marker;
      if (C.signalT <= 0 && d < 115) this.signalCollisionCrew(b);
      if (C.hold >= 7) {
        C.stage = 'restart'; C.t = 0; C.marker.label = `${P.callsign} · restarting engine`;
        b.record.aidedAfterCollision++; this.fx.game.persist();
        this.reputation?.change(P.faction, 0.2, 'stayed-after-collision', `You stayed alongside while ${P.callsign} checked the crew and restarted.`, false);
        this.fx.game.toast('Everybody is accounted for', `${P.callsign} is restarting · the collision remains on the log`, 3.8);
        this.radio?.transmit({ channel: P.channel, speaker: `${P.callsign} · ${P.operator}`, text: 'Everybody is accounted for. We have steering. Stand clear while I restart her.', priority: 2, key: `working-aided:${P.id}:${b.record.aidedAfterCollision}`, cooldown: 99999 });
      } else if (C.farT >= 2.2) this.abandonCollision(b);
      else if (C.elapsed >= 58) {
        this.fx.game.toast('They got the engine back', `${P.callsign} · you stayed, but never came alongside`, 3.4);
        this.radio?.transmit({ channel: P.channel, speaker: `${P.callsign} · ${P.operator}`, text: 'Engine is back. Tower Boat, next time come alongside and make sure everybody is standing.', priority: 2, key: `working-unassisted:${P.id}:${b.record.seriousCollisions}`, cooldown: 99999 });
        this.restoreAfterCollision(b);
      }
    } else if (C.stage === 'restart' && C.t >= 4.5) this.restoreAfterCollision(b);
    else if (C.stage === 'reported' && (C.t >= 18 || d > 980)) this.restoreAfterCollision(b);
  }
  retire(b, delay = 28) {
    if (b.collision?.active) this.restoreAfterCollision(b);
    this.clearShelter(b); b.assisting = false; b.active = false; b.retiring = false; b.state = 'off'; b.mesh.visible = false; b.x = b.z = 1e9; b.speed = 0; b.spawnT = delay + this.rand() * delay;
    b.signalYield = 0; b.signalT = 0; b.signalReplyT = 0; b.signalReplyLong = false;
    if (b.workRig) b.workRig.visible = false; if (b.navLights) b.navLights.visible = false; if (b.deckLight) b.deckLight.intensity = 0;
    if (b.searchRig) { b.searchRig.visible = false; b.searchLight.intensity = 0; b.searchBeam.visible = false; }
    if (b.beacon) b.beacon.visible = false; if (b.beaconBulbs) b.beaconBulbs.blueLight.intensity = b.beaconBulbs.redLight.intensity = 0;
  }
  // a deep channel spot 350-650 m from the boat, and a heading along the channel
  spawnSpot(b) {
    const hf = this.T.hf, p = this.phys.pos;
    for (let k = 0; k < 60; k++) {
      const a = this.rand() * 6.283, r = 350 + this.rand() * 300; const x = p.x + Math.cos(a) * r, z = p.y + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 700) continue;
      const c = hf.computeBase(x, z); if (c.s < 0.7 || c.h > -2.2 || c.lake > 0.5) continue;
      let best = null, bd = 0;
      for (let i = 0; i < 12; i++) { const h = i / 12 * 6.283; const d = -hf.compute(x - Math.sin(h) * 40, z - Math.cos(h) * 40) - hf.compute(x - Math.sin(h) * 80, z - Math.cos(h) * 80); if (d > bd) { bd = d; best = h; } }
      if (best === null || bd < 3) continue;
      this.clearShelter(b); b.assisting = false; b.x = x; b.z = z; b.heading = best; b.speed = b.max * 0.45; b.mesh.visible = true; b.ground = 0; b.active = true; b.retiring = false; this.beginLeg(b, true);
      const key = this.shiftKey(b);
      if (b.record.lastShift !== key) { b.record.lastShift = key; b.record.shifts++; this.fx.game.persist(); }
      return true;
    }
    return false;
  }
  identify(b, d, playerSpeed) {
    b.greetT = Math.max(0, b.greetT);
    if (b.collision.active || d >= 27 || playerSpeed >= 4.2 || b.greetT > 0) return;
    const key = this.shiftKey(b); if (b.record.lastMet === key) return;
    b.record.lastMet = key; b.record.passes++; b.greetT = 24; this.fx.game.persist();
    if (b.people?.length) wave(b.people[b.people.length - 1]);
    const restricted = (this.environment?.restrictedVisibility || 0) > 0.45;
    const state = b.state === 'tow-response' ? 'responding to your tow call' : b.state === 'tow-alongside' ? 'passing a tow line' : b.state === 'shelter-run' ? `making for ${b.shelter.name}` : b.state === 'sheltered' ? `weathered in at ${b.shelter.name}` : b.state === 'work' ? `working · ${b.profile.job}` : restricted ? 'making way slow · restricted visibility' : b.retiring ? 'heading in' : b.profile.job;
    const wakeMemory = !b.assisting && !b.shelter.active && b.record.wakeComplaints > 0 ? (b.record.wakeReports > 0 ? ' · prior wake report on file' : ' · remembers your last wake') : '';
    this.fx.game.toast(`${b.profile.callsign} · ${b.profile.operator}`, state + wakeMemory, 2.8);
  }
  recordWakeComplaint(b, severity, distance) {
    const P = b.profile, record = b.record, shift = this.shiftKey(b);
    if (record.wakeShiftKey !== shift) { record.wakeShiftKey = shift; record.wakeShiftComplaints = 0; }
    if (record.wakeShiftComplaints >= MAX_SHIFT_WAKE_COMPLAINTS) { b.wakeT = 30; return false; }
    const previousComplaints = record.wakeComplaints;
    record.wakeShiftComplaints++; record.wakeComplaints = Math.min(9999, previousComplaints + 1); record.lastWakeSeverity = severity;
    const enforcementCrew = P.faction === 'fwc';
    const consequence = wakeConsequence({ severity, shiftComplaints: record.wakeShiftComplaints, previousComplaints, enforcementCrew });
    b.wakeT = consequence.reported ? 24 : 14;
    if (!consequence.reported) {
      const warning = b.kind === 'canoe' ? '“Easy on the wake.”' : '“No wake. Gear in the water.”';
      const detail = b.kind === 'canoe' ? `${P.callsign} · water survey under paddle` : `${P.callsign} · ${P.job}`;
      this.fx.game.toast(warning, detail, 2.6);
    } else {
      record.wakeReports = Math.min(9999, record.wakeReports + 1);
      const hard = severity >= 2;
      const text = enforcementCrew
        ? hard ? 'Tower Boat, hard wake through an active survey station. Your hull and direction are going on the FWC log.' : 'Tower Boat, that is another wake through our station. Your hull and direction are going on the FWC log.'
        : hard ? 'Tower Boat, that wake hit our gear hard. I am logging your hull and direction with FWC.' : 'Tower Boat, that is the second wake through our gear. I am logging your hull and direction with FWC.';
      if (consequence.horn) this.fx.audio.horn(Math.max(0.1, 0.34 * (1 - distance / 115)), b.x, b.z);
      this.fx.game.toast('Dangerous wake reported', `${P.callsign} logged your hull and direction`, 3.5);
      this.radio?.transmit({ channel: P.channel, speaker: `${P.callsign} · ${P.operator}`, text, priority: 3, key: `working-wake:${P.id}:${record.wakeReports}`, cooldown: 99999 });
      this.law?.add(consequence.attention, `dangerous wake reported by ${P.callsign}`, false);
    }
    this.reputation?.change(P.faction, consequence.reputation, 'working-wake', `${P.callsign} remembers the tower airboat's wake through ${b.kind === 'canoe' ? 'their paddle station' : 'their working gear'}.`, false);
    this.fx.game.persist(); return true;
  }
  updateWorkingDetails(b, t) {
    const h = this.environment?.hour ?? 12, storm = this.environment?.values.storm || 0, restricted = this.environment?.restrictedVisibility || 0;
    const night = h < 6.1 || h > 19.2, distress = b.collision.active && b.collision.stage === 'disabled'; if (b.navLights) b.navLights.visible = b.active && (night || storm > 0.42 || restricted > 0.25 || distress);
    const camera = this.fx.camera?.position;
    if (b.navLights?.visible && b.navBulbs && camera) {
      const dx = camera.x - b.x, dz = camera.z - b.z, c = Math.cos(b.heading), s = Math.sin(b.heading);
      const visible = navigationLightVisibility(dx * c - dz * s, dx * s + dz * c, this._navVisibility);
      b.navBulbs.port.visible = visible.port; b.navBulbs.starboard.visible = visible.starboard; b.navBulbs.stern.visible = visible.stern;
    }
    if (b.deckLight) b.deckLight.intensity = distress ? (Math.floor(t * 2.4) % 2 ? 42 : 4) : b.navLights.visible ? (night ? 28 : restricted > 0.25 ? 16 : 12) : 0;
    if (b.searchRig) {
      const on = b.active && (night || storm > 0.58 || restricted > 0.68), patrol = b.profile.id === 'fwc-27'; b.searchRig.visible = on; b.searchBeam.visible = on;
      b.searchLight.intensity = on ? (patrol ? 720 : 360) * Math.max(0.5, 1 - storm * 0.28) : 0;
      const scan = patrol ? Math.sin(t * 0.43) * 0.34 + Math.sin(t * 0.17 + 1.2) * 0.1 : Math.sin(t * 0.21 + 0.7) * 0.055;
      b.searchRig.rotation.y = scan;
      if (on) { const a = b.heading + scan, fx = -Math.sin(a), fz = -Math.cos(a); b.searchBeam.position.set(b.x + fx * b.searchLength * 0.5, (this.environment?.waterLevel || 0) + 0.055, b.z + fz * b.searchLength * 0.5); b.searchBeam.rotation.set(-Math.PI / 2, a, 0, 'YXZ'); }
    }
    if (b.workRig?.visible) b.workRig.rotation.z = Math.sin(t * 0.8 + b.heading) * 0.05;
    if (b.beacon) {
      const called = b.assisting || (this.law?.attention || 0) > 0.55 || storm > 0.65;
      b.beacon.visible = b.active && called;
      const blueOn = Math.floor(t * 5.5) % 2 === 0, B = b.beaconBulbs;
      B.blue.visible = blueOn; B.red.visible = !blueOn; B.blueLight.intensity = blueOn ? 95 : 2; B.redLight.intensity = blueOn ? 2 : 95;
    }
  }
  updateCrew(b, t, dt, d, playerWake) {
    if (!b.crew?.length) return;
    const P = this.phys, desired = Math.atan2(-(P.pos.x - b.x), -(P.pos.y - b.z));
    const relative = Math.atan2(Math.sin(desired - b.heading), Math.cos(desired - b.heading));
    const pursuitYield = b.pursuitYield || 0, lookRange = pursuitYield > 0.04 ? 145 : b.signalT > 0 ? 120 : 46;
    const look = d < lookRange ? Math.max(-0.95, Math.min(0.95, relative)) : 0, k = 1 - Math.exp(-dt * 5.5);
    const working = b.state === 'work', stormBrace = b.shelter.active ? (this.environment?.values.sea || 0) * 0.12 : 0;
    const brace = Math.min(0.32, Math.abs(playerWake) * 3.4 + stormBrace + pursuitYield * 0.14);
    const scannedDriver = b.mesh.userData.driverModel;
    if (scannedDriver) {
      scannedDriver.rotation.y += ((scannedDriver.userData.baseYaw + look * 0.12) - scannedDriver.rotation.y) * k;
      scannedDriver.rotation.z += ((-b.turn * 0.025 + playerWake * 0.05) - scannedDriver.rotation.z) * k;
    }
    for (const person of b.crew) {
      const u = person.userData.skiffCrew; u.head.rotation.y += (look - u.head.rotation.y) * k;
      const lean = u.driver ? b.pitch * 0.25 : working ? 0.14 + Math.sin(t * 0.7 + u.phase) * 0.025 : brace;
      person.rotation.x += (lean - person.rotation.x) * k;
      for (let i = 0; i < u.arms.length; i++) {
        let tx = u.baseX[i] + (u.driver ? b.turn * (i ? -0.18 : 0.18) : working ? Math.sin(t * 1.3 + u.phase + i) * 0.16 : brace);
        const tz = u.baseZ[i], ty = 0.48;
        const arm = u.arms[i]; arm.rotation.x += (tx - arm.rotation.x) * k; arm.rotation.z += (tz - arm.rotation.z) * k; arm.position.y += (ty - arm.position.y) * k;
      }
    }
  }
  updatePursuitResponse(b, d, pf, dt, blocked) {
    const active = Boolean(this.law?.pursuit);
    const target = blocked ? 0 : pursuitYieldStrength(active, this.law?.attention || 0, d, this.phys.speed, b.kind, b.profile.id === 'fwc-27');
    b.pursuitNoticeT = target > 0.04 ? b.pursuitNoticeT + dt : Math.max(0, b.pursuitNoticeT - dt * 1.6);
    const aware = b.pursuitNoticeT >= b.pursuitReactionDelay, desired = aware ? target : 0;
    const rate = desired > b.pursuitYield ? 2.6 : 1.15;
    b.pursuitYield += (desired - b.pursuitYield) * (1 - Math.exp(-dt * rate));
    if (aware && !b.pursuitReacted) {
      const cross = pf.x * (b.z - this.phys.pos.y) - pf.y * (b.x - this.phys.pos.x);
      if (Math.abs(cross) > 0.05) b.pursuitYieldSide = cross > 0 ? -1 : 1;
      b.pursuitReacted = true;
      if (b.kind !== 'canoe' && b.hornT <= 0) { b.hornT = 10; this.fx.audio.horn(0.16 + Math.max(0, 1 - d / 180) * 0.2, b.x, b.z); }
      if (!this.pursuitCallMade && this.radio) {
        const runners = b.profile.faction === 'runners';
        this.pursuitCallMade = this.radio.transmit({
          channel: runners ? 'CH 72' : b.profile.channel,
          speaker: `${b.profile.callsign} · ${b.profile.operator}`,
          text: runners ? 'Blue lights behind Tower Boat. I am clearing the cut—keep the back line open.' : 'Blue lights coming through. Clearing the cut and holding my wake.',
          priority: 2,
          key: `traffic:pursuit-yield:${b.profile.id}`,
          cooldown: 50,
        }) || this.pursuitCallMade;
      }
    }
    if (!active && b.pursuitYield < 0.02) { b.pursuitNoticeT = 0; b.pursuitReacted = false; }
    return b.pursuitYield;
  }
  updateWaterspoutResponse(b, dt, blocked) {
    const spout = this.hazards?.spout, active = Boolean(spout?.active);
    const distance = active ? Math.hypot(spout.x - b.x, spout.z - b.z) : Infinity;
    const target = blocked ? 0 : waterspoutAvoidanceStrength(active, distance, b.kind);
    b.spoutDistance = distance; b.spoutNoticeT = target > 0.025 ? b.spoutNoticeT + dt : Math.max(0, b.spoutNoticeT - dt * 1.8);
    const aware = waterspoutReactionReady(distance, b.spoutNoticeT, b.spoutReactionDelay), desired = aware ? target : 0;
    const rate = desired > b.spoutAvoidance ? 3.2 : 1.35;
    b.spoutAvoidance += (desired - b.spoutAvoidance) * (1 - Math.exp(-dt * rate));
    if (aware && !b.spoutReacted) { b.spoutReacted = true; if (b.state === 'work') this.beginLeg(b); }
    if (!active && b.spoutAvoidance < 0.015) { b.spoutNoticeT = 0; b.spoutReacted = false; }
    return b.spoutAvoidance;
  }
  signalPlayerHorn(prolonged = false) {
    const P = this.phys, pf = P.forward(this._pf), replyReach = prolonged ? 300 : 185; let reply = null, replyDistance = Infinity, responses = 0;
    for (const b of this.boats) {
      if (!b.active) continue;
      const dx = b.x - P.pos.x, dz = b.z - P.pos.y, d = Math.hypot(dx, dz); if (d < 0.001) continue;
      if (b.kind !== 'canoe' && d < replyReach && d < replyDistance && b.hornT <= 0 && b.signalReplyT <= 0) { reply = b; replyDistance = d; }
      if (b.collision.active || b.assisting || b.shelter.active) continue;
      const dirX = dx / d, dirZ = dz / d, ahead = pf.x * dirX + pf.y * dirZ;
      const bfx = -Math.sin(b.heading), bfz = -Math.cos(b.heading);
      const closing = Math.max(0, P.vel.x * dirX + P.vel.y * dirZ - b.speed * (bfx * dirX + bfz * dirZ));
      const strength = hornYieldStrength(d, ahead, closing, b.kind, prolonged); if (strength <= 0.01) continue;
      b.signalYield = Math.max(b.signalYield, strength); b.signalT = Math.max(b.signalT, 3.4 + strength * 3.2 + (prolonged ? 1.4 : 0));
      const toPlayerX = -dirX, toPlayerZ = -dirZ, cross = bfx * toPlayerZ - bfz * toPlayerX;
      b.signalSide = Math.abs(cross) < 0.14 ? -1 : cross > 0 ? 1 : -1; responses++;
    }
    if (reply) { reply.signalReplyT = prolonged ? 5 + this.rand() * 0.7 : 0.32 + this.rand() * 0.34; reply.signalReplyLong = prolonged && (this.environment?.restrictedVisibility || 0) > 0.45; }
    return responses;
  }
  radioPool() {
    const bx = this.phys.pos.x, bz = this.phys.pos.y;
    const nearby = this.boats.filter(b => b.active && Math.hypot(b.x - bx, b.z - bz) < 900);
    const calls = [];
    for (const b of nearby) {
      const P = b.profile, working = b.state === 'work'; let text = '';
      if (b.collision.active) text = b.collision.stage === 'reported' ? `${P.callsign} is disabled after a collision. The striking tower airboat left the scene.` : `${P.callsign} is disabled after a collision. Keep the cut open while the crew checks everyone aboard.`;
      else if (b.state === 'tow-response') text = 'Twenty-seven is responding to the tower boat. Hold position and leave room on the approach.';
      else if (b.state === 'tow-alongside') text = 'Twenty-seven is alongside the tower boat. Passing the tow line now.';
      else if (b.state === 'shelter-run') text = `${P.callsign} is making for ${b.shelter.name}. Keep the approach open and pass astern.`;
      else if (b.state === 'sheltered') text = `${P.callsign} is secured at ${b.shelter.name}. Staying put until the wind comes down.`;
      else if ((this.environment?.restrictedVisibility || 0) > 0.45 && P.id === 'net-nine' && working) text = 'Net Nine is fishing in restricted visibility. Gear is down; listen for one prolonged and two short.';
      else if ((this.environment?.restrictedVisibility || 0) > 0.45 && b.kind !== 'canoe') text = `${P.callsign} is making way slow in restricted visibility. One prolonged blast on the next interval.`;
      else if (P.id === 'net-nine') text = working ? 'Net is in the water on the outside bank. Pass my stern and keep your wash off it.' : 'Net Nine is moving to the next set. I will hold the narrow bend.';
      else if (P.id === 'marsh-ice') text = 'Cold boxes aboard and running back toward the camps. I am taking the next blind turn slow.';
      else if (P.id === 'bay-star') text = 'Guide boat has two passengers aboard. We will idle through the rookery water.';
      else if (P.id === 'bird-crew') text = working ? 'Bird Crew is stopped on a sample station. Give us fifty yards and no wake.' : 'Bird Crew moving between the white stakes. Survey gear is still out.';
      else if (P.id === 'fwc-27') text = (this.law?.attention || 0) > 1 ? 'Twenty-seven is working an active call. Keep sixteen clear.' : 'Patrol twenty-seven is checking camp approaches and navigation lights.';
      else if (P.id === 'back-line') { if ((this.reputation?.score('runners') || 0) < 1) continue; text = 'Back Line is moving. Keep names and landmarks off this channel.'; }
      else if (P.id === 'glades-field') text = working ? 'Field Three is taking a water sample. Paddle crew is stationary in the west half of the cut.' : 'Field Three is under paddle and clear of the marked channel.';
      if (text) calls.push([P.channel, `${P.callsign} · ${P.operator}`, text]);
    }
    return calls;
  }
  wakeHeightAt(x, z, t) {
    let height = 0;
    for (const b of this.boats) if (b.active && b.kind !== 'canoe') {
      const scale = b.kind === 'air' ? 0.18 : b.kind === 'cruiser' ? 0.13 : 0.105;
      height += wakeSampleAt(b.x, b.z, b.heading, b.speed, b.max, scale, x, z, t);
    }
    return Math.max(-0.24, Math.min(0.24, height));
  }
  playerWakeAt(x, z, t) {
    const P = this.phys;
    return wakeSampleAt(P.pos.x, P.pos.y, P.heading, P.speed, 18, 0.22, x, z, t);
  }
  snapshot() {
    return this.boats.map(b => ({ id: b.profile.id, callsign: b.profile.callsign, operator: b.profile.operator, job: b.profile.job, onDuty: this.onDuty(b), shouldOperate: this.shouldOperate(b), stormLimit: b.profile.maxStorm, active: b.active, assisting: b.assisting, retiring: b.retiring, state: b.state, x: b.x, z: b.z, speed: b.speed, weatherSpeedScale: b.weatherSpeedScale, pursuitYield: b.pursuitYield, waterspoutAvoidance: b.spoutAvoidance, waterspoutDistance: b.spoutDistance, hornYield: b.signalYield, hornReplyIn: b.signalReplyT, fogSignalIn: b.fogHornT, shelter: b.shelter.active ? { kind: b.shelter.kind, key: b.shelter.key, name: b.shelter.name, x: b.shelter.x, z: b.shelter.z, heading: b.shelter.heading, distance: b.shelter.distance, arrived: b.shelter.arrived } : null, collision: b.collision.active ? { stage: b.collision.stage, impact: b.collision.impact, hold: b.collision.hold, distance: b.collision.distance } : null, shifts: b.record.shifts, passes: b.record.passes, collisions: b.record.collisions, seriousCollisions: b.record.seriousCollisions, aidedAfterCollision: b.record.aidedAfterCollision, leftDisabled: b.record.leftDisabled, wakeComplaints: b.record.wakeComplaints, wakeReports: b.record.wakeReports, shiftWakeComplaints: b.record.wakeShiftComplaints }));
  }
  // ---- anglers ----
  anglerAt(ci, cj) {
    const key = `${ci},${cj}`; if (this.anglerCells.has(key)) return this.anglerCells.get(key);
    let ang = null; const C = 600, cx = ci * C, cz = cj * C;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF - 700 && homeDist(cx, cz) > 650) {
      const rr = mulberry32(hash2(ci + 909, cj + 77) ^ 0x51ac);
      if (rr() < 0.4) { const hf = this.T.hf; for (let t = 0; t < 20; t++) { const x = cx + rr() * C, z = cz + rr() * C; const h = hf.compute(x, z); if (h > -1.1 || h < -3.2) continue; ang = { key, x, z, heading: rr() * 6.283, seed: rr() * 1e9 | 0, ph: rr() * 6, said: 0, biteT: 8 + rr() * 20 }; break; } }
    }
    this.anglerCells.set(key, ang); this.anglerCacheEvictions += trimOldest(this.anglerCells, ANGLER_CACHE_LIMIT, this.liveAnglers); return ang;
  }
  anglersNear(x, z, r) {
    const out = [], C = 600; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const a = this.anglerAt(i, j); if (a && Math.hypot(a.x - x, a.z - z) <= r) out.push(a); }
    return out;
  }
  buildAngler(a) {
    const rr = mulberry32(a.seed);
    const g = buildSkiff({ crew: false }); recolor(g, 0x6f7570, [0x6f7570, 0x4c6b4a, 0xb8b4a8][Math.floor(rr() * 3)]);
    const man = fisherman(rr); man.position.set(0.1, 0.45, 0.3); g.add(man); g.userData.man = man;
    // anchor line off the bow, a cooler, a bobber out on the water
    const line = new THREE.Mesh(ANGLER_GEO.anchorLine, ANGLER_MAT.anchorLine); line.position.set(0, -0.4, -2.6); line.rotation.x = 0.5; g.add(line);
    const cooler = new THREE.Mesh(ANGLER_GEO.cooler, ANGLER_MAT.cooler); cooler.position.set(-0.4, 0.3, -0.8); g.add(cooler);
    const bob = new THREE.Mesh(ANGLER_GEO.bobber, ANGLER_MAT.bobber); bob.position.set(1.6, 0, -3.6); g.add(bob); g.userData.bob = bob;
    g.position.set(a.x, 0, a.z); g.rotation.y = a.heading;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    a.obs = { ax: a.x - Math.sin(a.heading) * 2, az: a.z - Math.cos(a.heading) * 2, bx: a.x + Math.sin(a.heading) * 2, bz: a.z + Math.cos(a.heading) * 2, r: 1.1, tag: 'angler', angler: a, onHit: (into) => { if (into > 2 && a.said !== 2) { a.said = 2; this.fx.game.anglerSay(a, YELLS[Math.floor(Math.random() * YELLS.length)]); } } };
    return g;
  }
  update(dt, t, fish) {
    const P = this.phys, bx = P.pos.x, bz = P.pos.y, waveFn = this.fx.waveFn;
    const pf = P.forward(this._pf);
    if (this.law?.pursuit) this.pursuitClearT = 0;
    else { this.pursuitClearT += dt; if (this.pursuitClearT > 4) this.pursuitCallMade = false; }
    this.obs.length = 0; let ob = 0, obp = 1;
    for (const b of this.boats) {
      b.yellT = Math.max(0, b.yellT - dt); b.hornT = Math.max(0, b.hornT - dt); b.greetT = Math.max(0, b.greetT - dt); b.wakeT = Math.max(0, b.wakeT - dt);
      if (b.signalT > 0) b.signalT = Math.max(0, b.signalT - dt); else b.signalYield *= Math.exp(-dt * 2.2);
      if (b.signalReplyT > 0) {
        b.signalReplyT -= dt;
        if (b.signalReplyT <= 0) {
          if (b.signalReplyLong) this.fx.audio.fogHorn(0.2, b.x, b.z); else this.fx.audio.horn(0.18, b.x, b.z);
          b.hornT = b.signalReplyLong ? 9 : 6; b.signalReplyLong = false;
        }
      }
      const weather = this.environment?.values, storm = weather?.storm || 0;
      const fogRisk = this.environment?.restrictedVisibility || 0;
      if (fogRisk > 0.3) b.fogHornT = Math.max(0, b.fogHornT - dt); else b.fogHornT = 6 + b.fogSignalIndex * 16;
      const operate = this.shouldOperate(b), unsafe = this.stormUnsafe(b), assisting = this.assist.active && this.assist.boat === b;
      if (!b.active) {
        b.mesh.visible = false; if (b.searchBeam) b.searchBeam.visible = false;
        if (!operate) { b.spawnT = Math.max(2, b.spawnT); continue; }
        b.spawnT -= dt; if (b.spawnT > 0) continue;
        if (!this.spawnSpot(b)) { b.spawnT = 5 + this.rand() * 8; continue; }
      }
      if (assisting) {
        const A = this.assist, pfx = -Math.sin(P.heading), pfz = -Math.cos(P.heading), prx = Math.cos(P.heading), prz = -Math.sin(P.heading);
        A.targetX = bx + prx * 8.5 * A.side + pfx * A.fore; A.targetZ = bz + prz * 8.5 * A.side + pfz * A.fore;
        A.distance = Math.hypot(A.targetX - b.x, A.targetZ - b.z); A.eta = A.distance / Math.max(2.2, b.speed); A.phase = b.state;
      }
      let d = Math.hypot(b.x - bx, b.z - bz);
      if (assisting && b.ground > 3) { this.failTow(b); continue; }
      if (!assisting && !b.collision.active && (d > 980 || b.ground > 3)) { this.retire(b, b.ground > 3 ? 18 : 25); continue; }
      if (!assisting && !b.collision.active && unsafe && !b.shelter.active) this.beginShelter(b);
      else if (!unsafe && b.shelter.active && storm <= b.profile.maxStorm - SHELTER_RELEASE_MARGIN) {
        if (operate) { this.clearShelter(b); this.beginLeg(b); }
        else if (!this.onDuty(b)) { this.clearShelter(b); this.beginLeg(b); b.retiring = true; }
      }
      if (!assisting && !b.collision.active && !unsafe && !b.shelter.active && !operate) b.retiring = true;
      if (!assisting && !b.collision.active && b.retiring && d > 720) { this.retire(b, 20); continue; }
      b.mesh.visible = true;
      if (b.collision.active) this.updateCollisionAftermath(b, dt, d);
      else if (assisting) {
        const A = this.assist;
        if (b.state === 'tow-response' && A.distance < 6.5) { b.state = 'tow-alongside'; A.arrived = true; A.holdT = 0; }
        else if (b.state === 'tow-alongside' && A.distance > 17) { b.state = 'tow-response'; A.arrived = false; A.holdT = 0; }
        if (b.state === 'tow-alongside') A.holdT += dt; A.phase = b.state;
      } else if (b.shelter.active) {
        const sd = Math.hypot(b.shelter.x - b.x, b.shelter.z - b.z); b.shelter.distance = sd;
        if (b.state === 'shelter-run' && sd < 8) { b.state = 'sheltered'; b.shelter.arrived = true; }
        else if (b.state === 'sheltered' && sd > 18) { b.state = 'shelter-run'; b.shelter.arrived = false; }
      } else if (b.retiring && b.state === 'work') this.beginLeg(b);
      else if (b.state === 'work') { b.workT -= dt; if (b.workT <= 0) this.beginLeg(b); }
      else { b.leg -= b.speed * dt; if (b.leg <= 0) { if (this.rand() < b.profile.work[2]) this.beginWork(b); else this.beginLeg(b); } }
      const maneuverBlocked = b.collision.active || assisting || b.shelter.active;
      const pursuitYield = this.updatePursuitResponse(b, d, pf, dt, maneuverBlocked);
      const spout = this.hazards?.spout, spoutAvoidance = this.updateWaterspoutResponse(b, dt, b.collision.active || assisting || b.state === 'sheltered');
      const signalYield = maneuverBlocked ? 0 : b.signalYield, maneuverYield = Math.max(pursuitYield, signalYield);
      const maneuverSide = pursuitYield >= signalYield ? b.pursuitYieldSide : b.signalSide;
      // steer: probe five headings 24 m out and prefer deep water straight ahead; back off from the player and each other
      let best = 0, bs = b.collision.active ? 2 : -1e9;
      if (!b.collision.active) for (const da of STEER_PROBES) {
        const h = b.heading + da; const px0 = b.x - Math.sin(h) * 10, pz0 = b.z - Math.cos(h) * 10, px = b.x - Math.sin(h) * 24, pz = b.z - Math.cos(h) * 24; const px2 = b.x - Math.sin(h) * 48, pz2 = b.z - Math.cos(h) * 48;
        const depth0 = -this.T.heightAt(px0, pz0), depth = -this.T.heightAt(px, pz), depth2 = -this.T.heightAt(px2, pz2);
        let sc = Math.min(3, depth0) * 0.72 + Math.min(4, depth) + Math.min(4, depth2) * 0.6 - Math.abs(da - (b.state === 'work' ? 0 : b.routeBias)) * 0.72;
        if (depth0 < 0.56) sc -= 22 + (0.56 - depth0) * 26;
        if (depth < 0.62) sc -= 14 + (0.62 - depth) * 18; if (depth2 < 0.48) sc -= 7 + (0.48 - depth2) * 10;
        const dp = Math.hypot(px - bx, pz - bz), playerClear = 22 + fogRisk * 22; if (!assisting && dp < playerClear) sc -= (playerClear - dp) * (0.5 + fogRisk * 0.24);
        if (maneuverYield > 0.01) { sc -= Math.abs(da - maneuverSide * 0.7) * maneuverYield * 3.1; sc += (dp - d) * maneuverYield * 0.32; }
        if (b.state === 'tow-response') {
          const A = this.assist, pd = Math.hypot(px - A.targetX, pz - A.targetZ), desired = Math.atan2(-(A.targetX - b.x), -(A.targetZ - b.z));
          sc += (A.distance - pd) * 0.34 - Math.abs(wrapAngle(h - desired)) * 2.1;
        } else if (b.state === 'tow-alongside') sc -= Math.abs(wrapAngle(h - (P.heading + this.assist.headingOffset))) * 3.8;
        else if (b.state === 'shelter-run') {
          const pd = Math.hypot(px - b.shelter.x, pz - b.shelter.z), desired = Math.atan2(-(b.shelter.x - b.x), -(b.shelter.z - b.z));
          sc += (b.shelter.distance - pd) * 0.45 - Math.abs(wrapAngle(h - desired)) * 3;
        } else if (b.state === 'sheltered') sc -= Math.abs(wrapAngle(h - b.shelter.heading)) * 3.4;
        // Prefer probes that increase separation so an off-duty boat visibly runs out of the local channel.
        if (b.retiring) sc += (dp - d) * 0.16;
        if (spoutAvoidance > 0.01 && spout?.active) sc += waterspoutProbeScore(spout.x, spout.z, spout.motionX, spout.motionZ, b.x, b.z, px2, pz2, spoutAvoidance);
        const trafficClear = 18 + fogRisk * 20;
        for (const o of this.boats) if (o !== b && o.active) { const dd = Math.hypot(px - o.x, pz - o.z); if (dd < trafficClear) sc -= (trafficClear - dd) * (0.4 + fogRisk * 0.22); }
        if (sc > bs) { bs = sc; best = da; }
      }
      const fx0 = -Math.sin(b.heading), fz0 = -Math.cos(b.heading);
      const sea = weather?.sea || 0;
      const seaScale = 1 - Math.min(b.retiring ? 0.24 : 0.46, sea * 0.15 + storm * 0.12);
      b.weatherSpeedScale = seaScale * (1 - fogRisk * (b.kind === 'canoe' ? 0.2 : 0.44));
      let cruise = (b.collision.active || b.state === 'tow-alongside' || b.state === 'sheltered' ? 0 : b.state === 'tow-response' ? b.max * 0.82 : b.state === 'shelter-run' ? b.max * (b.kind === 'canoe' ? 0.72 : 0.82) : b.retiring ? b.max * 0.92 : b.state === 'work' ? (b.kind === 'canoe' ? 0.08 : 0.18) : b.max * b.profile.cruise) * b.weatherSpeedScale;
      const playerAheadRange = 30 + fogRisk * 32;
      let want = cruise * (bs < 1.5 ? 0.45 : 1); if (d < playerAheadRange && (fx0 * (bx - b.x) + fz0 * (bz - b.z)) > 0) want *= 0.5 - fogRisk * 0.14; // slow for the player ahead
      want *= pursuitYieldSpeedScale(pursuitYield, b.kind);
      want *= hornYieldSpeedScale(signalYield, b.kind);
      if (spoutAvoidance > 0.01) want = Math.max(want, b.max * b.weatherSpeedScale * (b.kind === 'canoe' ? 0.38 + spoutAvoidance * 0.2 : 0.48 + spoutAvoidance * 0.3));
      if (b.state === 'shelter-run') { const desired = Math.atan2(-(b.shelter.x - b.x), -(b.shelter.z - b.z)), alignment = 1 - Math.min(1, Math.abs(wrapAngle(desired - b.heading)) / 1.25); want *= 0.04 + alignment * 0.96; }
      const playerWake = d < 100 ? wakeSampleAt(bx, bz, P.heading, P.speed, 18, 0.2, b.x, b.z, t) : 0;
      const wakeLevel = !b.collision.active && !assisting ? wakeSeverity({ kind: b.kind, working: Boolean(b.workRig?.visible), playerSpeed: P.speed, wakeHeight: playerWake }) : 0;
      if (wakeLevel && b.kind === 'canoe' && d < 72) {
        want *= 0.12; const cross = pf.x * (b.z - bz) - pf.y * (b.x - bx); b.routeBias = cross > 0 ? -0.65 : 0.65;
      }
      if (wakeLevel && b.wakeT <= 0) this.recordWakeComplaint(b, wakeLevel, d);
      b.turn += ((b.collision.active ? 0 : best * 2.2) - b.turn) * (1 - Math.exp(-dt * 3)); b.heading += b.turn * dt;
      if (b.state === 'tow-alongside') { const settle = 1 - Math.exp(-dt * 1.8); b.heading += wrapAngle(P.heading + this.assist.headingOffset - b.heading) * settle; b.turn *= Math.exp(-dt * 3); }
      else if (b.state === 'sheltered') { const settle = 1 - Math.exp(-dt * 1.5); b.heading += wrapAngle(b.shelter.heading - b.heading) * settle; b.turn *= Math.exp(-dt * 2.6); }
      b.speed += (want - b.speed) * (1 - Math.exp(-dt * 0.7));
      const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
      const flow = this.fx.currents ? this.fx.currents.flowAt(b.x, b.z, this._flow) : null;
      const windDir = this.environment?.windDir, leeway = (b.kind === 'canoe' ? 0.018 : b.kind === 'air' ? 0.006 : 0.009) * (weather?.wind || 0);
      b.x += (fx * b.speed + (flow ? flow.x : 0) + (windDir ? windDir.x * leeway : 0)) * dt + b.shx * dt;
      b.z += (fz * b.speed + (flow ? flow.y : 0) + (windDir ? windDir.z * leeway : 0)) * dt + b.shz * dt;
      if (b.state === 'tow-alongside') {
        const hold = 1 - Math.exp(-dt * 1.65); b.x += (this.assist.targetX - b.x) * hold; b.z += (this.assist.targetZ - b.z) * hold; b.speed *= Math.exp(-dt * 2.4);
      } else if (b.state === 'sheltered') {
        const moor = 1 - Math.exp(-dt * 1.45); b.x += (b.shelter.x - b.x) * moor; b.z += (b.shelter.z - b.z) * moor; b.speed *= Math.exp(-dt * 2.2);
      }
      if (assisting) { const A = this.assist; A.distance = Math.hypot(A.targetX - b.x, A.targetZ - b.z); A.eta = A.distance / Math.max(2.2, b.speed); A.phase = b.state; }
      if (b.shelter.active) b.shelter.distance = Math.hypot(b.shelter.x - b.x, b.shelter.z - b.z);
      const sk = Math.exp(-dt * 2); b.shx *= sk; b.shz *= sk;
      const gh = this.T.heightAt(b.x, b.z); b.ground = gh > -0.5 ? b.ground + dt : 0; if (gh > -0.5) b.speed *= 0.9;
      const wy = waveFn(b.x, b.z, t) + playerWake;
      const wakeSide = Math.sign((b.x - bx) * -Math.cos(P.heading) + (b.z - bz) * Math.sin(P.heading));
      const halfLength = b.kind === 'canoe' ? 1.45 : b.kind === 'cruiser' ? 2.7 : b.kind === 'air' ? 2.45 : 2.05;
      const halfBeam = b.kind === 'canoe' ? 0.34 : b.kind === 'cruiser' ? 1.25 : b.kind === 'air' ? 1.05 : 0.74;
      const rx = Math.cos(b.heading), rz = -Math.sin(b.heading);
      const bowH = waveFn(b.x + fx * halfLength, b.z + fz * halfLength, t), sternH = waveFn(b.x - fx * halfLength, b.z - fz * halfLength, t);
      const rightH = waveFn(b.x + rx * halfBeam, b.z + rz * halfBeam, t), leftH = waveFn(b.x - rx * halfBeam, b.z - rz * halfBeam, t);
      b.waterPitch = Math.max(-0.2, Math.min(0.2, Math.atan2(bowH - sternH, halfLength * 2)));
      b.waterRoll = Math.max(-0.2, Math.min(0.2, Math.atan2(rightH - leftH, halfBeam * 2)));
      b.roll += ((-b.turn * b.speed * 0.02 + b.waterRoll + playerWake * wakeSide * 0.52) - b.roll) * (1 - Math.exp(-dt * 4));
      b.pitch += ((b.speed * (b.kind === 'air' ? 0.004 : 0.007) + b.waterPitch + playerWake * 0.18) - b.pitch) * (1 - Math.exp(-dt * 3));
      b.mesh.position.set(b.x, wy + (b.kind === 'air' ? -0.27 : b.kind === 'john' || b.kind === 'canoe' ? -0.05 : 0), b.z); b.mesh.rotation.set(b.pitch, b.heading, b.roll, 'YXZ');
      if (b.kind === 'air') { if (!b.collision.active) b.prop.rotation.z += dt * (8 + b.speed * 8); b.blur.material.opacity = b.collision.active ? 0 : Math.min(0.35, b.speed / b.max * 0.4); for (const r of b.rudders) r.rotation.y = -b.turn * 0.25; }
      else if (b.kind === 'john') { const motor = b.mesh.userData.motor; motor.rotation.y = -b.turn * 0.3; if (!b.collision.active) motor.userData.prop.rotation.z += dt * (6 + b.speed * 5); }
      else if (b.kind === 'canoe') paddleAnim(b.mesh, t, Math.min(1, b.speed / b.max));
      if (b.people && d < 90) for (const pp of b.people) animatePerson(pp, t, dt, { x: bx, z: bz, speed: P.speed }, null);
      this.updateCrew(b, t, dt, d, playerWake);
      this.updateWorkingDetails(b, t); this.identify(b, d, P.speed);
      // the closest running motor is what you hear
      if (!b.collision.active && b.kind !== 'air' && b.kind !== 'canoe' && d < 130) { const l = (0.3 + 0.7 * b.speed / b.max) * (1 - d / 130); if (l > ob) { ob = l; obp = b.kind === 'cruiser' ? 0.8 : b.kind === 'skiff' ? 1.25 : 1; } }
      // Rule 35(a): a power-driven vessel making way in restricted visibility sounds one prolonged blast.
      const fogFishing = fogRisk > 0.45 && !b.collision.active && !assisting && b.profile.id === 'net-nine' && b.state === 'work';
      const fogMakingWay = fogRisk > 0.45 && !b.collision.active && !assisting && b.kind !== 'canoe' && !fogFishing && b.state !== 'sheltered' && b.state !== 'tow-alongside' && b.speed > 0.75;
      if ((fogMakingWay || fogFishing) && d < 340 && b.fogHornT <= 0) {
        b.fogHornT = 108 + this.rand() * 11; const volume = 0.5 * fogRisk * Math.max(0.08, 1 - d / 360);
        if (fogFishing) this.fx.audio.fogHornFishing(volume, b.x, b.z); else this.fx.audio.fogHorn(volume, b.x, b.z);
      }
      // horn at a boat coming straight at them
      if (!assisting && b.kind !== 'canoe' && d < 50 && b.hornT <= 0 && P.speed > 6) { const dd = d || 1, cx = (b.x - bx) / dd, cz = (b.z - bz) / dd; if (pf.x * cx + pf.y * cz > 0.9) { b.hornT = 12; this.fx.audio.horn(0.35 * (1 - d / 60), b.x, b.z); } }
      if (d < 70) { b.obs.ax = b.x + fx * 2.2; b.obs.az = b.z + fz * 2.2; b.obs.bx = b.x - fx * 2.2; b.obs.bz = b.z - fz * 2.2; this.obs.push(b.obs); }
      // wake and spray
      if (b.kind === 'canoe') { if (d < 60 && b.speed > 0.5) this.fx.emitStamp(b.x, b.z, 0.8, 0.08, 0.15, 0.5); }
      else if (b.speed > 2 && d < 75) {
        const sp = Math.min(1, b.speed / b.max);
        this.fx.emitStamp(b.x - fx * 1.8, b.z - fz * 1.8, b.kind === 'air' ? 1.5 : 1.1, 0.6 * sp, (b.kind === 'air' ? 2.2 : 1.6) * sp, 1.1);
        this.fx.emitStamp(b.x + fx * 1.8, b.z + fz * 1.8, 1, -0.7 * sp, 0.1 * sp, 0.7);
        const { plume, spray } = this.fx; const n = Math.floor((b.kind === 'air' ? 160 : 70) * dt * sp + Math.random());
        for (let i = 0; i < n; i++) plume.emit(b.x - fx * 2.6 + jitter() * 0.8, 0.1, b.z - fz * 2.6 + jitter() * 0.8, -fx * (1 + Math.random() * 2) + jitter(), 0.6 + Math.random() * 1.6 * sp, -fz * (1 + Math.random() * 2) + jitter(), 0.25 + Math.random() * 0.3, 0.9, 0.6 + Math.random() * 0.5, 0.25);
        for (let i = 0; i < n * 5; i++) spray.emit(b.x - fx * 2.4 + jitter() * 1.2, 0.05, b.z - fz * 2.4 + jitter() * 1.2, -fx * (1 + Math.random() * 3) + jitter() * 1.5, 0.5 + Math.random() * 2, -fz * (1 + Math.random() * 3) + jitter() * 1.5, 0.012 + Math.random() * 0.03, 0.4 + Math.random() * 0.5, 0.5);
      }
    }
    this.obLevel = ob; this.obPitch = obp;
    // anglers come and go with distance
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      if (this.anglerActivity > 0.2) for (const a of this.anglersNear(bx, bz, 480)) if (!this.liveAnglers.has(a.key)) { const g = this.buildAngler(a); this.scene.add(g); this.liveAnglers.set(a.key, { a, g }); }
      for (const [key, l] of this.liveAnglers) if (this.anglerActivity <= 0.2 || Math.hypot(l.a.x - bx, l.a.z - bz) > 580) { this.scene.remove(l.g); this.liveAnglers.delete(key); }
    }
    for (const { a, g } of this.liveAnglers.values()) {
      const d = Math.hypot(a.x - bx, a.z - bz);
      g.position.y = waveFn(a.x, a.z, t) - 0.05; g.rotation.z = Math.sin(t * 0.8 + a.ph) * 0.02 + (d < 25 ? Math.sin(t * 2.4) * Math.min(0.1, P.speed * 0.006) : 0);
      g.userData.man.userData.rod.rotation.x = -1.0 + Math.sin(t * 1.1 + a.ph) * 0.04;
      if (d < 60) this.obs.push(a.obs);
      if (d < 13 && a.said === 0) { a.said = 1; const mph = P.speed * 2.23694; if (mph > 8) this.fx.game.anglerSay(a, ANGLER_WAKE[Math.floor(Math.random() * ANGLER_WAKE.length)], true); else { this.fx.game.anglerSay(a, ANGLER_SLOW[Math.floor(Math.random() * ANGLER_SLOW.length)]); this.idlePasses++; this.fx.game.bounties.event('idlepass', 1); } }
      // now and then something takes the bait
      a.biteT -= dt; if (a.biteT <= 0) { a.biteT = 12 + Math.random() * 25; const bp = g.userData.bob.getWorldPosition(this._bob); if (fish) fish.launch(bp.x, bp.z, 2.4, jitter() * 1.5, jitter() * 1.5, 0.8, 1); }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Folk on the banks: bank anglers with a bucket and a cooler, one per ~500 m cell where a channel bank allows it
// ---------------------------------------------------------------------------------------------------------------
const FOLK_CELL = 500;
const SHORE_WAKE = ['Hey! Idle speed along the bank!', 'You are putting the fish down!', 'Slow it down, son!', 'Real nice. Real nice.'];
export class Folk {
  constructor(terrain, scene, fx) { this.T = terrain; this.scene = scene; this.fx = fx; this.cells = new Map(); this.live = new Map(); this.checkT = 0; this.activity = 1; this.cacheEvictions = 0; this.disposedLineGeometries = 0; }
  at(ci, cj) {
    const key = `${ci},${cj}`; if (this.cells.has(key)) return this.cells.get(key);
    let f = null; const cx = ci * FOLK_CELL, cz = cj * FOLK_CELL;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF - 700 && homeDist(cx, cz) > 450) {
      const rr = mulberry32(hash2(ci + 313, cj + 271) ^ 0x2b7e);
      if (rr() < 0.4) { const hf = this.T.hf; for (let t = 0; t < 30 && !f; t++) {
        const x = cx + rr() * FOLK_CELL, z = cz + rr() * FOLK_CELL;
        const h = hf.compute(x, z); if (h < 0.6 || h > 1.3) continue;
        for (let a0 = rr() * 6.28, k = 0; k < 8; k++) { const a = a0 + k * Math.PI / 4; const wx = x + Math.cos(a) * 5, wz = z + Math.sin(a) * 5; if (hf.compute(wx, wz) < -0.9 && hf.computeBase(wx, wz).s > 0.5 && hf.compute(x + Math.cos(a) * 2, z + Math.sin(a) * 2) > -0.4) { f = { key, x, z, h, ang: a, seed: rr() * 1e9 | 0, two: rr() < 0.5, said: 0 }; break; } }
      } }
    }
    this.cells.set(key, f); this.cacheEvictions += trimOldest(this.cells, FOLK_CACHE_LIMIT, this.live); return f;
  }
  near(x, z, r) { const out = [], C = FOLK_CELL; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const f = this.at(i, j); if (f && Math.hypot(f.x - x, f.z - z) <= r) out.push(f); } return out; }
  build(f) {
    const rr = mulberry32(f.seed); const g = new THREE.Group(); g.userData.people = []; g.userData.site = f;
    const face = Math.atan2(Math.cos(f.ang), Math.sin(f.ang)); const px = -Math.sin(f.ang), pz = Math.cos(f.ang); // along the bank
    const p = person(rr, { pose: 'stand', rod: true, waders: rr() < 0.35 }); p.position.set(f.x, f.h, f.z); p.rotation.y = face; g.add(p); g.userData.people.push(p);
    // a stretch of bank to wander along: step both ways while the ground stays a dry, gentle bank
    let a = 0, b = 0; const hf = this.T.hf; for (let k = 1; k <= 8; k++) { const hh = hf.compute(f.x + px * k, f.z + pz * k); if (hh < 0.45 || hh > 1.6) break; b = k; } for (let k = 1; k <= 8; k++) { const hh = hf.compute(f.x - px * k, f.z - pz * k); if (hh < 0.45 || hh > 1.6) break; a = k; }
    if (a + b >= 3) walkAlong(p, f.x - px * a, f.z - pz * a, f.x + px * b, f.z + pz * b);
    const bk = bucket(); bk.position.set(f.x + px * 0.7, this.T.heightAt(f.x + px * 0.7, f.z + pz * 0.7), f.z + pz * 0.7); g.add(bk);
    const cl = cooler(rr); const cx = f.x - px * 1.6, cz = f.z - pz * 1.6; cl.position.set(cx, this.T.heightAt(cx, cz), cz); cl.rotation.y = face; g.add(cl);
    if (f.two) { const q = person(rr, { pose: 'sit', rod: rr() < 0.5 }); q.position.copy(cl.position); q.rotation.y = face + (rr() - 0.5) * 0.4; g.add(q); g.userData.people.push(q); pair(p, q); }
    for (const pp of g.userData.people) if (pp.userData.rod) { const ln = fishingLine(); ln.visible = false; g.add(ln); pp.userData.line = ln; pp.userData.lineTarget = new THREE.Vector3(); pp.userData.castCd = 2 + rr() * 10; }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  release(g) {
    g.removeFromParent(); const geometries = new Set();
    for (const pp of g.userData.people || []) if (pp.userData.line?.geometry) geometries.add(pp.userData.line.geometry);
    for (const geometry of geometries) geometry.dispose();
    this.disposedLineGeometries += geometries.size;
  }
  update(dt, t, ctx) {
    const bx = ctx.bx, bz = ctx.bz;
    if (this.activity <= 0.2) {
      for (const [key, { f, g }] of this.live) {
        if (Math.hypot(f.x - bx, f.z - bz) > 480) { this.release(g); this.live.delete(key); } else g.visible = false;
      }
      return;
    }
    for (const { g } of this.live.values()) g.visible = true;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.6;
      for (const f of this.near(bx, bz, 400)) if (!this.live.has(f.key)) { const g = this.build(f); this.scene.add(g); this.live.set(f.key, { f, g }); }
      for (const [key, l] of this.live) if (Math.hypot(l.f.x - bx, l.f.z - bz) > 480) { this.release(l.g); this.live.delete(key); }
    }
    for (const { f, g } of this.live.values()) {
      animateSite(g, t, this.fx.waveFn, null, ctx);
      const d = Math.hypot(f.x - bx, f.z - bz);
      if (d < 16 && f.said === 0 && ctx.speed * 2.23694 > 9) { f.said = 1; this.fx.game.anglerSay(f, SHORE_WAKE[Math.floor(Math.random() * SHORE_WAKE.length)], true); }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class Life {
  constructor(o) { // { terrain, scene, water, camera, phys, plume, spray, audio, waveFn, game }
    this.stampPool = new WakeStampPool(32);
    this.emitStamp = (x, z, radius, height, foam, foamRadius) => this.stampPool.emit(x, z, radius, height, foam, foamRadius);
    const fx = { plume: o.plume, spray: o.spray, audio: o.audio, waterScene: o.water?.scene, camera: o.camera, waveFn: o.waveFn, emitStamp: this.emitStamp, game: o.game };
    this.fish = new Fish(o.terrain, o.scene, fx);
    this.debris = new Debris(o.terrain, o.scene, o.phys);
    this.traffic = new Traffic(o.terrain, o.scene, o.phys, fx);
    this.folk = new Folk(o.terrain, o.scene, fx);
    this.audio = o.audio; this.waveFn = o.waveFn; this.phys = o.phys; this.fx = fx;
    this.context = { bx: 0, bz: 0, speed: 0, dt: 0, emitStamp: this.emitStamp, plume: o.plume, spray: o.spray, audio: o.audio, fish: this.fish, ob: 0, truck: 0, heightAt: (x, z) => o.terrain.heightAt(x, z) };
    this.obLevel = 0; this.obPitch = 1;
  }
  update(dt, t) {
    this.stampPool.reset();
    this.fish.update(dt, t, this.phys);
    this.debris.update(dt, t, this.phys, this.waveFn, this.audio, this.currents);
    this.traffic.update(dt, t, this.fish);
    const ctx = this.context; ctx.bx = this.phys.pos.x; ctx.bz = this.phys.pos.y; ctx.speed = this.phys.speed; ctx.dt = dt; ctx.ob = 0; ctx.truck = 0;
    this.folk.update(dt, t, ctx);
    this.obLevel = this.traffic.obLevel; this.obPitch = this.traffic.obPitch;
  }
  stamps(out) { this.stampPool.appendTo(out); }
}
