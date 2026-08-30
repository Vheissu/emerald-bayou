import * as THREE from 'three';
import { WorldHeight, WORLD_HALF, HOME_X, HOME_Z } from './heightfield.js';

export { WORLD_HALF, HOME_X, HOME_Z };
export const MAP_SIZE = WORLD_HALF * 2;
export const WATER_LEVEL = 0;

// Streaming terrain: a quadtree of square chunks around the camera. Level 0 chunks are 100 m at 1.56 m sampling;
// larger tiles use progressively cheaper aligned grids out to the 3.2 km horizon tier. Height grids come from a
// pool of workers; the main thread only turns them into geometry. Physics reads the same level-0 grids the renderer
// draws, so the hull sits exactly on what you see.
const ROOT = 3200, LEVELS = 6, FAR = 7200;
// Keep high-resolution shoreline shape close to the boat, then spend vertices according to projected size. The
// world and streaming range do not shrink: distant wetland tiles simply stop retaining a near-field 65x65 grid.
// Powers of two keep every coarser edge sample aligned with the finer ring beside it.
const SEGS_BY_LEVEL = [64, 32, 32, 32, 16, 8];
// how far (in multiples of its size) a node of each level keeps subdividing: the fine rings are tight, the far ones wide
const SPLIT_K = [0, 2.2, 1.8, 1.4, 1.2, 1.0]; // full detail to 440 m, mid to 720 m, trees-only to 1.1 km, sparse to 1.9 km, crossed cards to 3.2 km
const DEFAULT_PREFETCH = 1.35; // children are built this far ahead of the ring reaching them
const DEFAULT_FINALIZE_BUDGET_MS = 4;
const SIZE = (l) => ROOT / (1 << (LEVELS - 1 - l));
const L0 = SIZE(0);

export function normalizeTerrainStreamOptions(options = {}) {
  const prefetch = Number(options.prefetch), finalizeBudgetMs = Number(options.finalizeBudgetMs), workerLimit = Number(options.workerLimit);
  return {
    prefetch: Math.max(1.05, Math.min(1.5, Number.isFinite(prefetch) ? prefetch : DEFAULT_PREFETCH)),
    finalizeBudgetMs: Math.max(0.75, Math.min(6, Number.isFinite(finalizeBudgetMs) ? finalizeBudgetMs : DEFAULT_FINALIZE_BUDGET_MS)),
    workerLimit: Math.max(1, Math.min(4, Math.trunc(Number.isFinite(workerLimit) ? workerLimit : 4))),
  };
}

export function compareTerrainBuildPriority(a, b) {
  const ap = Number.isFinite(a?.prio) ? a.prio : Infinity, bp = Number.isFinite(b?.prio) ? b.prio : Infinity;
  if (ap !== bp) return ap < bp ? -1 : 1;
  const al = Number.isFinite(a?.level) ? a.level : Infinity, bl = Number.isFinite(b?.level) ? b.level : Infinity;
  if (al !== bl) return al < bl ? -1 : 1;
  return 0;
}

export function shouldPreemptTerrainBuild(active, next, paused = null) {
  return !paused && Boolean(active && next) && next.level <= 1 && compareTerrainBuildPriority(next, active) < 0;
}

class WorkerPool {
  constructor(seed, workerLimit = 4) {
    const n = Math.min(workerLimit, 4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
    this.workers = []; this.pending = new Map(); this.id = 0; this.rr = 0; this.inFlight = 0;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      w.postMessage({ kind: 'init', seed });
      w.onmessage = (e) => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); this.inFlight--; p(e.data); } };
      this.workers.push(w);
    }
    this.capacity = n * 2;
  }
  request(msg) {
    return new Promise((resolve) => {
      const id = ++this.id; this.pending.set(id, resolve); this.inFlight++;
      this.workers[this.rr++ % this.workers.length].postMessage({ ...msg, id });
    });
  }
}

class Chunk {
  constructor(level, i, j) {
    this.level = level; this.i = i; this.j = j; this.size = SIZE(level); this.segs = SEGS_BY_LEVEL[level]; this.x0 = i * this.size; this.z0 = j * this.size;
    this.key = `${level}:${i}:${j}`;
    this.h = null; this.nrm = null; this.bio = null; this.mesh = null; this.veg = null; this.colliders = [];
    this.requested = false; this.groundReady = false; this.ready = false; this.used = 0; this.prio = 0; this.build = null;
  }
  sample(x, z, arr = this.h) {
    const n = this.segs, step = this.size / n;
    const fx = (x - this.x0) / step, fz = (z - this.z0) / step;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0) i = 0; else if (i > n - 1) i = n - 1;
    if (j < 0) j = 0; else if (j > n - 1) j = n - 1;
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const w = n + 1, a = arr[j * w + i], b = arr[j * w + i + 1], c = arr[(j + 1) * w + i], d = arr[(j + 1) * w + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
}

export class Terrain {
  constructor(seed = 7, options = {}) {
    const stream = normalizeTerrainStreamOptions(options);
    this.hf = new WorldHeight(seed);
    this.bars = this.hf.bars;
    this.lagoon = new THREE.Vector2(this.hf.lagoon.x, this.hf.lagoon.y);
    this.island = new THREE.Vector2(this.hf.island.x, this.hf.island.y);
    this.pool = new WorkerPool(seed, stream.workerLimit);
    this.prefetch = stream.prefetch;
    this.finalizeBudgetMs = stream.finalizeBudgetMs;
    this.workerLimit = stream.workerLimit;
    this.chunks = new Map();
    this.group = new THREE.Group(); this.group.name = 'terrain';
    this.hooks = { ready: null, done: null, dispose: null };
    this.queue = []; this.finalize = []; this.building = null; this.pausedBuilding = null;
    this.streamT = 0; this.camPos = new THREE.Vector2();
    this.visible = new Set(); this.nextVisible = new Set();
    this.streamNodes = []; this.streamNodeCount = 0;
    this.stats = { chunks: 0, visible: 0, inFlight: 0 };
    this.finalizerTiming = { steps: 0, totalStepMs: 0, maxStepMs: 0, longSteps: 0, lastStepMs: 0 };
    this.indices = new Map();
    this.surfaceWetness = 0; this.surfaceWaterLevel = 0;
  }
  // ---- queries ----
  heightAt(x, z) {
    const c = this.chunks.get(`0:${Math.floor(x / L0)}:${Math.floor(z / L0)}`);
    if (c && c.h) return c.sample(x, z);
    return this.hf.compute(x, z);
  }
  gradAt(x, z, out = new THREE.Vector2()) {
    const e = 1.2;
    return out.set((this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e), (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e));
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  riverCenterX(z) { return this.hf.riverCenterX(z); }
  riverHalfWidth(z) { return this.hf.riverHalfWidth(z); }
  smooth(e0, e1, x) { return this.hf.smooth(e0, e1, x); }
  openness(x, z) { return this.hf.openness(x, z); }
  tile(x0, z0, size, px, style = 'mini') { return this.pool.request({ kind: 'tile', x0, z0, size, px, style }).then(m => m.rgba); }
  onReady(fn) { this.hooks.ready = fn; }
  onDone(fn) { this.hooks.done = fn; }
  onDispose(fn) { this.hooks.dispose = fn; }

  // ---- geometry ----
  indexFor(n) {
    let cached = this.indices.get(n); if (cached) return cached;
    const w = n + 1; const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirt: a ring of vertices dropped below each edge, in order: south (j=0), north (j=n), west (i=0), east (i=n)
    let k = w * w;
    const edge = (vertAt, flip) => {
      for (let t = 0; t < n; t++) {
        const a = vertAt(t), b = vertAt(t + 1), sa = k + t, sb = k + t + 1;
        if (flip) idx.push(a, sa, b, b, sa, sb); else idx.push(a, b, sa, b, sb, sa);
      }
      k += w;
    };
    edge(t => t, false); edge(t => n * w + t, true); edge(t => t * w, true); edge(t => t * w + n, false);
    cached = { index: new THREE.BufferAttribute(new Uint32Array(idx), 1), skirtCount: 4 * w };
    this.indices.set(n, cached);
    return cached;
  }
  buildMesh(tex) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tGrass = { value: tex.grass };
      shader.uniforms.tMud = { value: tex.mud };
      shader.uniforms.tSand = { value: tex.sand };
      shader.uniforms.tNoise = { value: tex.noise };
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uSurfaceWetness = { value: this.surfaceWetness };
      shader.uniforms.uWaterLevel = { value: this.surfaceWaterLevel };
      this.uniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying float vWorldUp;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWorldUp = normalize(mat3(modelMatrix) * normal).y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying float vWorldUp;
          uniform sampler2D tGrass, tMud, tSand, tNoise; uniform float uTime, uSurfaceWetness, uWaterLevel;
          float caustic(vec2 p, float t) {
            float a = texture2D(tNoise, p * 0.55 + vec2(t * 0.021, t * 0.017)).g;
            float b = texture2D(tNoise, p * 0.62 - vec2(t * 0.019, -t * 0.023) + 0.37).b;
            float la = pow(max(0.0, 1.0 - abs(a - 0.5) * 3.2), 3.0);
            float lb = pow(max(0.0, 1.0 - abs(b - 0.5) * 3.2), 3.0);
            return la * lb * 4.0 + (la + lb) * 0.15;
          }`)
        .replace('#include <map_fragment>', `
          vec2 tuv = vWPos.xz;
          float macro = texture2D(tNoise, tuv * 0.0035).r;
          float macro2 = texture2D(tNoise, tuv * 0.011 + 0.5).a;
          vec3 grass = texture2D(tGrass, tuv * 0.09).rgb;
          vec3 grassB = texture2D(tGrass, tuv * 0.023 + 0.31).rgb;
          grass = mix(grass, grassB, 0.45) * mix(0.14, 0.27, macro) * vec3(0.8, 1.0, 0.68);
          grass = mix(grass, grass * vec3(1.1, 0.95, 0.7), smoothstep(0.55, 0.8, macro2) * 0.6);
          vec3 mud = texture2D(tMud, tuv * 0.11).rgb * mix(0.5, 0.8, texture2D(tNoise, tuv * 0.05).g);
          vec3 sand = texture2D(tSand, tuv * 0.13).rgb;
          vec3 sandB = texture2D(tSand, tuv * 0.031 + 0.2).rgb;
          sand = mix(sand, sandB, 0.5) * 0.75;
          float h = vWPos.y;
          float slope = 1.0 - clamp(vWorldUp, 0.0, 1.0);
          float wMud = smoothstep(1.9, 0.2, h + macro2 * 1.2);
          float wSand = smoothstep(-0.05, -0.9, h);
          wSand = max(wSand, smoothstep(0.7, 0.15, abs(h - 0.45)) * smoothstep(0.3, 0.55, macro) * (1.0 - slope * 3.0));
          vec3 col = mix(grass, mud, wMud);
          col = mix(col, sand, wSand);
          col *= mix(0.45, 1.0, smoothstep(-0.25, 1.2, h));
          float shorelineDamp = 1.0 - smoothstep(uWaterLevel + 0.1, uWaterLevel + 1.1, h);
          float wetFilm = clamp((uSurfaceWetness + shorelineDamp * 0.38) * smoothstep(0.2, 0.82, vWorldUp), 0.0, 1.0);
          col *= mix(1.0, 0.72, wetFilm);
          if (h < 0.05) {
            float c = caustic(tuv, uTime);
            col *= 1.0 + c * 0.75 * smoothstep(-6.0, -0.3, h) * smoothstep(0.05, -0.15, h);
          }
          diffuseColor.rgb *= col;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, wetFilm * wetFilm);');
    };
    mat.customProgramCacheKey = () => 'terrain-wet-v1';
    this.material = mat;
    return this.group;
  }

  setSurfaceWetness(wetness = 0, waterLevel = 0) {
    this.surfaceWetness = Math.max(0, Math.min(1, Number(wetness) || 0));
    this.surfaceWaterLevel = Number.isFinite(Number(waterLevel)) ? Number(waterLevel) : 0;
    if (this.uniforms) { this.uniforms.uSurfaceWetness.value = this.surfaceWetness; this.uniforms.uWaterLevel.value = this.surfaceWaterLevel; }
  }
  makeGeometry(c) {
    const n = c.segs, w = n + 1, step = c.size / n, shared = this.indexFor(n), count = w * w + shared.skirtCount;
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pos[k * 3] = c.x0 + i * step; pos[k * 3 + 1] = c.h[k]; pos[k * 3 + 2] = c.z0 + j * step;
      nrm[k * 3] = c.nrm[k * 3]; nrm[k * 3 + 1] = c.nrm[k * 3 + 1]; nrm[k * 3 + 2] = c.nrm[k * 3 + 2];
    }
    const drop = 1.5 + c.level * 2.5;
    let k = w * w;
    const skirt = (src) => { for (let t = 0; t < w; t++, k++) { const s = src(t); pos[k * 3] = pos[s * 3]; pos[k * 3 + 1] = pos[s * 3 + 1] - drop; pos[k * 3 + 2] = pos[s * 3 + 2]; nrm[k * 3] = nrm[s * 3]; nrm[k * 3 + 1] = nrm[s * 3 + 1]; nrm[k * 3 + 2] = nrm[s * 3 + 2]; } };
    skirt(t => t); skirt(t => n * w + t); skirt(t => t * w); skirt(t => t * w + n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(shared.index);
    const cy = (c.minH + c.maxH) / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.x0 + c.size / 2, cy, c.z0 + c.size / 2), Math.hypot(c.size / 2, c.size / 2, (c.maxH - c.minH) / 2 + drop));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(c.x0, c.minH - drop, c.z0), new THREE.Vector3(c.x0 + c.size, c.maxH, c.z0 + c.size));
    return geo;
  }

  // ---- streaming ----
  ensure(level, i, j) {
    const key = `${level}:${i}:${j}`;
    let c = this.chunks.get(key);
    if (!c) { c = new Chunk(level, i, j); this.chunks.set(key, c); }
    return c;
  }
  boxDist(x0, z0, size) {
    const dx = Math.max(x0 - this.camPos.x, 0, this.camPos.x - (x0 + size)), dz = Math.max(z0 - this.camPos.y, 0, this.camPos.y - (z0 + size));
    return Math.hypot(dx, dz);
  }
  request(c, dist) {
    c.prio = dist / c.size;
    if (!c.requested) { c.requested = true; this.queue.push(c); }
  }
  streamNode() {
    let node = this.streamNodes[this.streamNodeCount++];
    if (!node) {
      node = { leaf: false, kids: [], ready: false, c: null, level: 0, i: 0, j: 0, d: 0 };
      this.streamNodes.push(node);
    }
    node.leaf = false; node.kids.length = 0; node.ready = false; node.c = null;
    return node;
  }
  // pass 1: make sure every desired leaf exists / is requested; returns whether the subtree is fully ready
  prepare(level, i, j, now) {
    const size = SIZE(level), x0 = i * size, z0 = j * size;
    const d = this.boxDist(x0, z0, size);
    if (d > FAR || x0 >= WORLD_HALF || z0 >= WORLD_HALF || x0 + size <= -WORLD_HALF || z0 + size <= -WORLD_HALF) return null;
    const leaf = level === 0 || d >= size * SPLIT_K[level];
    const node = this.streamNode();
    node.level = level; node.i = i; node.j = j; node.d = d;
    if (leaf) {
      const c = this.ensure(level, i, j); c.used = now;
      if (!c.ready) {
        this.request(c, d);
        if (level < LEVELS - 1) { const pc = this.ensure(level + 1, i >> 1, j >> 1); pc.used = now; if (!pc.ready) this.request(pc, d); }
      }
      // build the children before the ring reaches them, so the split never waits (and never needs a fallback)
      const prefetch = this.prefetch || DEFAULT_PREFETCH;
      if (level > 0 && d < size * SPLIT_K[level] * prefetch) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const cs = size / 2, cx0 = (i * 2 + a) * cs, cz0 = (j * 2 + b) * cs;
        if (cx0 >= WORLD_HALF || cz0 >= WORLD_HALF || cx0 + cs <= -WORLD_HALF || cz0 + cs <= -WORLD_HALF) continue;
        const cc = this.ensure(level - 1, i * 2 + a, j * 2 + b); cc.used = now; if (!cc.ready) this.request(cc, this.boxDist(cx0, cz0, cs) + size);
      }
      node.c = c; node.leaf = true; node.ready = c.groundReady;
      return node;
    }
    let ready = true;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const child = this.prepare(level - 1, i * 2 + a, j * 2 + b, now);
      if (child) { node.kids.push(child); ready = ready && child.ready; }
    }
    node.ready = ready;
    return node;
  }
  // pass 2: choose what to draw. Every point of ground is covered by exactly one chunk. A quad whose leaves are
  // still building shows its own (one level coarser) chunk instead; the fallback never climbs higher than that,
  // so a chunk arriving at the edge of the world never changes what is drawn under the boat.
  select(node, now, vis) {
    if (!node) return;
    if (node.leaf) { if (node.c.groundReady) vis.add(node.c); return; }
    if (node.ready) { for (const k of node.kids) this.select(k, now, vis); return; }
    // only a quad made entirely of leaves may fall back to its coarse chunk: it lies wholly at ring distance. A quad
    // with finer subtrees inside it (the boat is near) never does - a building leaf there is a brief hole instead
    if (node.kids.every(k => k.leaf) && node.kids.some(k => !k.ready)) {
      const c = this.ensure(node.level, node.i, node.j); c.used = now;
      if (c.groundReady) { vis.add(c); this.touch(node, now); return; }
      this.request(c, node.d);
    }
    for (const k of node.kids) this.select(k, now, vis);
  }
  touch(node, now) { if (node.leaf) { node.c.used = now; return; } for (const k of node.kids) this.touch(k, now); }

  stream(now) {
    const vis = this.nextVisible; vis.clear(); this.streamNodeCount = 0;
    const roots = Math.ceil(WORLD_HALF / ROOT);
    for (let j = -roots; j < roots; j++) for (let i = -roots; i < roots; i++) {
      const root = this.prepare(LEVELS - 1, i, j, now);
      this.select(root, now, vis);
    }
    for (const c of this.visible) if (!vis.has(c)) { if (c.mesh) c.mesh.visible = false; if (c.veg) c.veg.visible = false; }
    for (const c of vis) { if (c.mesh) c.mesh.visible = true; if (c.veg) c.veg.visible = true; }
    this.nextVisible = this.visible; this.visible = vis;
    // drop chunks nobody has wanted for a while
    for (const c of this.chunks.values()) {
      if (vis.has(c) || now - c.used < 5000) continue;
      if (this.building === c) continue;
      this.dispose(c);
    }
    this.queue.sort((a, b) => a.prio - b.prio);
  }
  // Begin the worker-side height grids while the main thread is still preparing lighting, boats and shaders. Results
  // remain in the normal finalization queue, so ground and foliage ownership is unchanged when the frame loop starts.
  prime(x, z, now = performance.now()) {
    this.camPos.set(x, z); this.streamT = now; this.stream(now); this.pump();
    return { queued: this.queue.length, inFlight: this.pool.inFlight };
  }
  dispose(c) {
    this.chunks.delete(c.key);
    const qi = this.queue.indexOf(c); if (qi >= 0) this.queue.splice(qi, 1);
    const fi = this.finalize.indexOf(c); if (fi >= 0) this.finalize.splice(fi, 1);
    if (this.pausedBuilding === c) this.pausedBuilding = null;
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (this.hooks.dispose) this.hooks.dispose(c);
    c.h = null; c.nrm = null; c.bio = null; c.mesh = null; c.veg = null; c.build = null; c.groundReady = false; c.ready = false; c.disposed = true;
  }
  pump() {
    while (this.queue.length && this.pool.inFlight < this.pool.capacity) {
      const c = this.queue.shift();
      if (c.disposed) continue;
      this.pool.request({ kind: 'grid', x0: c.x0, z0: c.z0, size: c.size, n: c.segs }).then(m => {
        if (c.disposed) return;
        c.h = m.h; c.nrm = m.nrm; c.bio = m.bio; c.minH = m.minH; c.maxH = m.maxH;
        this.finalize.push(c);
      });
    }
  }
  update(t, camera) {
    if (this.uniforms) this.uniforms.uTime.value = t;
    this.camPos.set(camera.x, camera.z);
    const now = performance.now();
    if (now - this.streamT > 200) { this.streamT = now; this.stream(now); }
    this.pump();
    // A returned coarse grid can need hundreds of vegetation generator steps. Give every chunk a renderable ground
    // mesh first, and let a nearer or finer result preempt that foliage work on the next frame. The same vegetation,
    // colliders and final ready state are still built; only the single finalizer's order changes.
    this.finalize.sort(compareTerrainBuildPriority);
    if (shouldPreemptTerrainBuild(this.building, this.finalize[0], this.pausedBuilding)) {
      this.pausedBuilding = this.building; this.building = null;
    }
    // finalize grids into meshes + vegetation, within a per-frame time budget
    const budget = now + (this.finalizeBudgetMs || DEFAULT_FINALIZE_BUDGET_MS);
    while (performance.now() < budget) {
      if (!this.building) {
        let c = null;
        if (this.pausedBuilding && (!this.finalize.length || compareTerrainBuildPriority(this.pausedBuilding, this.finalize[0]) <= 0)) {
          c = this.pausedBuilding; this.pausedBuilding = null;
        } else c = this.finalize.shift();
        if (!c) break;
        if (!c.mesh) {
          c.mesh = new THREE.Mesh(this.makeGeometry(c), this.material);
          c.mesh.receiveShadow = true; c.mesh.castShadow = false; c.mesh.visible = false; c.mesh.name = 'terrain';
          this.group.add(c.mesh); c.groundReady = true;
          c.build = this.hooks.ready ? this.hooks.ready(c) : null;
        }
        this.building = c;
        if (!c.build) { this.finish(c); continue; }
      }
      const c = this.building;
      const stepStartedAt = performance.now();
      const r = c.build.next();
      const stepMs = performance.now() - stepStartedAt;
      const timing = this.finalizerTiming ||= { steps: 0, totalStepMs: 0, maxStepMs: 0, longSteps: 0, lastStepMs: 0 };
      timing.steps++; timing.totalStepMs += stepMs; timing.lastStepMs = stepMs;
      timing.maxStepMs = Math.max(timing.maxStepMs, stepMs);
      if (stepMs > (this.finalizeBudgetMs || DEFAULT_FINALIZE_BUDGET_MS)) timing.longSteps++;
      if (r.done) this.finish(c);
    }
    this.stats.chunks = this.chunks.size; this.stats.visible = this.visible.size; this.stats.inFlight = this.pool.inFlight;
  }
  settled() { return this.queue.length === 0 && this.finalize.length === 0 && !this.building && !this.pausedBuilding && this.pool.inFlight === 0 && this.visible.size > 0; }
  visibleAt(x, z) {
    for (const c of this.visible) if (c.mesh?.visible && x >= c.x0 && z >= c.z0 && x <= c.x0 + c.size && z <= c.z0 + c.size) return true;
    return false;
  }
  memoryStats() {
    const levels = {}; let terrainGrid = 0, terrainGeometry = 0, vegetation = 0, vegetationInstances = 0, vegetationMeshes = 0, colliders = 0;
    for (const c of this.chunks.values()) {
      const l = levels[c.level] ||= { chunks: 0, visible: 0, terrainGrid: 0, terrainGeometry: 0, vegetation: 0, vegetationInstances: 0, vegetationMeshes: 0, colliders: 0 };
      l.chunks++; if (this.visible.has(c)) l.visible++;
      const grid = (c.h?.byteLength || 0) + (c.nrm?.byteLength || 0) + (c.bio?.byteLength || 0);
      const geometry = (c.mesh?.geometry?.attributes.position?.array?.byteLength || 0) + (c.mesh?.geometry?.attributes.normal?.array?.byteLength || 0);
      let veg = 0, instances = 0, meshes = 0;
      if (c.veg) for (const m of c.veg.children) {
        meshes++; instances += m.isInstancedMesh ? m.count : (m.geometry.instanceCount || m.userData.instanceCount || 0);
        veg += (m.instanceMatrix?.array?.byteLength || 0) + (m.instanceColor?.array?.byteLength || 0);
        for (const name of ['iPosition', 'iQuaternion', 'iScale', 'iColor', 'iCrown']) veg += m.geometry.getAttribute(name)?.array?.byteLength || 0;
      }
      terrainGrid += grid; terrainGeometry += geometry; vegetation += veg; vegetationInstances += instances; vegetationMeshes += meshes; colliders += c.colliders.length;
      l.terrainGrid += grid; l.terrainGeometry += geometry; l.vegetation += veg; l.vegetationInstances += instances; l.vegetationMeshes += meshes; l.colliders += c.colliders.length;
    }
    const timing = this.finalizerTiming ||= { steps: 0, totalStepMs: 0, maxStepMs: 0, longSteps: 0, lastStepMs: 0 };
    return { chunks: this.chunks.size, visible: this.visible.size, terrainGrid, terrainGeometry, vegetation, vegetationInstances, vegetationMeshes, colliders, streamBudget: { prefetch: this.prefetch || DEFAULT_PREFETCH, finalizeBudgetMs: this.finalizeBudgetMs || DEFAULT_FINALIZE_BUDGET_MS, workerLimit: this.workerLimit || 4, workerCapacity: this.pool.capacity }, finalization: { queued: this.finalize.length, building: this.building?.key || '', paused: this.pausedBuilding?.key || '', steps: timing.steps, averageStepMs: timing.steps ? timing.totalStepMs / timing.steps : 0, maxStepMs: timing.maxStepMs, longSteps: timing.longSteps, lastStepMs: timing.lastStepMs }, streamNodes: { active: this.streamNodeCount, capacity: this.streamNodes.length }, levels };
  }
  finish(c) {
    this.building = null; c.build = null; c.ready = true;
    if (c.veg) { c.veg.visible = this.visible.has(c); this.group.add(c.veg); }
    if (this.hooks.done) this.hooks.done(c);
    // Normals and biome weights have done their job once geometry and foliage are baked. Only level 0 keeps heights,
    // because boat physics samples that ring; all higher levels render from their GPU buffers from here on.
    c.nrm = null; c.bio = null; if (c.level > 0) c.h = null;
  }
}
