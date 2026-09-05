import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pipeline } from '../src/post.js';
import { pixelRatioFor, qualityProfile } from '../src/renderquality.js';

test('post preparation warms both FXAA destinations without resizing or retaining another target', async () => {
  const live = {}, calls = []; let target = live;
  const pipeline = Object.create(Pipeline.prototype);
  pipeline.renderer = { getRenderTarget: () => target, setRenderTarget: value => { target = value; }, compileAsync: async root => { calls.push([root.name, target]); } };
  for (const name of ['copy', 'bright', 'blur', 'grade', 'fxaa', 'final']) pipeline[name] = { scene: { name }, cam: {} };
  for (const name of ['compRT', 'bloomA', 'bloomB', 'ldrRT', 'aaRT']) pipeline[name] = { name };
  assert.equal(await pipeline.prepareShaders(), 7);
  assert.deepEqual(calls.filter(([name]) => name === 'fxaa'), [['fxaa', pipeline.aaRT], ['fxaa', null]]);
  assert.equal(calls.find(([name]) => name === 'final')[1], null);
  assert.equal(target, live);
});

test('performance mode releases full-size optional post targets', () => {
  const renderer = { getDrawingBufferSize: target => target.set(1920, 1080) };
  const pipeline = new Pipeline(renderer, new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 7500), qualityProfile(3));
  const cinematic = pipeline.memoryStats();
  assert.equal(cinematic.surfaceMist, 1);
  assert.equal(cinematic.heatHaze, 1);
  assert.equal(cinematic.cloudShadows, 1);
  assert.equal(cinematic.lensWater, 1);
  assert.deepEqual(Object.keys(pipeline.grade.material.uniforms).filter(name => /^t[A-Z]/.test(name)).sort(), ['tBloom', 'tColor', 'tDepth', 'tNoise']);
  assert.equal((pipeline.grade.material.fragmentShader.match(/texture2D\(tNoise, cloudUv\)/g) || []).length, 1);
  assert.equal((pipeline.grade.material.fragmentShader.match(/texture2D\(tNoise, heatUv\)/g) || []).length, 1);
  assert.deepEqual(
    [cinematic.heatHazeExtraPasses, cinematic.heatHazeExtraPrograms, cinematic.heatHazeExtraTextures, cinematic.heatHazeExtraAttachmentBytes],
    [0, 0, 0, 0],
  );
  pipeline.grade.material.uniforms.heatAmount.value = 1;
  assert.equal(pipeline.memoryStats().estimatedAttachmentBytes, cinematic.estimatedAttachmentBytes);

  const profile = qualityProfile(1);
  const ratio = pixelRatioFor(1920, 1080, 2, profile.maxDrawPixels, profile.maxDevicePixelRatio);
  pipeline.setQuality(profile);
  pipeline.resize(1920 * ratio, 1080 * ratio);
  const performance = pipeline.memoryStats();

  assert.equal(performance.samples, 0);
  assert.equal(performance.bloom, false);
  assert.equal(performance.finalPass, false);
  assert.equal(performance.surfaceMist, 0);
  assert.equal(performance.heatHaze, 0);
  assert.equal(performance.heatHazeAmount, 1);
  assert.deepEqual(
    [performance.heatHazeExtraPasses, performance.heatHazeExtraPrograms, performance.heatHazeExtraTextures, performance.heatHazeExtraAttachmentBytes],
    [0, 0, 0, 0],
  );
  assert.equal(performance.cloudShadows, 0);
  assert.equal(performance.cloudShadowExtraPasses, 0);
  assert.equal(performance.cloudShadowExtraPrograms, 0);
  assert.equal(performance.cloudShadowExtraTextures, 0);
  assert.equal(performance.cloudShadowExtraAttachmentBytes, 0);
  assert.equal(performance.lensWater, 0);
  assert.equal(pipeline.aaRT.width, 1);
  assert.equal(pipeline.bloomA.width, 1);
  assert.ok(performance.estimatedAttachmentBytes < cinematic.estimatedAttachmentBytes * 0.45);
});

test('background hibernation collapses every post attachment and restores the selected profile', () => {
  const renderer = { getDrawingBufferSize: target => target.set(1920, 1080) };
  const pipeline = new Pipeline(renderer, new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 7500), qualityProfile(3));
  const active = pipeline.memoryStats();

  assert.equal(pipeline.hibernate(), true);
  assert.equal(pipeline.hibernate(), false);
  const dormant = pipeline.memoryStats();
  assert.equal(dormant.dormant, true);
  assert.deepEqual([dormant.width, dormant.height, pipeline.sceneRT.width, pipeline.compRT.width, pipeline.aaRT.width, pipeline.bloomA.width], [1, 1, 1, 1, 1, 1]);
  assert.ok(dormant.estimatedAttachmentBytes < active.estimatedAttachmentBytes * 0.001);

  assert.equal(pipeline.resume(), true);
  assert.equal(pipeline.resume(), false);
  pipeline.resize(1920, 1080);
  const restored = pipeline.memoryStats();
  assert.equal(restored.dormant, false);
  assert.equal(restored.estimatedAttachmentBytes, active.estimatedAttachmentBytes);
});
