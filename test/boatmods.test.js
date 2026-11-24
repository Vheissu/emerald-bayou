import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirboatPhysics } from '../src/airboat.js';
import { boatFloodRate } from '../src/boatdamage.js';
import { boatPaint, BOAT_PART_GROUPS, boatTuning, fitBoatPart, normalizeBoatParts, STOCK_BOAT_TUNING } from '../src/boatmods.js';
import { installAirboatLivery, setAirboatLivery } from '../src/airboatlivery.js';
import { HullDamageMaterial } from '../src/hulldamage.js';
import { Game } from '../src/game.js';

test('migrates old balances and preserves only valid owned, correctly slotted installed parts', () => {
  const cache = new Map([
    ['emeraldBayou.save.v1', JSON.stringify({ cash: 620, best: { sprint: { time: 72 } }, done: ['sprint'] })],
  ]);
  const localStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => cache.get(key) || null };
  try {
    const legacy = Game.prototype.load();
    assert.equal(legacy.cash, 620);
    assert.deepEqual(legacy.done, ['sprint']);
    assert.deepEqual(boatTuning(legacy.boatParts), STOCK_BOAT_TUNING);
    cache.set('emeraldBayou.save.v2', JSON.stringify({
      ...legacy,
      boatParts: {
        owned: ['torque-cam', 'torque-cam', 'missing', 'range-tank'],
        installed: { engine: 'torque-cam', hull: 'range-tank', tank: 'expedition-tank' },
      },
    }));
    const restored = Game.prototype.load();
    assert.deepEqual(restored.boatParts, { owned: ['torque-cam', 'range-tank'], installed: { engine: 'torque-cam' } });
    assert.equal(boatTuning(restored.boatParts).thrust, 1.13);
  } finally {
    if (localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = localStorage;
  }
});

test('the berth charges once, keeps ownership across fittings and prevents lost fuel when downsizing', () => {
  const save = { cash: 500 };
  const fit = (slot, id, docked = true, fuel = 12) => fitBoatPart(save, { slot, id, docked, fuel });
  assert.equal(BOAT_PART_GROUPS.filter(slot => slot.id !== 'livery').flatMap(slot => slot.parts).length, 14);
  assert.equal(fit('engine', 'torque-cam', false).status, 'away');
  assert.equal(fit('engine', 'range-tank').status, 'invalid');
  assert.deepEqual(fit('engine', 'blueprinted'), { status: 'funds', needed: 190 });
  assert.equal(save.cash, 500);
  assert.deepEqual(fit('tank', 'range-tank'), { status: 'fitted', name: '24 gal tanks', price: 205 });
  assert.equal(save.cash, 295);
  assert.equal(fit('tank', 'range-tank').status, 'installed');
  assert.deepEqual(fit('tank', 'stock', true, 22), { status: 'fuel', capacity: 18 });
  assert.equal(boatTuning(save.boatParts).capacity, 24);
  assert.equal(fit('tank', 'stock').price, 0);
  assert.equal(boatTuning(save.boatParts).capacity, 18);
  assert.equal(fit('tank', 'range-tank').price, 0);
  assert.equal(save.cash, 295);
});

test('purchased livery fits both sides through the damage shader and survives serialization', () => {
  const save = { cash: 180 };
  const options = { slot: 'livery', id: 'copper-reef', docked: true };
  assert.equal(fitBoatPart(save, options).price, 110);
  const parts = normalizeBoatParts(JSON.parse(JSON.stringify(save.boatParts)));
  assert.deepEqual(boatPaint(parts), [0xa3442c, 0xe5d9c2]);
  assert.deepEqual(boatTuning(parts), STOCK_BOAT_TUNING);
  const group = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  hull.name = 'airboat hull';
  group.add(hull);
  new HullDamageMaterial(material, { hullDamageDetail: 1 });
  const paint = installAirboatLivery(material);
  setAirboatLivery(group, boatPaint(parts));
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <metalnessmap_fragment>',
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uLiveryEnabled.value, 1);
  assert.equal(paint.base.value.getHex(), 0xa3442c);
  assert.match(shader.vertexShader, /abs\(normal\.x\)/);
  assert.match(shader.fragmentShader, /paintCover.*[\s\S]*hullScarMetal/);
  assert.equal(fitBoatPart(save, { ...options, id: 'stock' }).price, 0);
  setAirboatLivery(group, boatPaint(save.boatParts));
  assert.equal(shader.uniforms.uLiveryEnabled.value, 0);
  assert.equal(fitBoatPart(save, options).price, 0);
  assert.equal(save.cash, 70);
  hull.geometry.dispose();
  material.dispose();
});

test('installed parts change the actual boat simulation and a powered pump removes more water', () => {
  const terrain = { heightAt: () => -5, gradAt: (_x, _z, out) => out.set(0, 0) };
  const stock = new AirboatPhysics(terrain), tuned = new AirboatPhysics(terrain);
  tuned.tuning = boatTuning(normalizeBoatParts({
    owned: ['torque-cam', 'deep-rudders', 'high-flow'],
    installed: { engine: 'torque-cam', steering: 'deep-rudders', bilge: 'high-flow' },
  }));
  const dt = 1 / 60, straight = { throttle: 1, steer: 0, pitch: 0 };
  for (let i = 0; i < 350; i++) {
    stock.update(dt, straight, () => 0, i * dt);
    tuned.update(dt, straight, () => 0, i * dt);
  }
  assert.ok(tuned.speed > stock.speed * 1.05);
  const turn = { ...straight, steer: 1 };
  for (let i = 0; i < 70; i++) {
    stock.update(dt, turn, () => 0, i * dt);
    tuned.update(dt, turn, () => 0, i * dt);
  }
  assert.ok(tuned.heading > stock.heading * 1.1);
  assert.ok(boatFloodRate(90, 0.07, 0.2, 1, true, tuned.tuning.pump) < boatFloodRate(90, 0.07, 0.2, 1, true));
  assert.equal(boatFloodRate(90, 0.07, 0.2, 1, false, tuned.tuning.pump), boatFloodRate(90, 0.07, 0.2, 1, false));
});
