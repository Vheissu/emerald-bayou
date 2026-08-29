import test from 'node:test';
import assert from 'node:assert/strict';
import { emitMapMarker, MapMarkerPool } from '../src/mapmarkers.js';
import { markerDrawPriority } from '../src/hud.js';

test('map marker frames reuse fixed stable-shape objects and clear prior fields', () => {
  const game = { mapMarkers: [], mapMarkerPool: new MapMarkerPool(2) };
  const first = emitMapMarker(game, 10, 20, 'job', '#f07a2e', 0.4, true, 'flag', true, true, true, true, 7);
  emitMapMarker(game, 30, 40, 'boat', '#5aa7ff', 1.2);
  assert.equal(game.mapMarkers.length, 2);
  assert.deepEqual(first, { x: 10, z: 20, kind: 'job', color: '#f07a2e', heading: 0.4, clamp: true, glyph: 'flag', locked: true, done: true, known: true, soft: true, r: 7 });

  game.mapMarkers.length = 0; game.mapMarkerPool.reset();
  const reused = emitMapMarker(game, -3, -4, 'home');
  assert.equal(reused, first);
  assert.deepEqual(reused, { x: -3, z: -4, kind: 'home', color: '', heading: 0, clamp: false, glyph: '', locked: false, done: false, known: false, soft: false, r: 0 });
});

test('map marker pool stays bounded and reports unexpected radar overflow', () => {
  const game = { mapMarkers: [], mapMarkerPool: new MapMarkerPool(1) };
  assert.ok(emitMapMarker(game, 1, 2, 'dot'));
  assert.equal(emitMapMarker(game, 3, 4, 'hazard'), null);
  assert.deepEqual(game.mapMarkerPool.stats(game.mapMarkers.length), { displayed: 1, pooled: 1, capacity: 1, droppedFrame: 1, droppedTotal: 1 });
  game.mapMarkerPool.reset();
  assert.deepEqual(game.mapMarkerPool.stats(0), { displayed: 0, pooled: 0, capacity: 1, droppedFrame: 0, droppedTotal: 1 });
});

test('marker emission preserves the array interface used by lightweight directors', () => {
  const game = { mapMarkers: [] };
  const marker = emitMapMarker(game, 8, 9, 'boat', '#fff', 0.75);
  assert.equal(game.mapMarkers[0], marker);
  assert.deepEqual(marker, { x: 8, z: 9, kind: 'boat', color: '#fff', heading: 0.75, clamp: false, glyph: '', locked: false, done: false, known: false, soft: false, r: 0 });
});

test('minimap draw priorities keep objectives and hazards above quiet world marks', () => {
  assert.equal(markerDrawPriority('trap'), 0);
  assert.equal(markerDrawPriority('house'), 1);
  assert.equal(markerDrawPriority('boat'), 4);
  assert.equal(markerDrawPriority('hazard'), 7);
  assert.equal(markerDrawPriority('objective'), 8);
  assert.equal(markerDrawPriority('unregistered-mark'), 0);
});
