import * as THREE from 'three';

// Call only on a known static model subtree. Identical pieces keep their original geometry, material and local
// transforms; one instance buffer replaces many Object3D nodes and draw submissions. Animated branches stay separate.
export function instanceStaticChildren(root, animated = new Set()) {
  let removedDraws = 0;
  const groups = new Map();
  for (const child of root.children) {
    if (animated.has(child)) continue;
    if (child.isGroup) { removedDraws += instanceStaticChildren(child, animated); continue; }
    if (!child.isMesh || child.isInstancedMesh || child.isSkinnedMesh || child.children.length || !child.visible
      || !child.geometry || Array.isArray(child.material) || child.material.transparent || child.userData.hullDamageSurface) continue;
    const key = `${child.geometry.uuid}:${child.material.uuid}:${child.castShadow}:${child.receiveShadow}:${child.layers.mask}:${child.renderOrder}`;
    let meshes = groups.get(key); if (!meshes) { meshes = []; groups.set(key, meshes); }
    meshes.push(child);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0], batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.name = `${root.name || 'airboat structure'} instances`;
    batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
    batch.layers.mask = first.layers.mask; batch.renderOrder = first.renderOrder;
    batch.matrixAutoUpdate = false; batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < meshes.length; i++) { meshes[i].updateMatrix(); batch.setMatrixAt(i, meshes[i].matrix); }
    batch.computeBoundingBox(); batch.computeBoundingSphere();
    for (const mesh of meshes) root.remove(mesh);
    root.add(batch); removedDraws += meshes.length - 1;
  }
  return removedDraws;
}
