import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWaterGrid } from '../src/watergrid.js';
import { waterWaveHeight, WATER_WAVES_GLSL } from '../src/waterwaves.js';
import { Water } from '../src/water.js';

function oldWave(x, z, t, sea, angle, rain) {
  const ca = Math.cos(angle), sa = Math.sin(angle), along = x * ca + z * sa, across = -x * sa + z * ca;
  const ambient = 0.04 * Math.sin(x * 0.18 + t * 0.9) * Math.cos(z * 0.15 + t * 0.7) + 0.025 * Math.sin(x * 0.4 - t * 1.3 + z * 0.3);
  const swell = sea * 0.105 * Math.sin(along * 0.042 - t * (0.62 + sea * 0.12)) * (0.72 + 0.28 * Math.cos(across * 0.018 + t * 0.21));
  const chop = sea * 0.038 * Math.sin(along * 0.24 - t * 1.8 + Math.sin(across * 0.11)) + rain * 0.012 * Math.sin(x * 1.7 + z * 1.3 + t * 5.2);
  return ambient + swell + chop;
}

test('shared wave coefficients preserve the existing buoyancy field across the map and weather range', () => {
  for (const sea of [0, 0.08, 0.78, 1.45, 2.15]) for (const angle of [-2.4, 0, 1.2]) for (const rain of [0, 1]) {
    for (let i = 0; i < 100; i++) {
      const x = -12800 + i * 259.31, z = Math.sin(i * 0.31) * 12800, t = i * 71.3;
      assert.ok(Math.abs(waterWaveHeight(x, z, t, sea, angle, rain) - oldWave(x, z, t, sea, angle, rain)) < 1e-12);
    }
  }
});

test('the water mesh has a bounded static allocation and covers the complete old horizon', () => {
  const grid = createWaterGrid(), stats = grid.userData.waterGrid;
  assert.equal(stats.vertices, 24449); assert.equal(stats.triangles, 48640);
  assert.equal(stats.bytes, grid.attributes.position.array.byteLength + grid.attributes.aWaveSpacing.array.byteLength + grid.index.array.byteLength);
  assert.ok(stats.bytes < 700000); assert.ok(grid.index.array instanceof Uint16Array);
  assert.deepEqual(Object.keys(grid.attributes).sort(), ['aWaveSpacing', 'position']);
  assert.equal(grid.boundingBox.min.x, -8192); assert.equal(grid.boundingBox.max.z, 8192);
  assert.equal(stats.nearSpacing, 0.5); assert.equal(stats.nearHalfExtent, 16);
  assert.ok(grid.attributes.aWaveSpacing.getX(grid.attributes.position.count - 1) >= 4096);
  grid.dispose();
});

test('every ring is stitched, upward-facing and free of holes or overlapping triangles', () => {
  const grid = createWaterGrid(), positions = grid.attributes.position, indices = grid.index.array, edges = new Map();
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    assert.ok(a < positions.count && b < positions.count && c < positions.count);
    const ux = positions.getX(b) - positions.getX(a), uz = positions.getZ(b) - positions.getZ(a);
    const vx = positions.getX(c) - positions.getX(a), vz = positions.getZ(c) - positions.getZ(a);
    const twiceArea = uz * vx - ux * vz;
    assert.ok(twiceArea > 0); area += twiceArea / 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(u, v) * positions.count + Math.max(u, v);
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.equal(area, 16384 ** 2);
  assert.equal([...edges.values()].filter(count => count === 1).length, 256);
  assert.ok([...edges.values()].every(count => count === 1 || count === 2));
  assert.equal(positions.count - edges.size + indices.length / 3, 1);
  grid.dispose();
});

test('near-water triangles follow the physical height field within five millimetres', () => {
  let maxError = 0;
  for (let i = 0; i < 3000; i++) {
    const x = Math.sin(i * 2.73) * 15.9, z = Math.cos(i * 1.81) * 15.9, t = i * 0.173;
    const x0 = Math.floor(x * 2) * 0.5, z0 = Math.floor(z * 2) * 0.5, u = (x - x0) * 2, v = (z - z0) * 2;
    const h = (px, pz) => waterWaveHeight(px, pz, t, 2.15, 1.2, 1);
    const a = h(x0, z0), b = h(x0, z0 + 0.5), c = h(x0 + 0.5, z0), d = h(x0 + 0.5, z0 + 0.5);
    const rendered = v >= u ? a * (1 - v) + b * (v - u) + d * u : a * (1 - u) + d * v + c * (u - v);
    maxError = Math.max(maxError, Math.abs(rendered - h(x, z)));
  }
  assert.ok(maxError < 0.005, `maximum near-water interpolation error ${maxError}`);
});

test('camera tracking reuses all buffers and snaps to the same world-space lattice', () => {
  const mesh = new THREE.Mesh(createWaterGrid()), water = { mesh, level: 0.7 };
  const positions = mesh.geometry.attributes.position.array, indices = mesh.geometry.index.array;
  for (let i = 0; i < 1000; i++) {
    Water.prototype.followCamera.call(water, { x: i * 0.17, z: -i * 0.13 });
    assert.equal(mesh.position.x * 2, Math.round(mesh.position.x * 2));
    assert.equal(mesh.position.z * 2, Math.round(mesh.position.z * 2));
    assert.equal(mesh.position.y, 0.7);
  }
  assert.equal(mesh.geometry.attributes.position.array, positions); assert.equal(mesh.geometry.index.array, indices);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('displacement precedes projection and its analytic slope reaches water lighting', () => {
  const water = new Water({ getDrawingBufferSize: out => out.set(320, 180) }, new THREE.Vector3(0, 1, 0));
  const vertex = water.material.vertexShader, fragment = water.material.fragmentShader;
  assert.ok(vertex.includes(WATER_WAVES_GLSL));
  assert.ok(vertex.indexOf('wp.y += wave.x') < vertex.indexOf('vRefl = reflMatrix * wp'));
  assert.match(vertex, /waterWaveSample\(wp.xz/); assert.match(vertex, /aWaveSpacing/);
  assert.match(fragment, /nt.x - wg.x - vWaveSlope.x/);
  assert.equal(water.uniforms.surfaceDisplacement.value, 1);
  assert.equal(Object.keys(water.uniforms).filter(key => key.startsWith('t')).length, 8);
  water.reflRT.dispose(); water.wakeA.dispose(); water.wakeB.dispose(); water.murkTex.dispose();
  water.mesh.geometry.dispose(); water.material.dispose(); water.simQuad.geometry.dispose(); water.simMat.dispose();
});
