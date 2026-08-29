import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityController, initialQualityLevel, msaaSamplesFor, pixelRatioFor, qualityProfile } from '../src/renderquality.js';

test('caps dense displays by drawing-pixel budget', () => {
  assert.equal(pixelRatioFor(1000, 1000, 2), Math.sqrt(3));
  assert.equal(pixelRatioFor(1920, 1080, 1), 1);
  assert.ok(pixelRatioFor(3840, 2160, 2, qualityProfile(1).maxDrawPixels, qualityProfile(1).maxDevicePixelRatio) < 0.4);
});

test('starts conservatively only when hardware signals justify it', () => {
  assert.equal(initialQualityLevel({ deviceMemory: 16, hardwareConcurrency: 12, maxTextureSize: 16384 }), 3);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 8, maxTextureSize: 16384 }), 3);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 6, maxTextureSize: 16384 }), 2);
  assert.equal(initialQualityLevel({ deviceMemory: 4, hardwareConcurrency: 8, maxTextureSize: 16384 }), 1);
  assert.equal(initialQualityLevel({ saveData: true }), 0);
});

test('removes multisample attachments on performance profiles', () => {
  assert.equal(msaaSamplesFor(1200, 800, 0), 0);
  assert.equal(msaaSamplesFor(1200, 800, 2), 2);
  assert.equal(msaaSamplesFor(2000, 1000, 4), 2);
});

test('steps down on sustained missed frames and ignores a background pause', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 3, sampleSeconds: 1 });
  let change = null;
  for (let i = 0; i < 32; i++) change ||= quality.observe(1 / 30, true);
  assert.equal(change?.profile.id, 'balanced');
  assert.equal(quality.observe(1, true), null);
  assert.equal(quality.profile.id, 'balanced');
});

test('requires several clean windows before restoring quality', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 1, sampleSeconds: 1 });
  let change = null;
  for (let i = 0; i < 360; i++) { const observation = quality.observe(1 / 70, true); if (observation) change = observation; }
  assert.equal(change?.profile.id, 'balanced');
});

test('can lock a manual profile and return to an adaptive range', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 3, sampleSeconds: 1 });
  assert.equal(quality.configure({ initialLevel: 1, minLevel: 1, maxLevel: 1 }).id, 'performance');
  for (let i = 0; i < 120; i++) quality.observe(1 / 25, true);
  assert.equal(quality.profile.id, 'performance');
  assert.equal(quality.configure({ initialLevel: 2, minLevel: 0, maxLevel: 3 }).id, 'balanced');
  assert.deepEqual(quality.snapshot().lastSample, null);
});
