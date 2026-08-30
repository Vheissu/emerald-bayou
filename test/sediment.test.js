import test from 'node:test';
import assert from 'node:assert/strict';
import { sedimentPlumeRadius, shallowWaterSediment } from '../src/sediment.js';

test('shallow running boats lift more sediment than slow boats in deep water', () => {
  const shallow = shallowWaterSediment({ depth: 0.9, speed: 10, rpm: 0.9, throttle: 0.85, wet: 1, murk: 0.4 });
  const slow = shallowWaterSediment({ depth: 0.9, speed: 1, rpm: 0.24, throttle: 0.08, wet: 1, murk: 0.4 });
  const deep = shallowWaterSediment({ depth: 2.45, speed: 10, rpm: 0.9, throttle: 0.85, wet: 1, murk: 0.4 });
  assert.ok(shallow > 0.35);
  assert.ok(shallow > slow * 4);
  assert.ok(shallow > deep * 8);
});

test('sediment stops out of water, at idle, and beyond bed reach', () => {
  assert.equal(shallowWaterSediment({ depth: 0.8, speed: 12, rpm: 1, throttle: 1, wet: 0, murk: 1 }), 0);
  assert.equal(shallowWaterSediment({ depth: 0.8, speed: 0, rpm: 0.18, throttle: 0, wet: 1, murk: 1 }), 0);
  assert.equal(shallowWaterSediment({ depth: 3.2, speed: 12, rpm: 1, throttle: 1, wet: 1, murk: 1 }), 0);
});

test('tannin backwaters suspend more soft material and fast wash spreads wider', () => {
  const clear = shallowWaterSediment({ depth: 1.05, speed: 8, rpm: 0.8, throttle: 0.7, wet: 1, murk: 0 });
  const tannin = shallowWaterSediment({ depth: 1.05, speed: 8, rpm: 0.8, throttle: 0.7, wet: 1, murk: 1 });
  assert.ok(tannin > clear * 1.7);
  assert.ok(sedimentPlumeRadius(0.8, 13) > sedimentPlumeRadius(1.8, 2));
  assert.ok(sedimentPlumeRadius(0.8, 13) <= 3.7);
});
