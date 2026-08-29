import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { shack, crabFloat, fuelDrum } from './markers.js';
import { buildDock } from './tower.js';
import { buildSkiff } from './npc.js';
import { HOME_X, HOME_Z, WORLD_HALF } from './heightfield.js';
import { SITE_CELL, pickSite, buildSite, animateSite, wideHere } from './sites.js';
import { person, cooler, bucket, fishingLine } from './folk.js';
import { spawn } from './models.js';
import { trimOldest } from './cache.js';

// The things scattered through the endless bayou: fish camps on the channel banks (one per ~1.6 km cell, seeded, so
// they are the same for everyone every time) and lost crab-trap floats drifting in the back pools. Everything is
// generated from the cell seed on demand and only built as meshes when the boat is near.
const CAMP_CELL = 1600, TRAP_CELL = 700;
const CAMP_CACHE_LIMIT = 160, SITE_CACHE_LIMIT = 384, TRAP_CACHE_LIMIT = 256;
const FIRST = ['Turner', 'Cooter', 'Mullet', 'Lostman', 'Chokoloskee', 'Sawgrass', 'Gator Hole', 'Possum', 'Broad River', 'Hell\'s Bay', 'Whitewater', 'Shark Point', 'Tarpon', 'Buzzard', 'Cane Patch', 'Rookery', 'Onion Key', 'Lopez', 'Watson', 'Panther', 'Kingfisher', 'Snake Bight', 'Cormorant', 'Moss Hammock', 'Cypress Knee', 'Otter', 'Bream Hole', 'Halfway', 'Ten Mile', 'Dead River'];
const SECOND = ['Camp', 'Landing', 'Fish Camp', 'Station', 'Bend', 'Dock', 'Camp', 'Landing'];
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

// Removing an Object3D does not release its WebGL buffers. Release geometry only when no retained render tree uses
// it; pooled CPU objects remain reusable and Three.js can upload them again. Per-site mutable materials opt in below.
export function disposeDetachedGeometries(root, ...retainedRoots) {
  const retained = new Set(), retainedMaterials = new Set(), disposed = new Set(), disposedMaterials = new Set();
  const addMaterials = (value, set) => { if (Array.isArray(value)) for (const material of value) material && set.add(material); else if (value) set.add(value); };
  for (const retainedRoot of retainedRoots) retainedRoot?.traverse?.(o => { if (o.geometry) retained.add(o.geometry); addMaterials(o.material, retainedMaterials); });
  root?.traverse?.(o => {
    const geometry = o.geometry;
    if (geometry && !retained.has(geometry) && !disposed.has(geometry)) { disposed.add(geometry); geometry.dispose(); }
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of materials) {
      if (!material?.userData?.streamOwned || retainedMaterials.has(material) || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material); material.dispose();
    }
  });
  return disposed.size;
}

export class World {
  constructor(terrain, scene, waveFn) {
    this.T = terrain; this.scene = scene; this.waveFn = waveFn;
    this.campCells = new Map(); this.trapCells = new Map(); this.siteCells = new Map();
    this.liveCamps = new Map(); this.liveTraps = new Map(); this.liveSites = new Map();
    this.cellCacheEvictions = { camps: 0, sites: 0, traps: 0 };
    this.checkT = 0; this.collected = new Set(); this.phys = null; this.wind = null;
    this.fx = null; // { plume, spray, audio, fish, playerWakeAt } from main
    this.stampList = []; this.obLevel = 0; this.truckLevel = 0; this.onShot = null;
    this.disposedGeometries = 0;
  }
  releaseGeometry(root) { const n = disposeDetachedGeometries(root, this.scene); this.disposedGeometries += n; return n; }
  // ---- camps ----
  campAt(ci, cj) {
    const key = `${ci},${cj}`;
    if (this.campCells.has(key)) return this.campCells.get(key);
    let camp = null;
    const cx = ci * CAMP_CELL, cz = cj * CAMP_CELL;
    if (Math.max(Math.abs(cx + CAMP_CELL / 2), Math.abs(cz + CAMP_CELL / 2)) < WORLD_HALF - 900 && Math.hypot(cx + CAMP_CELL / 2 - HOME_X, cz + CAMP_CELL / 2 - HOME_Z) > 1100) {
      const rr = mulberry32(hash2(ci + 331, cj + 977) ^ 0xa5f1);
      if (rr() < 0.78) {
        const hf = this.T.hf;
        for (let t = 0; t < 60 && !camp; t++) {
          const x = cx + 200 + rr() * (CAMP_CELL - 400), z = cz + 200 + rr() * (CAMP_CELL - 400);
          if (Math.hypot(x - HOME_X, z - HOME_Z) < 1100) continue;
          const c = hf.computeBase(x, z);
          if (c.s < 0.92 || c.lake > 0.4 || c.h > -2.2) continue; // deep channel water
          // the bank: a direction along which the ground comes up to a low shelf 20-30 m away
          for (let a0 = rr() * 6.28, k = 0; k < 8 && !camp; k++) {
            const a = a0 + k * Math.PI / 4;
            let bank = null;
            if (!wideHere(hf, x, z, a)) continue;
            for (let r = 14; r <= 34; r += 4) { const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r; const h = hf.compute(bx, bz); if (h > 0.45 && h < 1.6) { bank = { x: bx, z: bz, h, r }; break; } if (h > 1.6) break; }
            if (!bank) continue;
            // a little further in for the shack, on ground not much higher
            const sx = x + Math.cos(a) * (bank.r + 7), sz = z + Math.sin(a) * (bank.r + 7); const sh = hf.compute(sx, sz);
            if (sh < 0.4 || sh > 2.4) continue;
            const name = `${FIRST[Math.floor(rr() * FIRST.length)]} ${SECOND[Math.floor(rr() * SECOND.length)]}`;
            camp = { key, name, x: sx, z: sz, h: sh, tie: { x: x + Math.cos(a) * (bank.r - 9), z: z + Math.sin(a) * (bank.r - 9) }, bank, ang: a, seed: hash2(ci, cj) };
          }
        }
      }
    }
    this.campCells.set(key, camp);
    this.cellCacheEvictions.camps += trimOldest(this.campCells, CAMP_CACHE_LIMIT, this.liveCamps);
    return camp;
  }
  campsNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / CAMP_CELL), i1 = Math.floor((x + r) / CAMP_CELL), j0 = Math.floor((z - r) / CAMP_CELL), j1 = Math.floor((z + r) / CAMP_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = this.campAt(i, j); if (c && Math.hypot(c.x - x, c.z - z) <= r) out.push(c); }
    return out;
  }
  nearestCamp(x, z, r = 6000) {
    let best = null, bd = 1e9;
    for (const c of this.campsNear(x, z, r)) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
    return best ? { camp: best, d: bd } : null;
  }
  buildCamp(c) {
    const g = new THREE.Group(); g.name = 'camp';
    const T = this.T;
    const sh = shack(); sh.position.set(c.x, c.h - 0.3, c.z); sh.rotation.y = c.ang + Math.PI / 2; g.add(sh);
    // dock from the bank out over the water toward the tie-up
    const dock = buildDock(14, 1.8);
    const dx = c.tie.x - c.bank.x, dz = c.tie.z - c.bank.z; const l = Math.hypot(dx, dz);
    dock.position.set(c.bank.x, 0, c.bank.z); dock.rotation.y = Math.atan2(dx / l, dz / l) + Math.PI; g.add(dock);
    const rr = mulberry32(c.seed);
    // moored johnboat alongside, drums and traps on the bank
    const skiff = buildSkiff({ crew: false }); const side = rr() < 0.5 ? -1 : 1;
    const sx = c.bank.x + dx / l * 9 + (-dz / l) * side * 2.4, sz = c.bank.z + dz / l * 9 + (dx / l) * side * 2.4;
    skiff.position.set(sx, -0.05, sz); skiff.rotation.y = Math.atan2(dx / l, dz / l) + (rr() - 0.5) * 0.4; skiff.rotation.order = 'YXZ'; g.add(skiff); g.userData.skiff = skiff; g.userData.skiffWater = { x: sx, z: sz, heading: skiff.rotation.y };
    for (let i = 0; i < 2 + Math.floor(rr() * 3); i++) { const d = fuelDrum(); const a = c.ang + (rr() - 0.5) * 1.6, r = 4 + rr() * 5; const px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r; d.position.set(px, T.heightAt(px, pz) - 0.05, pz); d.rotation.y = rr() * 6; g.add(d); }
    for (let i = 0; i < 3; i++) { const f = crabFloat(); const a = rr() * 6.28, r = 2 + rr() * 3; const px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r; f.position.set(px, T.heightAt(px, pz) + 0.1, pz); f.rotation.z = 1.2; f.rotation.y = rr() * 6; g.add(f); }
    // a hero tree over the shack
    if (rr() < 0.7) { const a = c.ang + (rr() - 0.5) * 1.0; const px = c.x + Math.cos(a) * (7 + rr() * 3), pz = c.z + Math.sin(a) * (7 + rr() * 3); const tr = spawn('tree_c'); tr.position.set(px, T.heightAt(px, pz) - 0.1, pz); tr.rotation.y = rr() * 6.28; tr.scale.setScalar(0.8 + rr() * 0.4); g.add(tr); }
    // the camp's people: somebody fishing off the dock, somebody at the shack sorting gear
    g.userData.people = []; g.userData.site = c;
    if (rr() < 0.6) { const p = person(rr, { pose: 'sitEdge', rod: true }); p.position.set(0.72, 0.81, -12.6); p.rotation.y = Math.PI / 2; dock.add(p); g.userData.people.push(p); const bk = bucket(); bk.position.set(-0.4, 0.81, -12.0); dock.add(bk); }
    if (rr() < 0.5) { const p = person(rr, { pose: 'crouch' }); const a = c.ang + Math.PI + (rr() - 0.5) * 1.2; const px = c.x + Math.cos(a) * 4.5, pz = c.z + Math.sin(a) * 4.5; p.position.set(px, T.heightAt(px, pz), pz); p.rotation.y = a + Math.PI / 2; g.add(p); g.userData.people.push(p); const cl = cooler(rr); cl.position.set(px + 0.8, T.heightAt(px + 0.8, pz), pz); g.add(cl); }
    for (const p of g.userData.people) if (p.userData.rod) { const ln = fishingLine(); ln.visible = false; g.add(ln); p.userData.line = ln; p.userData.lineTarget = new THREE.Vector3(); p.userData.castCd = 3 + rr() * 12; }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  // ---- homesteads, ramps, boathouses, blinds ----
  siteAt(ci, cj) {
    const key = `${ci},${cj}`;
    if (this.siteCells.has(key)) return this.siteCells.get(key);
    let site = null;
    const cx = ci * SITE_CELL, cz = cj * SITE_CELL;
    if (Math.max(Math.abs(cx + SITE_CELL / 2), Math.abs(cz + SITE_CELL / 2)) < WORLD_HALF - 900) {
      const rr = mulberry32(hash2(ci + 4001, cj + 61) ^ 0x9e37);
      if (rr() < 0.42) site = pickSite(this.T.hf, key, cx, cz, rr, (x, z) => Math.hypot(x - HOME_X, z - HOME_Z));
    }
    // keep clear of a camp in the same cell
    if (site) for (const c of this.campsNear(site.x, site.z, 120)) if (c) { site = null; break; }
    this.siteCells.set(key, site);
    this.cellCacheEvictions.sites += trimOldest(this.siteCells, SITE_CACHE_LIMIT, this.liveSites);
    return site;
  }
  sitesNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / SITE_CELL), i1 = Math.floor((x + r) / SITE_CELL), j0 = Math.floor((z - r) / SITE_CELL), j1 = Math.floor((z + r) / SITE_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const st = this.siteAt(i, j); if (st && Math.hypot(st.x - x, st.z - z) <= r) out.push(st); }
    return out;
  }
  // ground the vegetation must leave alone: around every camp and homestead
  blockedAt(x, z) {
    for (const st of this.sitesNear(x, z, 30)) { const r = st.kind === 'house' ? 16 : st.kind === 'ramp' ? 22 : 9; if (Math.hypot(st.x - x, st.z - z) < r) return true; if (st.kind === 'house' && Math.hypot(st.bank.x - x, st.bank.z - z) < 8) return true; if (st.kind === 'ramp') { const ux = -Math.cos(st.ang), uz = -Math.sin(st.ang); const px = st.x + ux * 14, pz = st.z + uz * 14; if (Math.hypot(px - x, pz - z) < 12) return true; } }
    for (const c of this.campsNear(x, z, 30)) { if (Math.hypot(c.x - x, c.z - z) < 12 || Math.hypot(c.bank.x - x, c.bank.z - z) < 7) return true; }
    return false;
  }
  campColliders(c) {
    const dx = c.tie.x - c.bank.x, dz = c.tie.z - c.bank.z, l = Math.hypot(dx, dz) || 1;
    return [{ ax: c.bank.x, az: c.bank.z, bx: c.bank.x + dx / l * 14, bz: c.bank.z + dz / l * 14, r: 1.1, tag: 'dock' }, { x: c.x, z: c.z, r: 2.6, tag: 'house' }];
  }
  // ---- lost traps ----
  trapAt(ci, cj) {
    const key = `${ci},${cj}`;
    if (this.trapCells.has(key)) return this.trapCells.get(key);
    let trap = null;
    const cx = ci * TRAP_CELL, cz = cj * TRAP_CELL;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF - 700) {
      const rr = mulberry32(hash2(ci + 71, cj + 913) ^ 0x3c6e);
      if (rr() < 0.6) {
        const hf = this.T.hf;
        for (let t = 0; t < 30 && !trap; t++) {
          const x = cx + rr() * TRAP_CELL, z = cz + rr() * TRAP_CELL;
          const h = hf.compute(x, z); if (h < -2.4 || h > -0.5) continue; // back pools and shallows, off the main channels
          trap = { key, x, z, ph: rr() * 6 };
        }
      }
    }
    this.trapCells.set(key, trap);
    this.cellCacheEvictions.traps += trimOldest(this.trapCells, TRAP_CACHE_LIMIT, this.liveTraps);
    return trap;
  }
  trapsNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / TRAP_CELL), i1 = Math.floor((x + r) / TRAP_CELL), j0 = Math.floor((z - r) / TRAP_CELL), j1 = Math.floor((z + r) / TRAP_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const tr = this.trapAt(i, j); if (tr && !this.collected.has(tr.key) && Math.hypot(tr.x - x, tr.z - z) <= r) out.push(tr); }
    return out;
  }
  stamps(out) { for (const s of this.stampList) out.push(s); }
  collectTrap(tr) {
    this.collected.add(tr.key);
    const live = this.liveTraps.get(tr.key); if (live) { this.scene.remove(live); this.releaseGeometry(live); this.liveTraps.delete(tr.key); }
  }

  // ---- streaming ----
  update(dt, t, bx, bz) {
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      const camps = this.campsNear(bx, bz, 1500);
      for (const c of camps) if (!this.liveCamps.has(c.key)) { const g = this.buildCamp(c); this.scene.add(g); this.liveCamps.set(c.key, g); if (this.phys) this.phys.addObs('camp:' + c.key, this.campColliders(c)); }
      for (const [key, g] of this.liveCamps) { const c = this.campCells.get(key); if (Math.hypot(c.x - bx, c.z - bz) > 1800) { this.scene.remove(g); this.releaseGeometry(g); this.liveCamps.delete(key); if (this.phys) this.phys.removeObs('camp:' + key); } }
      for (const st of this.sitesNear(bx, bz, 1200)) if (!this.liveSites.has(st.key)) { const g = buildSite(st, this.T); this.scene.add(g); this.liveSites.set(st.key, { site: st, g }); if (this.phys && st.colliders) this.phys.addObs('site:' + st.key, st.colliders); }
      for (const [key, l] of this.liveSites) if (Math.hypot(l.site.x - bx, l.site.z - bz) > 1450) { this.scene.remove(l.g); this.releaseGeometry(l.g); this.liveSites.delete(key); if (this.phys) this.phys.removeObs('site:' + key); }
      const traps = this.trapsNear(bx, bz, 500);
      for (const tr of traps) if (!this.liveTraps.has(tr.key)) { const m = crabFloat(); m.position.set(tr.x, 0, tr.z); this.scene.add(m); this.liveTraps.set(tr.key, m); }
      for (const [key, m] of this.liveTraps) { const tr = this.trapCells.get(key); if (Math.hypot(tr.x - bx, tr.z - bz) > 620) { this.scene.remove(m); this.releaseGeometry(m); this.liveTraps.delete(key); } }
    }
    for (const [key, m] of this.liveTraps) { const tr = this.trapCells.get(key); m.position.y = this.waveFn(tr.x, tr.z, t) - 0.12; m.rotation.z = Math.sin(t * 1.3 + tr.ph) * 0.12; m.rotation.x = Math.cos(t * 0.9 + tr.ph) * 0.1; }
    this.stampList.length = 0;
    const P = this.phys; const fx = this.fx || {};
    const ctx = { bx, bz, speed: P ? P.speed : 0, dt, stamps: this.stampList, plume: fx.plume, spray: fx.spray, audio: fx.audio, fish: fx.fish, playerWakeAt: fx.playerWakeAt, ob: 0, truck: 0, onShot: this.onShot, humanActivity: this.humanActivity ?? 1, heightAt: (x, z) => this.T.heightAt(x, z) };
    for (const g of this.liveCamps.values()) animateSite(g, t, this.waveFn, this.wind, ctx);
    for (const l of this.liveSites.values()) animateSite(l.g, t, this.waveFn, this.wind, ctx);
    this.obLevel = ctx.ob; this.truckLevel = ctx.truck;
  }
}
