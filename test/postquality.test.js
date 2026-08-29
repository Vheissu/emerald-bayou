import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pipeline } from '../src/post.js';
import { pixelRatioFor, qualityProfile } from '../src/renderquality.js';

test('performance mode releases full-size optional post targets', () => {
  const renderer = { getDrawingBufferSize: target => target.set(1920, 1080) };
  const pipeline = new Pipeline(renderer, new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 7500), qualityProfile(3));
  const cinematic = pipeline.memoryStats();
  assert.equal(cinematic.surfaceMist, 1);

  const profile = qualityProfile(1);
  const ratio = pixelRatioFor(1920, 1080, 2, profile.maxDrawPixels, profile.maxDevicePixelRatio);
  pipeline.setQuality(profile);
  pipeline.resize(1920 * ratio, 1080 * ratio);
  const performance = pipeline.memoryStats();

  assert.equal(performance.samples, 0);
  assert.equal(performance.bloom, false);
  assert.equal(performance.finalPass, false);
  assert.equal(performance.surfaceMist, 0);
  assert.equal(pipeline.aaRT.width, 1);
  assert.equal(pipeline.bloomA.width, 1);
  assert.ok(performance.estimatedAttachmentBytes < cinematic.estimatedAttachmentBytes * 0.45);
});
