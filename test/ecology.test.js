import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bioluminescenceContrast, feedingDisturbance, feedingEventPotential, trafficFeedingDisturbance } from '../src/ecology.js';
import { Birds } from '../src/wildlife.js';

test('feeding activity follows light, moving tide and safe weather', () => {
  const common = { wind: 3, rain: 0, storm: 0, fish: 1.1, bird: 1.3 };
  const dawn = feedingEventPotential({ ...common, hour: 6.75, tideRate: 0.24 });
  const midday = feedingEventPotential({ ...common, hour: 13, tideRate: 0.24 });
  const slackDawn = feedingEventPotential({ ...common, hour: 6.75, tideRate: 0 });
  const night = feedingEventPotential({ ...common, hour: 2, tideRate: 0.24 });
  const hurricane = feedingEventPotential({ ...common, hour: 6.75, tideRate: 0.24, wind: 36, rain: 1, storm: 1 });

  assert.ok(dawn > 0.9);
  assert.equal(feedingEventPotential(6.75, 3, 0, 0, 0.24, 1.1, 1.3), dawn);
  assert.ok(midday > 0.2 && midday < 0.4);
  assert.ok(slackDawn < dawn * 0.55);
  assert.equal(night, 0);
  assert.equal(hurricane, 0);
});

test('only prop wash or a consequential wake scatters a feeding school', () => {
  assert.equal(feedingDisturbance({ distance: 18, speed: 6, wake: 0 }), 'prop-wash');
  assert.equal(feedingDisturbance(18, 6, 0), 'prop-wash');
  assert.equal(feedingDisturbance({ distance: 34, speed: 2, wake: 0.08 }), 'wake');
  assert.equal(feedingDisturbance({ distance: 34, speed: 2, wake: 0.03 }), '');
  assert.equal(feedingDisturbance({ distance: 70, speed: 12, wake: 0.2 }), '');
});

test('resident traffic can scatter bait without attributing its wake to the player', () => {
  const boats = [
    { active: true, x: 18, z: 0, speed: 6, state: 'transit', collision: { active: false } },
    { active: false, x: 2, z: 0, speed: 12, state: 'off', collision: { active: false } },
  ];
  assert.equal(trafficFeedingDisturbance(boats, 0, 0, 0), 'traffic-prop-wash');
  boats[0].x = 34; boats[0].speed = 2;
  assert.equal(trafficFeedingDisturbance(boats, 0, 0, 0.08), 'traffic-wake');
  assert.equal(trafficFeedingDisturbance(boats, 0, 0, 0.02), '');
});

test('moonlight changes perceived blue-fire contrast without erasing the bloom', () => {
  const dark = bioluminescenceContrast(0), quarter = bioluminescenceContrast(0.5), bright = bioluminescenceContrast(1);
  assert.equal(dark, 1);
  assert.ok(quarter < dark && quarter > bright);
  assert.ok(bright >= 0.55 && bright <= 0.57);
});

test('feeding activity redirects a fixed bird pool without adding scene resources', () => {
  const birds = new Birds({ heightAt: () => -2 }, new THREE.Vector3());
  const mesh = birds.mesh, geometry = mesh.geometry, material = mesh.material;

  birds.setFeedingActivity({ active: true, x: 120, z: -80, intensity: 1, scatter: 0 });
  for (let i = 0; i < 90; i++) birds.update(i / 60, { x: 0, z: 0 }, 1 / 60);
  const active = birds.feedingSnapshot();

  assert.equal(birds.mesh, mesh);
  assert.equal(birds.mesh.geometry, geometry);
  assert.equal(birds.mesh.material, material);
  assert.equal(active.redirectedFlocks, 2);
  assert.equal(active.birdCapacity, 77);
  assert.ok(birds.flocks.filter(f => f.feedingRole).every(f => f.feedBlend > 0));

  geometry.dispose(); material.dispose();
});
