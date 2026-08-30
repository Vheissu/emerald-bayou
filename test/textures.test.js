import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bark, coveragePreservingAlphaScale, plank, scaleTextureUvs, sharedSurfaceTextureStats } from '../src/textures.js';

test('foliage alpha coverage uses a histogram without changing the scale search', () => {
  const data = new Uint8ClampedArray(4096 * 4);
  for (let i = 0; i < 4096; i++) data[i * 4 + 3] = (i * 73 + (i >> 3) * 19) & 255;
  const alphaTest = 0.5, targetCoverage = 0.417;
  let lo = 1, hi = 6;
  for (let iteration = 0; iteration < 12; iteration++) {
    const scale = (lo + hi) / 2;
    let covered = 0;
    for (let i = 3; i < data.length; i += 4) if (Math.min(1, data[i] / 255 * scale) > alphaTest) covered++;
    if (covered / 4096 < targetCoverage) lo = scale; else hi = scale;
  }
  assert.equal(coveragePreservingAlphaScale(data, alphaTest, targetCoverage), (lo + hi) / 2);
  assert.equal(coveragePreservingAlphaScale(new Uint8ClampedArray(), alphaTest, targetCoverage), 1);
});

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
