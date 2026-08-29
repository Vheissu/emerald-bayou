import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationEncounter } from '../src/navigationrules.js';

const previousDocument = globalThis.document;
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {} }),
  }),
};
const { Traffic } = await import('../src/life.js');
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;

function boat(id, { x = 0, z = 0, heading = 0, speed = 8, state = 'transit' } = {}) {
  return {
    active: true, assisting: false, collision: { active: false }, kind: 'john', profile: { id },
    x, z, heading, speed, state, navigation: createNavigationEncounter(), navTargetBoat: null,
    navEvalT: 0, navSignalT: 0, navSignalState: 0, navSignalTarget: '', hornT: 0,
  };
}

function trafficWith(boats, hornCalls = []) {
  const traffic = Object.create(Traffic.prototype);
  traffic.boats = boats; traffic._navigationCandidate = createNavigationEncounter();
  traffic.phys = { pos: { x: 250, y: 0 }, heading: 0, speed: 0, vel: { x: 0, y: 0 } };
  traffic.fx = { audio: { maneuverHorn: (blasts, volume, x, z) => hornCalls.push({ blasts, volume, x, z }) } };
  return traffic;
}

test('ambient traffic appraises another moving vessel when the player poses no collision risk', () => {
  const own = boat('marsh-ice');
  const peer = boat('bay-star', { z: -100, heading: Math.PI });
  const hornCalls = [], traffic = trafficWith([own, peer], hornCalls);

  const result = traffic.updateNavigationResponse(own, 250, 0.1, false);
  assert.equal(result.kind, 'head-on'); assert.equal(result.role, 'mutual'); assert.equal(result.signalBlasts, 1);
  assert.equal(own.navTargetBoat, peer); assert.equal(own.navSignalTarget, 'bay-star');
  assert.equal(hornCalls.length, 1); assert.equal(hornCalls[0].blasts, 1); assert.deepEqual([hornCalls[0].x, hornCalls[0].z], [0, 0]);
});

test('ambient power traffic gives way to another boat actively working fishing gear', () => {
  const own = boat('marsh-ice');
  const fishing = boat('net-nine', { x: 50, z: -50, heading: Math.PI / 2, state: 'work' });
  const traffic = trafficWith([own, fishing]);

  const result = traffic.updateNavigationResponse(own, 250, 0.1, false);
  assert.equal(result.kind, 'fishing-give-way'); assert.equal(result.role, 'give-way');
  assert.equal(own.navTargetBoat, fishing); assert.ok(result.speedScale < 1);
});
