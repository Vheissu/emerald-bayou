import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';

const baseSave = () => ({ cash: 0, done: [], camps: [], traps: [], runs: 0, rec: {}, encounters: {}, incidents: {}, reputation: { deeds: [] } });
const hasProgress = save => Game.prototype.hasProgress.call({ save, state: null, startX: 10, startZ: 70 });

test('does not turn a fresh dock save into a continue slot', () => {
  assert.equal(hasProgress(baseSave()), false);
  assert.equal(hasProgress({ ...baseSave(), boatPosition: { x: 10, z: 70 } }), false);
});

test('recognizes exploration, jobs and world history as progress', () => {
  assert.equal(hasProgress({ ...baseSave(), boatPosition: { x: 50, z: 70 } }), true);
  assert.equal(hasProgress({ ...baseSave(), done: ['shakedown'] }), true);
  assert.equal(hasProgress({ ...baseSave(), reputation: { deeds: [{ faction: 'locals' }] } }), true);
  assert.equal(hasProgress({ ...baseSave(), fishing: { total: 1 } }), true);
});

test('disabled persistence cannot recreate a save during reset navigation', () => {
  let captured = false;
  Game.prototype.persist.call({ persistenceDisabled: true, captureBoatPosition: () => { captured = true; }, save: {} });
  assert.equal(captured, false);
});
