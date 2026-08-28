import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { buildSkiff } from './npc.js';
import { buildAirboat, loadDriver } from './airboat.js';
import { HOME_X, HOME_Z, WORLD_HALF } from './heightfield.js';
import * as TEX from './textures.js';
import { spawn, loadGeo, SPEC } from './models.js';
import { person, animatePerson, pair, walkAlong, canoe, paddleAnim, cooler, bucket, fishingLine } from './folk.js';
import { animateSite } from './sites.js';

// The bayou's small life: mullet jumping, bait boiling away from the bow, deadhead logs and dead snags in the still
// water (with an anhinga drying its wings), other boats running the channels, and anglers anchored in the pools who
// have opinions about your wake.

const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const jitter = () => Math.random() - 0.5;
const homeDist = (x, z) => Math.hypot(x - HOME_X, z - HOME_Z);

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
    this.T = terrain; this.fx = fx; // fx: { plume, spray, audio, stamps }
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4dbd6, roughness: 0.3, metalness: 0.6 });
    this.n = 48; this.mesh = new THREE.InstancedMesh(fishGeo(), mat, this.n); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.list = []; for (let i = 0; i < this.n; i++) this.list.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, s: 1, hops: 0, roll: 0 });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) { this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
    scene.add(this.mesh);
    this.nextT = 1; this.boilT = 0; this.activity = 1;
    loadGeo('fish_a').then(r => { if (r) { this.mesh.geometry = r.geo; this.mesh.material = r.mat; } });
  }
  free() { for (const f of this.list) if (!f.on) return f; return null; }
  launch(x, z, vy, vx, vz, s = 1, hops = 0, quiet = false) {
    const f = this.free(); if (!f) return null;
    Object.assign(f, { on: true, x, y: -0.15, z, vx, vy, vz, t: 0, s, hops, roll: (Math.random() - 0.5) * 2.4 });
    if (!quiet) this.splash(x, z, 0.45 * s);
    return f;
  }
  splash(x, z, k, bx, bz) {
    const { plume, spray, audio, stamps } = this.fx;
    const n = Math.floor(3 + 4 * k);
    for (let i = 0; i < n; i++) plume.emit(x + jitter() * 0.3, 0.05, z + jitter() * 0.3, jitter() * 1.2 * k, 0.8 + Math.random() * 1.6 * k, jitter() * 1.2 * k, 0.1 + Math.random() * 0.12 * k, 0.9, 0.45 + Math.random() * 0.3, 0.3);
    for (let i = 0; i < n * 4; i++) spray.emit(x + jitter() * 0.3, 0.03, z + jitter() * 0.3, jitter() * 2.2 * k, 0.8 + Math.random() * 2.4 * k, jitter() * 2.2 * k, 0.012 + Math.random() * 0.02, 0.35 + Math.random() * 0.3, 0.6);
    stamps.push({ x, z, radius: 0.45 + k * 0.3, height: -0.3 * k, foam: 0.9 * k, foamRadius: 0.5 + k * 0.3 });
    if (bx !== undefined) { const d = Math.hypot(x - bx, z - bz); audio.plip(Math.min(0.45, 0.6 * k) * Math.max(0, 1 - d / 70)); }
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
function anhinga() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), black); body.scale.set(1, 0.9, 1.9); body.position.y = 0.2; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 6), black); neck.position.set(0, 0.5, -0.1); neck.rotation.x = 0.3; g.add(neck);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 6), black); head.rotation.x = -Math.PI / 2 + 0.5; head.position.set(0, 0.76, -0.25); g.add(head);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.3, 4, 1), black); w.position.set(sx * 0.36, 0.3, 0.02); w.rotation.z = sx * 0.35; w.rotation.y = sx * 0.1; g.add(w); }
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.34), black); tail.rotation.x = -1.2; tail.position.set(0, 0.16, 0.36); g.add(tail);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export class Debris {
  constructor(terrain, scene, phys) {
    this.T = terrain; this.scene = scene; this.phys = phys;
    this.cells = new Map(); this.live = new Map(); this.checkT = 0;
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
    this.cells.set(key, out); return out;
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
          if (tt.st === 0) { if (dist < 24 && (phys.speed > 1.5 || dist < 9)) { tt.st = 1; tt.t = 0; if (audio) audio.plip(0.25 * Math.max(0, 1 - dist / 30)); this.spooked++; } else tt.m.position.y = tt.home.y + Math.sin(t * 0.9 + tt.home.z) * 0.004; }
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
          if (dist < 30 && phys.speed > 2.5) { d.fly = 4; this.spooked++; if (audio) audio.squawk(0.15); }
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
function recolor(group, from, to) { group.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === from) { o.material = o.material.clone(); o.material.color.setHex(to); } }); }
function fisherman(rr) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: [0xd8d2c0, 0x3b5f8a, 0x8a3b2f, 0x6b7a4a][Math.floor(rr() * 4)], roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 8), shirt); torso.position.y = 0.42; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skin); head.position.y = 0.82; g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 0.9 })); hat.position.y = 0.9; g.add(hat);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 10), hat.material); crown.position.y = 0.96; g.add(crown);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 6), new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9 })); leg.position.set(sx * 0.1, 0.12, -0.15); leg.rotation.x = -1.1; g.add(leg); }
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.35, 4, 6), skin); arm.position.set(0.22, 0.5, -0.15); arm.rotation.x = -1.1; arm.rotation.z = -0.5; g.add(arm);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 })); rod.position.set(0.32, 0.9, -0.9); rod.rotation.x = -1.0; rod.rotation.z = -0.15; g.add(rod); g.userData.rod = rod;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export class Traffic {
  constructor(terrain, scene, phys, fx) {
    this.T = terrain; this.scene = scene; this.phys = phys; this.fx = fx; // { plume, spray, audio, waveFn, stamps, game }
    this.rand = mulberry32(4242);
    this.boats = [];
    const john = (hull) => { const m = buildSkiff({ crew: true }); if (hull) recolor(m, 0x6f7570, hull); return { kind: 'john', mesh: m, max: 6.5 + this.rand() * 2.5 }; };
    const air = (hull) => { const b = buildAirboat(); recolor(b.group, 0xd8dcda, hull); loadDriver(b.group).catch(() => {}); return { kind: 'air', mesh: b.group, prop: b.prop, blur: b.blur, rudders: b.rudders, max: 10.5 + this.rand() * 2.5 }; };
    const cruiser = () => { const m = spawn('boat_dreams'); const rr = this.rand; const d = person(rr, { pose: 'sit', hat: true, drive: true }); d.position.set(0.45, 0.95, 0.3); d.rotation.y = Math.PI; m.add(d); const pas = person(rr, { pose: 'sit', hat: false, vest: true }); pas.position.set(-0.45, 0.95, 0.3); pas.rotation.y = Math.PI; m.add(pas); pair(d, pas); return { kind: 'cruiser', mesh: m, max: 8.5 + rr() * 2, people: [d, pas] }; };
    const skiff = () => { const m = spawn('beau_boat'); const rr = this.rand; const d = person(rr, { pose: 'sit', hat: true, drive: true }); d.position.set(0, 0.32, 0.7); d.rotation.y = Math.PI; m.add(d); return { kind: 'skiff', mesh: m, max: 5 + rr() * 1.5, people: [d] }; };
    const paddlers = () => ({ kind: 'canoe', mesh: canoe(this.rand), max: 1.3 + this.rand() * 0.4 });
    for (const b of [john(0), john(0x4c6b4a), cruiser(), skiff(), air(0xc94a2b), air(0x2f6e9e), paddlers()]) {
      Object.assign(b, { x: 1e9, z: 1e9, heading: 0, speed: 0, turn: 0, roll: 0, pitch: 0, hornT: 0, yellT: 0, ground: 0, shx: 0, shz: 0 });
      b.mesh.visible = false; scene.add(b.mesh); this.boats.push(b);
      b.obs = { tag: 'boat', r: b.kind === 'air' ? 1.35 : b.kind === 'cruiser' ? 1.3 : b.kind === 'canoe' ? 0.5 : 1.1, boat: b, onHit: (into, nx, nz) => { b.shx += -nx * into * 0.5; b.shz += -nz * into * 0.5; b.speed *= 0.5; if (b.yellT <= 0 && into > 2.5) { b.yellT = 8; fx.game.boatHit(b, into); } } };
    }
    this.obs = []; phys.addObs('traffic', this.obs);
    this.activity = 1; this.anglerActivity = 1;
    // anchored anglers
    this.anglerCells = new Map(); this.liveAnglers = new Map(); this.checkT = 0;
    this.idlePasses = 0; this._flow = new THREE.Vector2();
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
      b.x = x; b.z = z; b.heading = best; b.speed = b.max * 0.6; b.mesh.visible = true; b.ground = 0; return true;
    }
    return false;
  }
  // ---- anglers ----
  anglerAt(ci, cj) {
    const key = `${ci},${cj}`; if (this.anglerCells.has(key)) return this.anglerCells.get(key);
    let ang = null; const C = 600, cx = ci * C, cz = cj * C;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF - 700 && homeDist(cx, cz) > 650) {
      const rr = mulberry32(hash2(ci + 909, cj + 77) ^ 0x51ac);
      if (rr() < 0.4) { const hf = this.T.hf; for (let t = 0; t < 20; t++) { const x = cx + rr() * C, z = cz + rr() * C; const h = hf.compute(x, z); if (h > -1.1 || h < -3.2) continue; ang = { key, x, z, heading: rr() * 6.283, seed: rr() * 1e9 | 0, ph: rr() * 6, said: 0, biteT: 8 + rr() * 20 }; break; } }
    }
    this.anglerCells.set(key, ang); return ang;
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
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0xd9d4c4 })); line.position.set(0, -0.4, -2.6); line.rotation.x = 0.5; g.add(line);
    const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 })); cooler.position.set(-0.4, 0.3, -0.8); g.add(cooler);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe2552a })); bob.position.set(1.6, 0, -3.6); g.add(bob); g.userData.bob = bob;
    g.position.set(a.x, 0, a.z); g.rotation.y = a.heading;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    a.obs = { ax: a.x - Math.sin(a.heading) * 2, az: a.z - Math.cos(a.heading) * 2, bx: a.x + Math.sin(a.heading) * 2, bz: a.z + Math.cos(a.heading) * 2, r: 1.1, tag: 'angler', angler: a, onHit: (into) => { if (into > 2 && a.said !== 2) { a.said = 2; this.fx.game.anglerSay(a, YELLS[Math.floor(Math.random() * YELLS.length)]); } } };
    return g;
  }
  update(dt, t, fish) {
    const P = this.phys, bx = P.pos.x, bz = P.pos.y, hf = this.T.hf, waveFn = this.fx.waveFn;
    const pf = P.forward();
    this.obs.length = 0; let ob = 0, obp = 1;
    const activeBoats = Math.round(this.boats.length * this.activity);
    for (let bi = 0; bi < this.boats.length; bi++) {
      const b = this.boats[bi];
      if (bi >= activeBoats) { b.mesh.visible = false; b.x = b.z = 1e9; continue; }
      const d = Math.hypot(b.x - bx, b.z - bz);
      if (d > 950 || b.ground > 3) { if (!this.spawnSpot(b)) { b.mesh.visible = false; b.x = 1e9; continue; } }
      b.mesh.visible = true;
      // steer: probe five headings 24 m out and prefer deep water straight ahead; back off from the player and each other
      let best = 0, bs = -1e9;
      for (const da of [-0.7, -0.35, 0, 0.35, 0.7]) {
        const h = b.heading + da; const px = b.x - Math.sin(h) * 24, pz = b.z - Math.cos(h) * 24; const px2 = b.x - Math.sin(h) * 48, pz2 = b.z - Math.cos(h) * 48;
        let sc = Math.min(4, -this.T.heightAt(px, pz)) + Math.min(4, -this.T.heightAt(px2, pz2)) * 0.6 - Math.abs(da) * 0.9;
        const dp = Math.hypot(px - bx, pz - bz); if (dp < 22) sc -= (22 - dp) * 0.5;
        for (const o of this.boats) if (o !== b && o.x < 1e8) { const dd = Math.hypot(px - o.x, pz - o.z); if (dd < 18) sc -= (18 - dd) * 0.4; }
        if (sc > bs) { bs = sc; best = da; }
      }
      const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
      let want = b.max * (bs < 1.5 ? 0.45 : 1); if (d < 30 && (fx * (bx - b.x) + fz * (bz - b.z)) > 0) want *= 0.5; // slow for the player ahead
      b.turn += (best * 2.2 - b.turn) * (1 - Math.exp(-dt * 3)); b.heading += b.turn * dt;
      b.speed += (want - b.speed) * (1 - Math.exp(-dt * 0.7));
      const flow = this.fx.currents ? this.fx.currents.flowAt(b.x, b.z, this._flow) : null;
      b.x += (fx * b.speed + (flow ? flow.x : 0)) * dt + b.shx * dt;
      b.z += (fz * b.speed + (flow ? flow.y : 0)) * dt + b.shz * dt;
      const sk = Math.exp(-dt * 2); b.shx *= sk; b.shz *= sk;
      const gh = this.T.heightAt(b.x, b.z); b.ground = gh > -0.5 ? b.ground + dt : 0; if (gh > -0.5) b.speed *= 0.9;
      const wy = waveFn(b.x, b.z, t);
      b.roll += ((-b.turn * b.speed * 0.02) - b.roll) * (1 - Math.exp(-dt * 4)); b.pitch += ((b.speed * (b.kind === 'air' ? 0.004 : 0.007)) - b.pitch) * (1 - Math.exp(-dt * 3));
      b.mesh.position.set(b.x, wy + (b.kind === 'air' ? -0.27 : b.kind === 'john' || b.kind === 'canoe' ? -0.05 : 0), b.z); b.mesh.rotation.set(b.pitch, b.heading, b.roll, 'YXZ');
      if (b.kind === 'air') { b.prop.rotation.z += dt * (8 + b.speed * 8); b.blur.material.opacity = Math.min(0.35, b.speed / b.max * 0.4); for (const r of b.rudders) r.rotation.y = -b.turn * 0.25; }
      else if (b.kind === 'john') b.mesh.userData.motor.rotation.y = -b.turn * 0.3;
      else if (b.kind === 'canoe') paddleAnim(b.mesh, t, Math.min(1, b.speed / b.max));
      if (b.people && d < 90) for (const pp of b.people) animatePerson(pp, t, dt, null, null);
      // the closest running motor is what you hear
      if (b.kind !== 'air' && b.kind !== 'canoe' && d < 130) { const l = (0.3 + 0.7 * b.speed / b.max) * (1 - d / 130); if (l > ob) { ob = l; obp = b.kind === 'cruiser' ? 0.8 : b.kind === 'skiff' ? 1.25 : 1; } }
      b.yellT = Math.max(0, b.yellT - dt); b.hornT = Math.max(0, b.hornT - dt);
      // horn at a boat coming straight at them
      if (b.kind !== 'canoe' && d < 50 && b.hornT <= 0 && P.speed > 6) { const cx = (b.x - bx) / d, cz = (b.z - bz) / d; if (pf.x * cx + pf.y * cz > 0.9) { b.hornT = 12; this.fx.audio.horn(0.35 * (1 - d / 60)); } }
      if (d < 70) { b.obs.ax = b.x + fx * 2.2; b.obs.az = b.z + fz * 2.2; b.obs.bx = b.x - fx * 2.2; b.obs.bz = b.z - fz * 2.2; this.obs.push(b.obs); }
      // wake and spray
      if (b.kind === 'canoe') { if (d < 60 && b.speed > 0.5) this.fx.stamps.push({ x: b.x, z: b.z, radius: 0.8, height: 0.08, foam: 0.15, foamRadius: 0.5 }); }
      else if (b.speed > 2 && d < 75) {
        const sp = Math.min(1, b.speed / b.max);
        this.fx.stamps.push({ x: b.x - fx * 1.8, z: b.z - fz * 1.8, radius: b.kind === 'air' ? 1.5 : 1.1, height: 0.6 * sp, foam: (b.kind === 'air' ? 2.2 : 1.6) * sp, foamRadius: 1.1 });
        this.fx.stamps.push({ x: b.x + fx * 1.8, z: b.z + fz * 1.8, radius: 1.0, height: -0.7 * sp, foam: 0.1 * sp, foamRadius: 0.7 });
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
      a.biteT -= dt; if (a.biteT <= 0) { a.biteT = 12 + Math.random() * 25; const bp = g.userData.bob.getWorldPosition(new THREE.Vector3()); if (fish) fish.launch(bp.x, bp.z, 2.4, jitter() * 1.5, jitter() * 1.5, 0.8, 1); }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Folk on the banks: bank anglers with a bucket and a cooler, one per ~500 m cell where a channel bank allows it
// ---------------------------------------------------------------------------------------------------------------
const FOLK_CELL = 500;
const SHORE_WAKE = ['Hey! Idle speed along the bank!', 'You are putting the fish down!', 'Slow it down, son!', 'Real nice. Real nice.'];
export class Folk {
  constructor(terrain, scene, fx) { this.T = terrain; this.scene = scene; this.fx = fx; this.cells = new Map(); this.live = new Map(); this.checkT = 0; this.activity = 1; }
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
    this.cells.set(key, f); return f;
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
  update(dt, t, ctx) {
    const bx = ctx.bx, bz = ctx.bz;
    if (this.activity <= 0.2) { for (const { g } of this.live.values()) g.visible = false; return; }
    for (const { g } of this.live.values()) g.visible = true;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.6;
      for (const f of this.near(bx, bz, 400)) if (!this.live.has(f.key)) { const g = this.build(f); this.scene.add(g); this.live.set(f.key, { f, g }); }
      for (const [key, l] of this.live) if (Math.hypot(l.f.x - bx, l.f.z - bz) > 480) { this.scene.remove(l.g); this.live.delete(key); }
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
  constructor(o) { // { terrain, scene, phys, plume, spray, audio, waveFn, game }
    this.stampList = [];
    const fx = { plume: o.plume, spray: o.spray, audio: o.audio, waveFn: o.waveFn, stamps: this.stampList, game: o.game };
    this.fish = new Fish(o.terrain, o.scene, fx);
    this.debris = new Debris(o.terrain, o.scene, o.phys);
    this.traffic = new Traffic(o.terrain, o.scene, o.phys, fx);
    this.folk = new Folk(o.terrain, o.scene, fx);
    this.audio = o.audio; this.waveFn = o.waveFn; this.phys = o.phys; this.fx = fx;
    this.obLevel = 0; this.obPitch = 1;
  }
  update(dt, t) {
    this.stampList.length = 0;
    this.fish.update(dt, t, this.phys);
    this.debris.update(dt, t, this.phys, this.waveFn, this.audio, this.currents);
    this.traffic.update(dt, t, this.fish);
    const ctx = { bx: this.phys.pos.x, bz: this.phys.pos.y, speed: this.phys.speed, dt, stamps: this.stampList, plume: this.fx.plume, spray: this.fx.spray, audio: this.audio, fish: this.fish, ob: 0, truck: 0, heightAt: (x, z) => this.fish.T.heightAt(x, z) };
    this.folk.update(dt, t, ctx);
    this.obLevel = this.traffic.obLevel; this.obPitch = this.traffic.obPitch;
  }
  stamps(out) { for (const s of this.stampList) out.push(s); }
}
