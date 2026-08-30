import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FIREFLY_CAPACITY,
  NocturnalWetland,
  fireflyActivity,
  fireflyDisturbance,
} from '../src/nocturnal.js';

test('bank firefly activity follows darkness, wet habitat and safe weather', () => {
  const calmDusk = { hour: 20.15, wind: 2, rain: 0, storm: 0, fog: 0.001, regionId: 'cypress' };
  const dusk = fireflyActivity(calmDusk);
  assert.ok(dusk > 0.8);
  assert.equal(fireflyActivity({ ...calmDusk, hour: 13 }), 0);
  assert.equal(fireflyActivity({ ...calmDusk, wind: 18 }), 0);
  assert.equal(fireflyActivity({ ...calmDusk, rain: 1 }), 0);
  assert.equal(fireflyActivity({ ...calmDusk, storm: 1 }), 0);
  assert.ok(fireflyActivity({ ...calmDusk, regionId: 'mangrove' }) > fireflyActivity({ ...calmDusk, regionId: 'broad' }) * 3);
  assert.ok(fireflyActivity({ ...calmDusk, hour: 23.5 }) < dusk * 0.25);
  const moonlit = fireflyActivity({ ...calmDusk, moonlight: 1 });
  assert.ok(moonlit > dusk * 0.5 && moonlit < dusk * 0.65);
});

test('engine wash and the bow spotlight disturb only nearby illuminated insects', () => {
  assert.equal(fireflyDisturbance({ distance: 25, speed: 0, spotlight: false }), 1);
  assert.ok(fireflyDisturbance({ distance: 20, speed: 10, spotlight: false }) < 0.45);
  assert.equal(fireflyDisturbance({ distance: 100, speed: 10, spotlight: false }), 1);
  assert.ok(fireflyDisturbance({ distance: 40, speed: 0, spotlight: true, coneDot: 1 }) < 0.35);
  assert.equal(fireflyDisturbance({ distance: 40, speed: 0, spotlight: true, coneDot: 0 }), 1);
});

test('the nocturnal display is deterministic and stays inside one fixed point resource', () => {
  const scene = new THREE.Scene(), heard = [];
  const phys = {
    pos: new THREE.Vector2(20, -120), heading: 0, speed: 0,
    forward(out) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); },
  };
  const environment = {
    waterLevel: 0, hour: 20.15, gust: 1, restrictedVisibility: 0, spotOn: false, moonlight: 0,
    windDir: new THREE.Vector3(1, 0, 0), values: { wind: 2, rain: 0, storm: 0, fog: 0.001 },
  };
  const wetland = new NocturnalWetland({
    scene, phys, environment,
    terrain: { heightAt: () => 0.25 }, world: { blockedAt: () => false },
    regions: { current: { id: 'cypress' } }, audio: { nightLife(value) { heard.push(value); } },
    profile: { fireflyPoints: FIREFLY_CAPACITY }, regionAtFn: () => ({ id: 'cypress' }),
  });

  wetland.update(1 / 60, 1, true);
  const retainedArrays = [wetland.positions, wetland.phase, wetland.rate, wetland.size, wetland.pattern, wetland.habitat];
  const firstStats = wetland.resourceStats(), firstPositions = Array.from(wetland.positions.slice(0, wetland.valid * 3));
  assert.ok(firstStats.valid > 200 && firstStats.valid <= FIREFLY_CAPACITY);
  assert.deepEqual({ geometries: firstStats.geometries, materials: firstStats.materials, attributes: firstStats.attributes, drawCalls: firstStats.drawCalls }, { geometries: 1, materials: 1, attributes: 6, drawCalls: 1 });
  assert.equal(firstStats.geometryBytes, FIREFLY_CAPACITY * 8 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(wetland.points.layers.mask, 2);
  assert.ok(heard.at(-1) > 0);

  wetland.rebuild(true);
  assert.deepEqual(Array.from(wetland.positions.slice(0, wetland.valid * 3)), firstPositions);
  assert.deepEqual({ geometries: wetland.resourceStats().geometries, materials: wetland.resourceStats().materials, geometryBytes: wetland.resourceStats().geometryBytes }, { geometries: 1, materials: 1, geometryBytes: firstStats.geometryBytes });

  phys.pos.x += 40;
  wetland.update(1 / 60, 2, true);
  assert.deepEqual([wetland.positions, wetland.phase, wetland.rate, wetland.size, wetland.pattern, wetland.habitat], retainedArrays);
  assert.equal(wetland.resourceStats().geometryBytes, firstStats.geometryBytes);

  wetland.setQuality({ fireflyPoints: 72 });
  assert.equal(wetland.resourceStats().drawCount, 72);
  wetland.setQuality({ fireflyPoints: 0 });
  assert.equal(wetland.resourceStats().drawCalls, 0);
  wetland.dispose();
  assert.equal(scene.children.length, 0);
});
