import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildRegatta, recordRegattaFinish } from '../src/regatta.js';
import { Game } from '../src/game.js';
import { WorldHeight } from '../src/heightfield.js';

const fixtures = buildRegatta({ headingTo: Game.prototype.headingTo });

test('the three regatta courses follow open water around the island and through the two reaches', () => {
  const height = new WorldHeight(7);
  assert.deepEqual(fixtures.map(race => race.laps), [1, 2, 1]);
  assert.equal(fixtures.filter(race => race.rival).length, 2);
  for (const race of fixtures) {
    let a = race.start();
    for (const b of race.gates) {
      const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
      for (let i = 1; i <= samples; i++) {
        const q = i / samples;
        assert.ok(height.compute(a.x + (b.x - a.x) * q, a.z + (b.z - a.z) * q) < -0.5);
      }
      a = b;
    }
  }
});

test('a racer can finish for the runner-up purse after the rival has crossed', () => {
  const [race] = fixtures;
  const pos = new THREE.Vector2();
  const game = {
    phys: { pos }, toast() {}, beacon: { set() {}, hide() {} }, beacon2: { set() {}, hide() {} },
    audio: { checkpoint() {}, complete() {} }, beginMissionRival() {}, syncMissionRival() {}, endMissionRival() {},
    skiff: {
      pos: new THREE.Vector2(), active: false, i: 0,
      start(path) { this.path = path; this.pos.set(path[0].x, path[0].z); this.active = true; },
      stop() { this.active = false; },
      update() { this.i++; const p = this.path[this.i]; this.pos.set(p.x, p.z); },
    },
  };
  const start = race.start(), state = { m: race, t: 0 };
  pos.set(start.x, start.z); race.setup(state, game);
  for (let i = 0; i < race.gates.length; i++) {
    state.t += 2;
    assert.equal(race.update(state, game, 2, state.t), null);
  }
  assert.equal(game.skiff.active, false);
  assert.ok(Number.isFinite(state.rivalFinish));
  let result;
  for (const gate of race.gates) {
    state.t += 2;
    pos.set(gate.x, gate.z);
    result = race.update(state, game, 2, state.t);
  }
  assert.equal(result, 'done');
  assert.equal(state.place, 2);
  Object.assign(game, {
    state, save: { cash: 0, done: [], best: {} },
    medalFor: Game.prototype.medalFor, addCash(amount) { this.save.cash += amount; },
    renderHud() {}, showResult(title, lines) { this.result = { title, lines }; },
  });
  Game.prototype.end.call(game, true);
  assert.deepEqual(game.save.done, []);
  assert.equal(game.result.title, 'Second place');
  assert.equal(game.save.cash, 155);
  assert.deepEqual(game.save.regatta[race.id], { time: state.t, startsFinished: 1, wins: 0 });
  Game.prototype.end.call(game, true);
  assert.equal(game.save.cash, 155);
});

test('repeat wins pay the full posted purse, dirty contact reduces it and missed deadlines pay nothing', () => {
  const [race] = fixtures, save = {};
  assert.deepEqual(recordRegattaFinish(save, race, 55, 1, 0), { purse: 340, newBest: true, clean: true });
  assert.deepEqual(recordRegattaFinish(save, race, 51, 1, 0), { purse: 340, newBest: true, clean: true });
  assert.deepEqual(recordRegattaFinish(save, race, 60, 1, 2), { purse: 272, newBest: false, clean: false });
  assert.equal(recordRegattaFinish(save, race, race.timeLimit + 1, 1, 0), null);
  assert.deepEqual(save.regatta[race.id], { time: 51, startsFinished: 3, wins: 3 });
});
