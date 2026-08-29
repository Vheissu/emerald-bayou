import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Meshy GLBs (decimated offline with gltf-transform, 1K webp textures): loaded once, cloned per use, and every clone
// shares the geometry and materials. SPEC turns each model's own frame into the game's (bow / head toward -z, metres).
const loader = new GLTFLoader();
const cache = new Map();
const deferredQueue = [];
const deferredByName = new Map();
const DEFERRED_PRIORITY = Object.freeze({
  driver: 0, beau_boat: 0, boat_dreams: 0, sandbox_boat: 1,
  fish_a: 2, turtle_boat: 2, realistic_alligator: 3,
  grass_a: 4, grass_d: 4,
  tree_c: 10,
});
let deferOptionalModels = false, modelConcurrency = 2, modelBatchDelayMs = 0, modelIdleTimeoutMs = 900, modelPressureMaxWaitMs = 8000, drainingDeferred = false, drainPromise = null, requestOrder = 0;
let modelPressureStartedAt = 0, modelPressureUntil = 0, pressureForcedBatches = 0;
let disabledModels = new Set();
const skippedModels = new Set();
const modelRoot = `${import.meta.env?.BASE_URL || '/'}models/`;
export const SPEC = {
  beau_boat: { scale: 2.3, yaw: -Math.PI / 2, y: 0.27, len: 4.4 },
  boat_dreams: { scale: 2.7, yaw: -Math.PI / 2, y: 0.62, len: 5.4 },
  sandbox_boat: { scale: 2.1, yaw: -Math.PI / 2, y: 0.37, len: 4.0 },
  turtle_boat: { scale: 0.22, yaw: -Math.PI / 2, y: 0.1 },
  fish_a: { scale: 0.17, yaw: Math.PI / 2, y: 0 },
  fish_b: { scale: 0.13, yaw: -Math.PI / 2, y: 0 },
  koi_fish: { scale: 0.17, yaw: Math.PI / 2, y: 0 },
  realistic_alligator: { scale: 1.5, yaw: Math.PI / 2, y: 0.35 }, // belly on the origin
  grass_a: { scale: 0.55, yaw: 0, y: 0, ground: true }, grass_b: { scale: 0.6, yaw: 0, y: 0, ground: true }, grass_c: { scale: 0.6, yaw: 0, y: 0, ground: true }, grass_d: { scale: 0.7, yaw: 0, y: 0, ground: true },
  tree_c: { scale: 1, height: 13, yaw: 0, y: 0, ground: true }, tree_b: { scale: 1, height: 15, yaw: 0, y: 0, ground: true }, tree_a: { scale: 1, height: 16, yaw: 0, y: 0, ground: true },
};
// a model's transform in the game frame, once its bounds are known
function fit(name, root) {
  const sp = SPEC[name] || { scale: 1, yaw: 0, y: 0 };
  if (!root.userData.box) root.userData.box = new THREE.Box3().setFromObject(root);
  const b = root.userData.box; const scale = sp.height ? sp.height / (b.max.y - b.min.y) : sp.scale;
  return { scale, yaw: sp.yaw, y: sp.ground ? -b.min.y * scale : sp.y, box: b };
}
export function modelBox(name) { const r = cacheDone.get(name); return r ? fit(name, r) : null; }
const cacheDone = new Map();

export function configureModelLoading({ deferOptional = false, concurrency = 2, batchDelayMs = 0, idleTimeoutMs = 900, pressureMaxWaitMs = 8000, disabled = [] } = {}) {
  deferOptionalModels = Boolean(deferOptional);
  modelConcurrency = Math.max(1, Math.min(4, Math.round(Number(concurrency) || 1)));
  modelBatchDelayMs = Math.max(0, Math.min(5000, Math.round(Number(batchDelayMs) || 0)));
  modelIdleTimeoutMs = Math.max(250, Math.min(5000, Math.round(Number(idleTimeoutMs) || 900)));
  const maxWait = Number(pressureMaxWaitMs); modelPressureMaxWaitMs = Number.isFinite(maxWait) ? Math.max(0, Math.min(30000, Math.round(maxWait))) : 8000;
  modelPressureStartedAt = 0; modelPressureUntil = 0; pressureForcedBatches = 0;
  disabledModels = new Set(Array.isArray(disabled) ? disabled : []);
}

// Optional GLBs replace procedural stand-ins. A bad gameplay frame therefore buys the renderer some quiet time before
// the next fetch/decode batch; sustained low-end pressure still admits a batch periodically instead of starving detail.
export function modelFrameBackoffMs(frameSeconds) {
  const seconds = Number(frameSeconds);
  if (!Number.isFinite(seconds) || seconds <= 1 / 30) return 0;
  if (seconds <= 0.05) return 450;
  if (seconds <= 0.1) return 1200;
  if (seconds <= 0.2) return 2200;
  return 3200;
}

export function modelPressureStep(now, pauseUntil, pauseStartedAt, maxWaitMs) {
  const remaining = Math.max(0, Number(pauseUntil) - Number(now));
  if (!Number.isFinite(remaining) || remaining <= 0) return { waitMs: 0, forced: false };
  const elapsed = Number(now) - Number(pauseStartedAt), limit = Math.max(0, Number(maxWaitMs) || 0);
  if (limit > 0 && Number.isFinite(elapsed) && elapsed >= limit) return { waitMs: 0, forced: true };
  return { waitMs: Math.min(250, Math.ceil(remaining)), forced: false };
}

export function reportModelFramePressure(frameSeconds, active = true) {
  if (!active || !deferOptionalModels || !deferredByName.size) return 0;
  const backoff = modelFrameBackoffMs(frameSeconds); if (!backoff) return 0;
  const now = performance.now(); if (modelPressureUntil <= now) modelPressureStartedAt = now;
  modelPressureUntil = Math.max(modelPressureUntil, now + backoff); return backoff;
}

const deferredPriority = name => DEFERRED_PRIORITY[name] ?? 5;
const compareDeferredJobs = (a, b) => deferredPriority(a.name) - deferredPriority(b.name) || a.order - b.order;
export function orderDeferredModelNames(names) {
  return names.map((name, order) => ({ name, order })).sort(compareDeferredJobs).map(job => job.name);
}

function fetchModel(name) {
  return loader.loadAsync(`${modelRoot}${name}.glb`).then(g => {
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m) { if (m.map) { m.map.anisotropy = 4; m.map.colorSpace = THREE.SRGBColorSpace; } m.roughness = Math.max(m.roughness ?? 1, 0.55); } } });
    cacheDone.set(name, root); fit(name, root);
    return root;
  }).catch(e => { console.warn('model', name, e); return null; });
}

function startDeferred(job) {
  if (job.started) return job.promise;
  job.started = true; deferredByName.delete(job.name);
  const load = fetchModel(job.name); load.then(job.resolve); return load;
}

function idleTurn() {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: modelIdleTimeoutMs });
    else setTimeout(resolve, 80);
  });
}

function visibleTurn() {
  const doc = globalThis.document;
  if (!doc || doc.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise(resolve => {
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') return;
      doc.removeEventListener('visibilitychange', onVisibility);
      resolve();
    };
    doc.addEventListener('visibilitychange', onVisibility);
  });
}

const delayTurn = ms => new Promise(resolve => setTimeout(resolve, ms));

async function modelHeadroomTurn() {
  while (true) {
    const step = modelPressureStep(performance.now(), modelPressureUntil, modelPressureStartedAt, modelPressureMaxWaitMs);
    if (!step.waitMs) {
      if (step.forced) pressureForcedBatches++;
      modelPressureStartedAt = 0; modelPressureUntil = 0; return;
    }
    await delayTurn(step.waitMs);
  }
}

function compactDeferredQueue() {
  let write = 0;
  for (const job of deferredQueue) if (!job.started) deferredQueue[write++] = job;
  deferredQueue.length = write;
  deferredQueue.sort(compareDeferredJobs);
}

async function drainDeferredModels() {
  if (drainingDeferred) return; drainingDeferred = true;
  let batchIndex = 0;
  try {
    while (deferredQueue.length) {
      compactDeferredQueue(); if (!deferredQueue.length) break;
      await visibleTurn();
      if (batchIndex && modelBatchDelayMs) await delayTurn(modelBatchDelayMs);
      await visibleTurn();
      await idleTurn();
      await modelHeadroomTurn();
      compactDeferredQueue(); if (!deferredQueue.length) break;
      const batch = [];
      while (batch.length < modelConcurrency && deferredQueue.length) batch.push(deferredQueue.shift());
      if (batch.length) { await Promise.all(batch.map(startDeferred)); batchIndex++; }
    }
  } finally {
    deferOptionalModels = false;
    drainingDeferred = false;
  }
}

export function releaseDeferredModels() {
  if (!deferOptionalModels && !drainingDeferred) return Promise.resolve();
  if (!drainPromise) drainPromise = drainDeferredModels().finally(() => { drainPromise = null; });
  return drainPromise;
}

export function modelLoadingStats() {
  const remaining = Math.max(0, Math.ceil(modelPressureUntil - performance.now()));
  return {
    cached: cache.size, ready: cacheDone.size, queued: deferredByName.size, skipped: skippedModels.size, concurrency: modelConcurrency, deferred: deferOptionalModels,
    pressure: { paused: remaining > 0, remainingMs: remaining, maxWaitMs: modelPressureMaxWaitMs, forcedBatches: pressureForcedBatches },
  };
}

export function loadModel(name, { immediate = false } = {}) {
  if (!cache.has(name)) {
    if (disabledModels.has(name)) {
      skippedModels.add(name);
      cache.set(name, Promise.resolve(null));
    } else if (deferOptionalModels && !immediate) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const job = { name, promise, resolve, started: false, order: requestOrder++ };
      cache.set(name, promise); deferredByName.set(name, job); deferredQueue.push(job);
    } else cache.set(name, fetchModel(name));
  } else if (immediate && deferredByName.has(name)) startDeferred(deferredByName.get(name));
  return cache.get(name);
}
// A group that fills itself with the model when it arrives (until then it is empty, or shows `placeholder`).
export function spawn(name, placeholder = null, onReady = null) {
  const g = new THREE.Group(); g.name = name;
  if (placeholder) g.add(placeholder);
  loadModel(name).then(root => {
    if (!root) return;
    const f = fit(name, root); const c = root.clone(true); c.scale.setScalar(f.scale); c.rotation.y = f.yaw; c.position.y = f.y;
    if (placeholder) g.remove(placeholder);
    g.add(c); g.userData.model = c; if (onReady) onReady(c, g);
  });
  return g;
}
// a single merged geometry + material out of a loaded model, for instancing (the models are one mesh each)
export async function loadGeo(name, { releaseSource = false } = {}) {
  const root = await loadModel(name); if (!root) return null;
  let mesh = null; root.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const sp = fit(name, root); const geo = mesh.geometry.clone();
  geo.rotateY(sp.yaw); geo.scale(sp.scale, sp.scale, sp.scale); geo.translate(0, sp.y, 0); geo.computeBoundingBox();
  const result = { geo, mat: mesh.material, height: geo.boundingBox.max.y };
  // Instanced-only assets retain the baked geometry and texture, not an unused GLTF scene plus its source geometry.
  if (releaseSource) { cache.delete(name); cacheDone.delete(name); }
  return result;
}
export function preload(names) { return Promise.all(names.map(name => loadModel(name, { immediate: true }))); }
