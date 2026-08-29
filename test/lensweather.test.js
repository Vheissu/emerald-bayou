import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lensWetnessStep, Pipeline } from '../src/post.js';
import { qualityProfile } from '../src/renderquality.js';

test('rain and water impacts wet the chase lens while speed and wind clear it', () => {
  let wetness = 0;
  for (let i = 0; i < 180; i++) wetness = lensWetnessStep(wetness, { rain: 1, dt: 1 / 60 });
  assert.ok(wetness > 0.97);

  const calm = lensWetnessStep(1, { dt: 0.25 });
  const running = lensWetnessStep(1, { wind: 18, speed: 14, dt: 0.25 });
  assert.ok(running < calm);
  assert.ok(lensWetnessStep(0.05, { splash: 1, dt: 1 / 60 }) > 0.69);
  assert.equal(lensWetnessStep(-4, { dt: 1 }), 0);
  assert.ok(lensWetnessStep(8, { rain: 1, dt: 1 }) > 0.99);
});

test('lens water is reserved for balanced and cinematic presentation', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).lensWater), [0, 0, 0.62, 1]);
});

test('lens water reuses the grade pass without another texture sample or attachment', () => {
  const renderer = { getDrawingBufferSize: target => target.set(1600, 900) };
  const pipeline = new Pipeline(renderer, new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 7500), qualityProfile(3));
  const before = pipeline.memoryStats(), shader = pipeline.grade.material.fragmentShader;
  assert.equal((shader.match(/texture2D\(tColor/g) || []).length, 1);
  assert.match(shader, /lensDropLayer/);

  for (let i = 0; i < 12; i++) pipeline.updateLensWeather(i * 0.25, { rain: 1, windScreen: -0.7, dt: 0.25 });
  const after = pipeline.memoryStats(), uniforms = pipeline.grade.material.uniforms;
  assert.ok(after.lensWetness > 0.97);
  assert.equal(uniforms.lensWind.value, -0.7);
  assert.equal(uniforms.lensTime.value, 2.75);
  assert.equal(after.estimatedAttachmentBytes, before.estimatedAttachmentBytes);
  assert.equal(after.lensWater, 1);

  pipeline.setQuality(qualityProfile(1));
  assert.equal(uniforms.lensQuality.value, 0);
});
