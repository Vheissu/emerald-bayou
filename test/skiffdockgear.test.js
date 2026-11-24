import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildDockGear, createCreelFish, setDockCatch, TOTE_HANDLES } from '../src/skiffdockgear.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';

test('the line, cooler and catch pan share retained fish geometry without sharing inventory', () => {
  const berth = COVE_MOORINGS[0];
  const gear = buildDockGear({ berth }, 0, new THREE.Group());
  const lineFish = createCreelFish();
  assert.equal(lineFish.children[0].geometry, gear.contents.geometry);
  assert.equal(gear.contents.geometry, gear.landedFish.geometry);
  const lineBounds = new THREE.Box3().setFromObject(lineFish);
  assert.ok(Math.abs(lineBounds.max.y) < 0.01 && lineBounds.min.y < -0.34);
  assert.ok(gear.panPoint.x > gear.bench.position.x + TOTE_HANDLES[1].x);
  assert.ok(gear.panPoint.distanceTo(gear.bench.localToWorld(gear.landedFish.position.clone())) < 0.00001);

  setDockCatch(gear, 4, 0.65, 0);
  assert.equal(gear.contents.count, 4);
  assert.equal(gear.landedFish.visible, false);
  assert.ok(gear.lid.rotation.x * berth.side > 1);
  setDockCatch(gear, 1, 1, 3);
  assert.equal(gear.contents.count + gear.landedFish.count, 4);
  assert.equal(gear.landedFish.visible, true);
  setDockCatch(gear, 0, 0, 4);
  assert.equal(gear.contents.visible, false);
  assert.equal(gear.landedFish.count, 4);
  assert.equal(gear.lid.rotation.x + 0, 0);
});
