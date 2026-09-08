import * as THREE from 'three';

// A half-metre centre and stitched square rings spend geometry near the camera without tessellating 16 km of
// distant water at that spacing. Every ring has the same perimeter vertex count, so there are no T-junctions.
export function createWaterGrid() {
  const segments = 64, half = 16, nearSpacing = 0.5, row = segments + 1;
  const radii = [];
  for (const [start, end, step] of [[17, 32, 1], [34, 64, 2], [68, 128, 4], [136, 256, 8], [288, 512, 32], [640, 1024, 128]]) {
    for (let r = start; r <= end; r += step) radii.push(r);
  }
  radii.push(2048, 4096, 8192);
  const vertexCount = row * row + radii.length * segments * 4;
  const triangleCount = segments * segments * 2 + radii.length * segments * 8;
  const positions = new Float32Array(vertexCount * 3), indices = new Uint16Array(triangleCount * 3);
  const spacing = new Float32Array(vertexCount);
  let vertex = 0, index = 0;
  let cellSize = nearSpacing, previousRadius = half;
  const point = (x, z) => { const i = vertex++; positions[i * 3] = x; positions[i * 3 + 2] = z; spacing[i] = cellSize; return i; };
  const triangle = (a, b, c) => { indices[index++] = a; indices[index++] = b; indices[index++] = c; };
  for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) point(x * nearSpacing - half, z * nearSpacing - half);
  for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
    const a = z * row + x, b = a + row;
    triangle(a, b, b + 1); triangle(a, b + 1, a + 1);
  }
  let inner = [];
  for (let i = 0; i < segments; i++) inner.push(i * row);
  for (let i = 0; i < segments; i++) inner.push(segments * row + i);
  for (let i = 0; i < segments; i++) inner.push((segments - i) * row + segments);
  for (let i = 0; i < segments; i++) inner.push(segments - i);
  for (const radius of radii) {
    const outer = [], step = radius * 2 / segments;
    cellSize = Math.max(radius - previousRadius, step); previousRadius = radius;
    for (let i = 0; i < segments; i++) outer.push(point(-radius, -radius + i * step));
    for (let i = 0; i < segments; i++) outer.push(point(-radius + i * step, radius));
    for (let i = 0; i < segments; i++) outer.push(point(radius, radius - i * step));
    for (let i = 0; i < segments; i++) outer.push(point(radius - i * step, -radius));
    for (let i = 0; i < inner.length; i++) {
      const next = (i + 1) % inner.length;
      triangle(inner[i], outer[i], outer[next]); triangle(inner[i], outer[next], inner[next]);
    }
    inner = outer;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aWaveSpacing', new THREE.BufferAttribute(spacing, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = 'Camera-centred wave surface';
  geometry.userData.waterGrid = { vertices: vertexCount, triangles: triangleCount,
    bytes: positions.byteLength + spacing.byteLength + indices.byteLength, nearSpacing, nearHalfExtent: half, halfExtent: 8192 };
  return geometry;
}
