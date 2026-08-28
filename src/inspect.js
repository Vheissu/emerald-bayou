import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// dev helper: load a GLB, report its shape, and drop it into the scene near the boat
const loader = new GLTFLoader();
export async function inspect(url) {
  const g = await loader.loadAsync(url);
  const root = g.scene; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const ctr = box.getCenter(new THREE.Vector3());
  let meshes = 0, tris = 0; const tex = new Set(), mats = new Set();
  root.traverse(o => { if (o.isMesh) { meshes++; const p = o.geometry.attributes.position.count; tris += o.geometry.index ? o.geometry.index.count / 3 : p / 3; const m = o.material; mats.add(m.name || m.uuid); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (m[k] && m[k].image) tex.add(`${k}:${m[k].image.width}x${m[k].image.height}`); } });
  return { url, size: size.toArray().map(v => +v.toFixed(3)), min: box.min.toArray().map(v => +v.toFixed(3)), max: box.max.toArray().map(v => +v.toFixed(3)), center: ctr.toArray().map(v => +v.toFixed(3)), meshes, tris, mats: mats.size, tex: [...tex], anims: g.animations.map(a => a.name), root };
}
export async function show(scene, url, x, y, z, scale = 1, rotY = 0) {
  const r = await inspect(url); r.root.scale.setScalar(scale); r.root.position.set(x, y, z); r.root.rotation.y = rotY; r.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(r.root); return r;
}
