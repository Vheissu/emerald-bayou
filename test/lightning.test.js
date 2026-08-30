import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Environment } from '../src/environment.js';
import { mulberry32 } from '../src/noise.js';
import {
  LIGHTNING_LIFETIME, LIGHTNING_MAX_SEGMENTS, LIGHTNING_TRUNK_SEGMENTS,
  lightningStrokeEnvelope, writeLightningStroke,
} from '../src/lightning.js';

test('a lightning channel writes one bounded trunk and branched segment buffer', () => {
  const positions = new Float32Array(LIGHTNING_MAX_SEGMENTS * 6);
  const colors = new Float32Array(LIGHTNING_MAX_SEGMENTS * 6);
  const trunk = new Float32Array((LIGHTNING_TRUNK_SEGMENTS + 1) * 3);
  const segments = writeLightningStroke(positions, colors, trunk, { x: 12, y: 3, z: -8, height: 220, random: mulberry32(17) });

  assert.ok(segments > LIGHTNING_TRUNK_SEGMENTS);
  assert.ok(segments <= LIGHTNING_MAX_SEGMENTS);
  assert.deepEqual(Array.from(positions.slice(0, 3)), [12, 3, -8]);
  assert.equal(trunk[LIGHTNING_TRUNK_SEGMENTS * 3 + 1], 223);
  assert.ok(Array.from(positions.slice(0, segments * 6)).every(Number.isFinite));
  assert.ok(Array.from(colors.slice(0, LIGHTNING_TRUNK_SEGMENTS * 6)).every(value => value > 1));
});

test('lightning geometry rejects undersized buffers without partial writes', () => {
  const positions = new Float32Array((LIGHTNING_TRUNK_SEGMENTS - 1) * 6);
  const colors = new Float32Array((LIGHTNING_TRUNK_SEGMENTS - 1) * 6);
  const trunk = new Float32Array((LIGHTNING_TRUNK_SEGMENTS + 1) * 3);
  assert.equal(writeLightningStroke(positions, colors, trunk), 0);
  assert.ok(positions.every(value => value === 0));
  assert.ok(colors.every(value => value === 0));
});

test('the live lightning rig is one initially dormant draw with a fixed memory budget', () => {
  const environment = Object.create(Environment.prototype);
  environment.scene = new THREE.Scene(); environment.boltSegments = 0;
  environment.makeLightning();
  const snapshot = environment.lightningSnapshot();

  assert.equal(environment.bolt.isLineSegments, true);
  assert.equal(environment.bolt.geometry.drawRange.count, 0);
  assert.deepEqual(snapshot, {
    active: false, segments: 0, capacity: 72, returnStrokes: 3,
    drawCalls: 0, geometries: 1, materials: 1, textures: 0,
    geometryBytes: 3456, scratchBytes: 300,
  });
  environment.bolt.geometry.dispose(); environment.bolt.material.dispose();
});

test('three return strokes are separated by real dark gaps', () => {
  assert.equal(lightningStrokeEnvelope(0), 1);
  assert.equal(lightningStrokeEnvelope(0.06), 0);
  assert.equal(lightningStrokeEnvelope(0.073), 0.78);
  assert.equal(lightningStrokeEnvelope(0.13), 0);
  assert.equal(lightningStrokeEnvelope(0.148), 0.52);
  assert.equal(lightningStrokeEnvelope(LIGHTNING_LIFETIME), 0);
  assert.equal(lightningStrokeEnvelope(-1), 0);
});
