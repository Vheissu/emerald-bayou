import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerWetMaterial } from './surfacewetness.js';

// Adjacent pieces of the same finish share a draw call. Vertex color carries the
// patch repairs, grime and tide marks so the full crossing needs no unique atlas.
export function waterfrontSurface(color, options = {}) {
  return registerWetMaterial(new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.87, ...options }));
}

export function tintGeometry(batch, geometry, tint, shade) {
  const positions = geometry.attributes.position;
  const color = new THREE.Color(tint), values = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const factor = shade ? shade(positions.getX(i), positions.getY(i), positions.getZ(i)) : 1;
    values[i * 3] = color.r * factor;
    values[i * 3 + 1] = color.g * factor;
    values[i * 3 + 2] = color.b * factor;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  batch.push(geometry);
}

export function addBox(batch, tint, width, height, depth, x, y, z) {
  tintGeometry(batch, new THREE.BoxGeometry(width, height, depth).translate(x, y, z), tint);
}

export function addBeam(batch, tint, a, b, width, depth) {
  const axis = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.BoxGeometry(width, axis.length(), depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
  geometry.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
  tintGeometry(batch, geometry, tint);
}

export function waterfrontMesh(batch, material, shadow = true) {
  const geometry = mergeGeometries(batch);
  for (const piece of batch) piece.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}
