import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bark, plank, scaleTextureUvs, sharedSurfaceTextureStats } from '../src/textures.js';

test('texture repeat can move into geometry UVs without changing the sampled coordinates', () => {
  const geometry = new THREE.BoxGeometry(2, 1, 4), uv = geometry.getAttribute('uv');
  const before = Array.from(uv.array), version = uv.version;
  assert.equal(scaleTextureUvs(geometry, 2, 6), geometry);
  for (let i = 0; i < uv.count; i++) {
    assert.equal(uv.getX(i), before[i * 2] * 2);
    assert.equal(uv.getY(i), before[i * 2 + 1] * 6);
  }
  assert.ok(uv.version > version);
  geometry.dispose();
});

test('UV scaling is a no-op for geometry without texture coordinates', () => {
  const geometry = new THREE.BufferGeometry();
  assert.equal(scaleTextureUvs(geometry, 2, 6), geometry);
  geometry.dispose();
});

test('deterministic bark and plank surfaces are generated once and shared', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement() {
    const context = {
      beginPath() {}, fill() {}, fillRect() {}, lineTo() {}, moveTo() {}, putImageData() {}, stroke() {},
      getImageData(x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    };
    return { width: 0, height: 0, getContext: () => context };
  } };
  try {
    const barkTexture = bark(), plankTexture = plank();
    assert.equal(bark(), barkTexture);
    assert.equal(plank(), plankTexture);
    assert.deepEqual(sharedSurfaceTextureStats(), {
      textures: 2, keys: ['bark', 'plank'], hits: 2,
      estimatedCanvasBytes: 1_572_864, estimatedGpuBytes: 2_097_152, estimatedAvoidedBytes: 3_670_016,
    });
    barkTexture.dispose(); plankTexture.dispose();
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
