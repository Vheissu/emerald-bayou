import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildCatchFreight, buildTradeTote, setTradeTote, updateCatchFreight } from '../src/catchfreight.js';
import { buildCatchCooler } from '../src/skiffdockgear.js';

test('freight stays fixed on the starboard deck and closes for transit', () => {
  const boat = new THREE.Group();
  boat.position.set(13.6, 0.25, -33);
  boat.rotation.set(0.08, Math.PI / 3, 0.13);
  const freight = buildCatchFreight(boat);
  const { group, tote } = freight;
  const ice = tote.getObjectByName('Mullet on ice');
  const lid = tote.getObjectByName('Cooler lid');
  const stock = { source: 'gulf-north', count: 3 };

  assert.equal(group.visible, false);
  assert.equal(group.parent, boat);
  updateCatchFreight(freight, stock, 1);
  assert.equal(group.visible, true);
  assert.equal(ice.count, 3);
  assert.ok(lid.rotation.x > 1.6);
  const bounds = new THREE.Box3().setFromObject(group);
  assert.equal(bounds.isEmpty(), false);
  assert.ok(bounds.max.y < 2.5);

  updateCatchFreight(freight, stock, 1, { speed: 8 });
  assert.ok(lid.rotation.x < 0.01);
  updateCatchFreight(freight, stock, 1);
  assert.ok(lid.rotation.x < 0.01, 'the moving load stays latched through a brief stop');
  updateCatchFreight(freight, stock, 1, { inspect: true });
  assert.ok(lid.rotation.x > 1.6);

  updateCatchFreight(freight, null, 0);
  assert.equal(group.visible, false);
  assert.equal(ice.count, 0);
  assert.equal(group.getObjectByName('Freight tie-downs').visible, true);
});

test('the receiving tote shares the existing cooler mesh and has separate inventory', () => {
  const receiver = buildTradeTote();
  const { cooler, contents } = buildCatchCooler();
  setTradeTote(receiver, 2);
  assert.equal(receiver.geometry, cooler.geometry);
  assert.equal(receiver.getObjectByName('Mullet on ice').geometry, contents.children[0].geometry);
  assert.equal(receiver.getObjectByName('Mullet on ice').count, 2);
  assert.equal(contents.children[0].count, 0);
});

test('the fixed ice chest carries eight distinct fish and stays visible empty', () => {
  const freight = buildCatchFreight(new THREE.Group());
  const setup = { capacity: 8 };
  updateCatchFreight(freight, null, 0, setup);
  assert.equal(freight.group.visible, true);
  assert.equal(freight.tote.visible, false);
  assert.equal(freight.iceChest.visible, true);
  assert.equal(freight.iceChest.getObjectByName('Cooler lid').rotation.x + 0, 0);

  updateCatchFreight(freight, { count: 8, items: { mullet: 3, redfish: 2, trout: 3 } }, 1, setup);
  const fish = freight.iceChest.getObjectByName('Catch on ice').children;
  assert.deepEqual(fish.map(species => species.count), [3, 2, 3]);
  assert.equal(new Set(fish.map(species => species.geometry)).size, 3);
  const bedWidth = mesh => new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).getSize(new THREE.Vector3());
  assert.ok(bedWidth(freight.iceChest).z > bedWidth(freight.tote).z * 1.5);
  updateCatchFreight(freight, null, 0, setup);
  assert.deepEqual(fish.map(species => species.count), [0, 0, 0]);
  assert.equal(freight.group.visible, true);
  assert.equal(freight.iceChest.getObjectByName('Cooler lid').rotation.x + 0, 0);
  updateCatchFreight(freight, null, 0);
  assert.equal(freight.group.visible, false);
  assert.equal(freight.iceChest.visible, false);
});
