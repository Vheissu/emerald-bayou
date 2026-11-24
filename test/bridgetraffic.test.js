import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { bridgeTrafficConditions, bridgeTrafficPose, buildBridgeTraffic, moveBridgeTraffic } from '../src/bridgetraffic.js';
import { WorldHeight } from '../src/heightfield.js';
import { bridgeDeckAt, bridgeZAt, GULF_CUT } from '../src/waterfrontlayout.js';

test('traffic keeps its lane and follows the bridge crown in both directions', () => {
  const { west, east } = GULF_CUT;
  const [dry, wet] = [bridgeTrafficConditions(0, 0, 0), bridgeTrafficConditions(0, 0.65, 0.8)];
  assert.equal(dry.speed, 1);
  assert.ok(wet.speed < dry.speed && wet.lights > dry.lights);
  assert.ok(bridgeTrafficConditions(1, 0, 0).lights > wet.lights);
  const group = new Group(), vehicles = buildBridgeTraffic(group);
  assert.equal(vehicles.length, 4);
  assert.equal(group.getObjectsByProperty('isLight', true).length, 0);
  for (const vehicle of vehicles) {
    assert.equal(vehicle.model.children.length, 3);
    assert.ok(vehicle.model.children.every(mesh => mesh.geometry.index.count > 0));
    for (let second = 0; second < 80; second += 0.25) {
      const pose = bridgeTrafficPose(vehicle, second);
      assert.ok(pose.x > west - 13 && pose.x < east + 22);
      assert.equal(pose.z > bridgeZAt(pose.x), vehicle.direction > 0);
      assert.ok(Math.abs(pose.pitch) < 0.17);
      assert.ok(pose.y > bridgeDeckAt(pose.x));
    }
  }
  for (let second = 0; second < 80; second += 0.25) {
    const poses = vehicles.map(car => bridgeTrafficPose(car, second));
    assert.ok(Math.abs(poses[0].x - poses[1].x) > 40);
    assert.ok(Math.abs(poses[2].x - poses[3].x) > 40);
  }
  const bridge = { vehicles };
  moveBridgeTraffic(bridge, 5, 0, {});
  assert.equal(bridge.trafficClock, 5);
  moveBridgeTraffic(bridge, 7, 0, { sampleRainAt: () => 1, restrictedVisibility: 1 });
  assert.ok(bridge.trafficClock < 7 && bridge.trafficClock > 6);
  assert.ok(vehicles[0].model.children[2].material.emissiveIntensity > 3);
});

test('the graded roadside approaches clear both lanes while the shipping channel retains its natural depth', () => {
  const terrain = new WorldHeight(7);
  const { west, east, x, z } = GULF_CUT;
  for (const [from, to] of [[west - 6, west + 26], [east - 18, east + 9]]) {
    for (let distance = from; distance <= to; distance += 0.4) {
      for (const lane of [-3.8, -2, 0, 2, 3.8]) {
        const surface = bridgeDeckAt(distance);
        assert.ok(surface - terrain.compute(distance, bridgeZAt(distance) + lane) > 0.16, 'road surface must clear the approach');
      }
    }
  }
  assert.equal(terrain.compute(x, z), terrain.withSandbars(x, z, terrain.computeBase(x, z).h));
  assert.equal(terrain.compute(west + 8, -68), terrain.withSandbars(west + 8, -68, terrain.computeBase(west + 8, -68).h));
});
