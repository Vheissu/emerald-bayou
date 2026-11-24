import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildDockGear, createCreelFish, setCreelFish, setDockCatch, TOTE_HANDLES } from '../src/skiffdockgear.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';

test('the line, cooler and catch pan share retained fish geometry without sharing inventory', () => {
  const berth = COVE_MOORINGS[0];
  const gear = buildDockGear({ berth }, 0, new THREE.Group());
  const lineFish = createCreelFish();
  assert.equal(lineFish.children[0].geometry, gear.contents.children[0].geometry);
  for (let index = 0; index < 3; index++) {
    assert.equal(gear.contents.children[index].geometry, gear.landedFish.children[index].geometry);
  }
  const lineBounds = new THREE.Box3().setFromObject(lineFish);
  assert.ok(Math.abs(lineBounds.max.y) < 0.01 && lineBounds.min.y < -0.34);
  assert.ok(gear.panPoint.x > gear.bench.position.x + TOTE_HANDLES[1].x);
  assert.ok(gear.panPoint.distanceTo(gear.bench.localToWorld(gear.landedFish.position.clone())) < 0.00001);

  setDockCatch(gear, 4, 0.65, 0);
  assert.equal(gear.contents.children[0].count, 4);
  assert.equal(gear.landedFish.visible, false);
  assert.ok(gear.lid.rotation.x * berth.side > 1);
  setDockCatch(gear, 1, 1, 3, ['trout', 'redfish', 'mullet'], ['redfish']);
  assert.deepEqual(gear.contents.children.map(species => species.count), [0, 1, 0]);
  assert.deepEqual(gear.landedFish.children.map(species => species.count), [1, 1, 1]);
  setCreelFish(lineFish, 'redfish');
  assert.equal(lineFish.children[0].geometry, gear.contents.children[1].geometry);
  assert.equal(gear.landedFish.visible, true);
  setDockCatch(gear, 0, 0, 4);
  assert.equal(gear.contents.visible, false);
  assert.equal(gear.landedFish.children[0].count, 4);
  assert.equal(gear.lid.rotation.x + 0, 0);
});
