import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// The eastern bend of Gulf Cut floods twice a day. Only the open strip between
// the channel and the first stand of trees carries last tide's drift.
function shorelineX(z) {
  return 71.3 - 0.036 * Math.max(0, -30 - z) ** 2 + 0.033 * Math.max(0, z + 24) ** 2;
}

export function onGulfCutFlat(x, z) {
  if (z < -44 || z > -4 || x < 52 || x > 91) return false;
  return ((x - shorelineX(z)) / 10.2) ** 2 + ((z + 24) / 20) ** 2 < 1;
}

let shell, reed, material;
export function buildTidalWrack(chunk, originX, originZ) {
  if (chunk.level !== 0 || chunk.i !== 0 || chunk.j !== -1) return [];
  shell ||= new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  reed ||= new THREE.CylinderGeometry(0.65, 1, 1, 5).rotateX(Math.PI / 2);
  material ||= new THREE.MeshStandardMaterial({ roughness: 0.88 });
  const rand = mulberry32(41817),
    shells = [],
    stems = [];
  const pose = new THREE.Object3D(),
    color = new THREE.Color();
  for (let clump = 0; clump < 55; clump++) {
    const z0 = -40 + rand() * 32;
    const x0 = shorelineX(z0) + 0.9 + Math.sin(z0 * 0.43) * 0.9 + rand() * 2;
    for (let i = 0; i < 11; i++) {
      const x = x0 + (rand() - 0.5) * 1.55,
        z = z0 + (rand() - 0.5) * 2.7;
      const ground = chunk.sample(x, z);
      if (ground < -0.19 || ground > 0.64 || !onGulfCutFlat(x, z)) continue;
      const stem = rand() < 0.25,
        size = 0.55 + rand() * 1.1;
      const yaw = stem ? 0.35 + (rand() - 0.5) * 1.5 : rand() * Math.PI * 2;
      const dz = Math.cos(yaw) * 0.13,
        dx = Math.sin(yaw) * 0.13;
      const tilt = Math.atan2(chunk.sample(x - dx, z - dz) - chunk.sample(x + dx, z + dz), 0.26);
      pose.rotation.set(tilt, yaw, (rand() - 0.5) * 0.26, 'YXZ');
      pose.position.set(x - originX, ground + (stem ? 0.006 : 0.001), z - originZ);
      if (stem) pose.scale.set(0.007 * size, 0.007 * size, (0.11 + rand() * 0.33) * size);
      else pose.scale.set(0.021 * size, 0.012 * size, 0.033 * size);
      pose.updateMatrix();
      color.setHex(stem ? (rand() < 0.6 ? 0x927349 : 0x574634) : rand() < 0.65 ? 0xc2b79e : 0x888170);
      (stem ? stems : shells).push({ matrix: pose.matrix.clone(), color: color.clone() });
    }
  }
  return [
    [shell, shells, 'Shell drift'],
    [reed, stems, 'Washed-up reed stems'],
  ]
    .filter(([, pieces]) => pieces.length)
    .map(([geometry, pieces, name]) => {
      const mesh = new THREE.InstancedMesh(geometry, material, pieces.length);
      mesh.name = name;
      mesh.receiveShadow = true;
      pieces.forEach((p, i) => {
        mesh.setMatrixAt(i, p.matrix);
        mesh.setColorAt(i, p.color);
      });
      return mesh;
    });
}
