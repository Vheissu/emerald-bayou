import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentReflectionSignature, SkyEnvironmentMap } from '../src/environmentmap.js';
import { qualityProfile } from '../src/renderquality.js';

test('reflection signatures follow broad solar, cloud and storm lighting instead of frame noise', () => {
  assert.equal(environmentReflectionSignature({ hour: 2, sunAltitude: -0.6, storm: 0, cover: 0.49 }), 'night:broken:calm');
  assert.equal(environmentReflectionSignature({ hour: 6.2, sunAltitude: 0.03, storm: 0, cover: 0.49 }), 'dawn:broken:calm');
  assert.equal(environmentReflectionSignature({ hour: 18.2, sunAltitude: 0.03, storm: 0.7, cover: 0.22 }), 'dusk:closed:severe');
  assert.equal(environmentReflectionSignature({ hour: 12, sunAltitude: 0.95, storm: 0.3, cover: 0.4 }), 'noon:overcast:storm');
});

test('old-hardware tiers keep static PMREMs while higher tiers refresh on meaningful state changes', () => {
  assert.deepEqual([0, 1, 2, 3].map(level => qualityProfile(level).environmentMapRefreshSeconds), [0, 0, 75, 45]);
  const targets = [], scene = { environment: null }, uniforms = { flash: { value: 0.8 }, rainbow: { value: 0.6 } };
  let now = 1000;
  const maps = new SkyEnvironmentMap({
    renderer: {}, scene, skyScene: {}, skyUniforms: uniforms, profile: qualityProfile(1), now: () => now,
    targetFactory(renderer, skyScene, size) {
      const target = { texture: { size }, disposed: false, dispose() { this.disposed = true; } }; targets.push(target); return target;
    },
  });
  const day = { hour: 12, sunAltitude: 0.9, storm: 0, cover: 0.49 }, night = { hour: 1, sunAltitude: -0.8, storm: 0, cover: 0.49 };
  assert.equal(maps.capture(day, 'initial', now), true);
  now += 600_000;
  assert.equal(maps.needsRefresh(night, now), false);
  maps.setProfile(qualityProfile(2));
  assert.equal(maps.needsRefresh(night, now), true);
  assert.equal(maps.capture(night, 'quality', now), true);
  assert.equal(targets[0].disposed, true);
  assert.equal(scene.environment, targets[1].texture);
  assert.equal(uniforms.flash.value, 0.8);
  assert.equal(uniforms.rainbow.value, 0.6);
});

test('replacement releases the prior target before allocating the next and restores transient sky uniforms', () => {
  const scene = { environment: null }, flash = { value: 0.7 }, rainbow = { value: 0.4 }, order = [];
  let now = 0, previous = null;
  const maps = new SkyEnvironmentMap({
    renderer: {}, scene, skyScene: {}, skyUniforms: { flash, rainbow }, profile: qualityProfile(3), now: () => now,
    targetFactory(renderer, skyScene, size) {
      assert.equal(scene.environment, null);
      if (previous) assert.equal(previous.disposed, true);
      assert.equal(flash.value, 0); assert.equal(rainbow.value, 0);
      const target = { texture: { size }, disposed: false, dispose() { this.disposed = true; order.push('dispose'); } };
      previous = target; order.push(`allocate:${size}`); return target;
    },
  });
  const afternoon = { hour: 15, sunAltitude: 0.7, storm: 0, cover: 0.49 };
  assert.equal(maps.capture(afternoon, 'initial', now), true);
  now += 46_000;
  assert.equal(maps.needsRefresh({ ...afternoon, storm: 0.8, cover: 0.2 }, now), true);
  assert.equal(maps.capture({ ...afternoon, storm: 0.8, cover: 0.2 }, 'atmosphere', now), true);
  assert.deepEqual(order, ['allocate:256', 'dispose', 'allocate:256']);
  assert.deepEqual({ flash: flash.value, rainbow: rainbow.value }, { flash: 0.7, rainbow: 0.4 });
  const stats = maps.resourceStats();
  assert.equal(stats.captures, 2); assert.equal(stats.replacements, 1); assert.equal(stats.disposals, 1);
  assert.equal(stats.retainedBytes, 9_437_184);
  assert.equal(maps.dispose(), true); assert.equal(maps.dispose(), false);
  assert.equal(maps.resourceStats().retainedBytes, 0);
  assert.equal(maps.needsRefresh(afternoon, now), true);
});

test('a failed replacement leaves no stale or malformed target retained', () => {
  const scene = { environment: null };
  let fail = false, malformedDisposed = false;
  const maps = new SkyEnvironmentMap({
    renderer: {}, scene, skyScene: {}, skyUniforms: {}, profile: qualityProfile(2), now: () => 10,
    targetFactory() {
      if (!fail) return { texture: {}, dispose() {} };
      return { texture: null, dispose() { malformedDisposed = true; } };
    },
  });
  assert.equal(maps.capture({}, 'initial', 10), true);
  fail = true;
  assert.equal(maps.capture({}, 'replacement', 80_000), false);
  assert.equal(malformedDisposed, true);
  assert.equal(scene.environment, null);
  assert.equal(maps.resourceStats().retainedBytes, 0);
  assert.match(maps.lastError, /no render target/);
});
