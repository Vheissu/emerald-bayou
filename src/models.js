import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Meshy GLBs (decimated offline with gltf-transform, 1K webp textures): loaded once, cloned per use, and every clone
// shares the geometry and materials. SPEC turns each model's own frame into the game's (bow / head toward -z, metres).
const loader = new GLTFLoader();
const cache = new Map();
const modelRoot = `${import.meta.env.BASE_URL}models/`;
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
export function loadModel(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(`${modelRoot}${name}.glb`).then(g => {
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m) { if (m.map) { m.map.anisotropy = 4; m.map.colorSpace = THREE.SRGBColorSpace; } m.roughness = Math.max(m.roughness ?? 1, 0.55); } } });
    cacheDone.set(name, root); fit(name, root);
    return root;
  }).catch(e => { console.warn('model', name, e); return null; }));
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
export async function loadGeo(name) {
  const root = await loadModel(name); if (!root) return null;
  let mesh = null; root.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const sp = fit(name, root); const geo = mesh.geometry.clone();
  geo.rotateY(sp.yaw); geo.scale(sp.scale, sp.scale, sp.scale); geo.translate(0, sp.y, 0); geo.computeBoundingBox();
  return { geo, mat: mesh.material, height: geo.boundingBox.max.y };
}
export function preload(names) { return Promise.all(names.map(loadModel)); }
