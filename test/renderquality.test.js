import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityController, environmentMapBudget, gpuQualityCeiling, initialQualityLevel, msaaSamplesFor, pixelRatioFor, qualityProfile, webglRendererName } from '../src/renderquality.js';
import { WAKE_SIZE, Water } from '../src/water.js';

test('caps dense displays by drawing-pixel budget', () => {
  assert.equal(pixelRatioFor(1000, 1000, 2), Math.sqrt(3));
  assert.equal(pixelRatioFor(1920, 1080, 1), 1);
  assert.ok(pixelRatioFor(3840, 2160, 2, qualityProfile(1).maxDrawPixels, qualityProfile(1).maxDevicePixelRatio) < 0.4);
});

test('starts conservatively only when hardware signals justify it', () => {
  assert.equal(initialQualityLevel({ deviceMemory: 16, hardwareConcurrency: 12, maxTextureSize: 16384 }), 3);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 12, maxTextureSize: 16384 }), 3);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 8, maxTextureSize: 16384 }), 2);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 8, maxTextureSize: 16384, gpuRenderer: 'ANGLE (NVIDIA, GeForce RTX 4070 Direct3D11)' }), 3);
  assert.equal(initialQualityLevel({ deviceMemory: 8, hardwareConcurrency: 6, maxTextureSize: 16384 }), 2);
  assert.equal(initialQualityLevel({ deviceMemory: 4, hardwareConcurrency: 8, maxTextureSize: 16384 }), 1);
  assert.equal(initialQualityLevel({ saveData: true }), 0);
});

test('caps known old and software GPUs without penalizing modern discrete renderers', () => {
  assert.equal(gpuQualityCeiling('ANGLE (Intel, Intel(R) HD Graphics 5000 OpenGL Engine)'), 1);
  assert.equal(gpuQualityCeiling('Intel(R) UHD Graphics 630'), 2);
  assert.equal(gpuQualityCeiling('ANGLE (NVIDIA, GeForce GTX 960 Direct3D11)'), 2);
  assert.equal(gpuQualityCeiling('ANGLE (NVIDIA, GeForce RTX 4070 Direct3D11)'), 3);
  assert.equal(gpuQualityCeiling('Google SwiftShader'), 0);
  assert.equal(initialQualityLevel({ deviceMemory: 16, hardwareConcurrency: 12, maxTextureSize: 16384, gpuRenderer: 'Intel Iris Pro 5200' }), 1);
});

test('reads the unmasked renderer when available and fails closed to no name', () => {
  const gl = { RENDERER: 1, getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }), getParameter: key => key === 2 ? 'Intel HD Graphics 4000' : 'WebGL' };
  assert.equal(webglRendererName(gl), 'Intel HD Graphics 4000');
  assert.equal(webglRendererName({ getExtension: () => { throw new Error('blocked'); } }), '');
});

test('removes multisample attachments on performance profiles', () => {
  assert.equal(msaaSamplesFor(1200, 800, 0), 0);
  assert.equal(msaaSamplesFor(1200, 800, 2), 2);
  assert.equal(msaaSamplesFor(2000, 1000, 4), 2);
});

test('scales startup environment convolution while preserving the cinematic map', () => {
  const sizes = [0, 1, 2, 3].map(level => qualityProfile(level).environmentMapSize);
  assert.deepEqual(sizes, [32, 64, 128, 256]);
  const fallback = environmentMapBudget(sizes[0]), performance = environmentMapBudget(sizes[1]), cinematic = environmentMapBudget(sizes[3]);
  assert.deepEqual(cinematic, {
    cubeSize: 256, width: 768, height: 1024, pixels: 786432, colorBytes: 6291456, depthBytes: 3145728,
    retainedBytes: 9437184, peakTargetBytes: 15728640,
  });
  assert.equal(performance.retainedBytes, 1032192);
  assert.ok(performance.retainedBytes < cinematic.retainedBytes * 0.11);
  assert.ok(fallback.peakTargetBytes < cinematic.peakTargetBytes * 0.055);
});

test('keeps dynamic sky convolution off old hardware and infrequent on high-end tiers', () => {
  const refresh = [0, 1, 2, 3].map(level => qualityProfile(level).environmentMapRefreshSeconds);
  assert.deepEqual(refresh, [0, 0, 75, 45]);
  assert.ok(refresh[2] > refresh[3]);
});

test('scales distant storm-sky detail without changing world simulation', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).skyWeatherDetail), [0, 0.45, 0.75, 1]);
});

test('disables hull-scar shader work on fallback and scales it above that tier', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).hullDamageDetail), [0, 0.5, 0.78, 1]);
});

test('scales wake simulation cost without shrinking its world-space footprint', () => {
  const fallback = qualityProfile(0), performance = qualityProfile(1), balanced = qualityProfile(2), cinematic = qualityProfile(3);
  assert.deepEqual(
    [fallback.wakeResolution, performance.wakeResolution, balanced.wakeResolution, cinematic.wakeResolution],
    [192, 256, 384, 512],
  );
  assert.deepEqual(
    [fallback.wakeMaxStamps, performance.wakeMaxStamps, balanced.wakeMaxStamps, cinematic.wakeMaxStamps],
    [10, 14, 18, 20],
  );
  assert.equal(WAKE_SIZE, 150);
  assert.ok(fallback.wakeResolution ** 2 < cinematic.wakeResolution ** 2 * 0.15);
});

test('bounds rebuildable radar history by graphics tier without changing map scale', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).minimapTileLimit), [160, 192, 224, 256]);
});

test('keeps the atmospheric mist shader off the two old-hardware profiles', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).surfaceMist), [0, 0, 0.65, 1]);
});

test('reserves refractive heat haze for balanced and cinematic hardware', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).heatHaze), [0, 0, 0.58, 1]);
});

test('reserves moving cloud shadows for balanced and cinematic hardware', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).cloudShadows), [0, 0, 0.58, 1]);
});

test('reserves procedural precipitation impacts for balanced and cinematic water', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).precipitationRipples), [0, 0, 0.62, 1]);
});

test('scales the nocturnal point draw down to zero on fallback hardware', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).fireflyPoints), [0, 72, 153, 243]);
});

test('keeps the atmospheric spotlight off fallback hardware and scales one retained draw above it', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).spotlightVolume), [0, 0.42, 0.75, 1]);
});

test('passes rain and hail conditions into the existing water surface uniforms', () => {
  const water = Object.create(Water.prototype);
  Object.assign(water, { level: 0, seaState: 0, windAngle: 0, rain: 0, hail: 0, windSpeed: 0 });
  water.uniforms = {
    seaState: { value: 0 }, weatherWind: { value: { set(x, y) { this.x = x; this.y = y; } } },
    rainAmount: { value: 0 }, hailAmount: { value: 0 },
  };

  water.setConditions({ level: 0.4, seaState: 0.9, windAngle: Math.PI / 2, rain: 0.78, hail: 1, wind: 20 });

  assert.equal(water.level, 0.4);
  assert.equal(water.uniforms.rainAmount.value, 0.78);
  assert.equal(water.uniforms.hailAmount.value, 1);
  assert.ok(Math.abs(water.uniforms.weatherWind.value.x) < 1e-12);
  assert.equal(water.uniforms.weatherWind.value.y, 1);
});

test('background hibernation releases reflection and wake targets without changing world scale', () => {
  const renderer = { getDrawingBufferSize: target => target.set(1920, 1080) };
  const profile = qualityProfile(3), water = new Water(renderer, { clone: () => ({ normalize() { return this; } }) }, profile);
  const active = water.memoryStats();

  assert.equal(water.hibernate(), true);
  assert.equal(water.hibernate(), false);
  const dormant = water.memoryStats();
  assert.equal(dormant.dormant, true);
  assert.deepEqual([dormant.width, dormant.height, dormant.wakeWidth, dormant.wakeHeight], [1, 1, 1, 1]);
  assert.equal(dormant.wakeResolution, profile.wakeResolution);
  assert.ok(dormant.estimatedAttachmentBytes < active.estimatedAttachmentBytes * 0.001);

  assert.equal(water.resume(), true);
  assert.equal(water.resume(), false);
  water.resize(1920, 1080);
  const restored = water.memoryStats();
  assert.equal(restored.dormant, false);
  assert.equal(restored.estimatedAttachmentBytes, active.estimatedAttachmentBytes);
  assert.equal(WAKE_SIZE, 150);
});

test('steps down on sustained missed frames and ignores a background pause', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 3, sampleSeconds: 1 });
  let change = null;
  for (let i = 0; i < 32; i++) change ||= quality.observe(1 / 30, true);
  assert.equal(change?.profile.id, 'balanced');
  assert.equal(quality.observe(1, true), null);
  assert.equal(quality.profile.id, 'balanced');
});

test('reacts to repeated foreground stalls without treating one pause as pressure', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 3, sampleSeconds: 1 });
  assert.equal(quality.observe(0.3, true), null);
  assert.equal(quality.observe(1 / 60, true), null);
  assert.equal(quality.profile.id, 'cinematic');
  quality.observe(0.3, true);
  const change = quality.observe(0.3, true);
  assert.equal(change?.profile.id, 'balanced');
  assert.equal(change?.emergency, true);
  assert.equal(change?.stallFrames, 3);
});

test('drops emergency quality within four consecutive sub-20-fps frames', () => {
  const quality = new AdaptiveQualityController({ initialLevel: 2 });
  let change = null;
  for (let i = 0; i < 4; i++) change ||= quality.observe(1 / 15, true);
  assert.equal(change?.profile.id, 'performance');
  assert.equal(change?.emergency, true);
  assert.equal(change?.averageMs, 1000 / 15);
  assert.equal(quality.snapshot().lastSample?.frames, 4);
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
