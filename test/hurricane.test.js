import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHurricanePassage, Environment, hurricanePassage } from '../src/environment.js';
import { RadioDirector } from '../src/radio.js';

const HURRICANE = Object.freeze({
  cloud: 0.16, rain: 1, hail: 0.12, wind: 36, sea: 2.15, fog: 0.00134,
  exposure: 0.56, surge: 0.9, lightning: 0.62, storm: 1,
});

function conditionsAt(progress) {
  const passage = hurricanePassage(progress, {}), values = { ...HURRICANE };
  applyHurricanePassage(values, passage, 1);
  return { passage, values };
}

test('a hurricane crosses in ordered bands, eyewalls, eye and trailing bands', () => {
  assert.equal(hurricanePassage(0.05).phase, 'outer-bands');
  assert.equal(hurricanePassage(0.3).phase, 'front-eyewall');
  assert.equal(hurricanePassage(0.5).phase, 'eye');
  assert.equal(hurricanePassage(0.7).phase, 'back-eyewall');
  assert.equal(hurricanePassage(0.95).phase, 'trailing-bands');
});

test('the eye calms wind and rain without erasing surge or the rough sea', () => {
  const front = conditionsAt(0.3), eye = conditionsAt(0.5), back = conditionsAt(0.7);
  assert.ok(front.passage.eyewall > 0.99 && back.passage.eyewall > 0.99);
  assert.ok(front.values.wind > 38 && back.values.wind > 38);
  assert.ok(eye.values.wind < 4 && eye.values.rain < 0.02);
  assert.ok(eye.values.sea > 1.5 && eye.values.surge === HURRICANE.surge);
  assert.ok(front.values.surge < eye.values.surge && back.values.surge > eye.values.surge);
  assert.ok(eye.values.cloud > 0.55 && eye.values.storm < 0.35);
  assert.ok(eye.passage.pressureHpa < front.passage.pressureHpa);
});

test('surge builds through the leading bands, peaks behind the eye and drains through trailing bands', () => {
  const outer = conditionsAt(0.05), front = conditionsAt(0.3), eye = conditionsAt(0.5), back = conditionsAt(0.7), trailing = conditionsAt(0.95);
  assert.ok(outer.values.surge < front.values.surge && front.values.surge < eye.values.surge);
  assert.ok(back.values.surge > eye.values.surge);
  assert.ok(trailing.values.surge < eye.values.surge && trailing.values.surge > 0);
  assert.ok(front.passage.surgeTrend > 0);
  assert.ok(trailing.passage.surgeTrend < 0);
});

test('backside winds reverse while the passage functions retain their caller-owned objects', () => {
  const passage = {}, values = { ...HURRICANE };
  assert.equal(hurricanePassage(0.3, passage), passage);
  assert.ok(passage.windShift < 0.01);
  assert.equal(hurricanePassage(0.7, passage), passage);
  assert.ok(passage.windShift > Math.PI * 0.99);
  assert.equal(applyHurricanePassage(values, passage, 1), values);
});

test('surge motion contributes to the navigable flood and ebb without changing total water height', () => {
  const minutes = 12.42 / 4 * 60;
  const astronomical = Object.create(Environment.prototype), flooding = Object.create(Environment.prototype), draining = Object.create(Environment.prototype);
  for (const environment of [astronomical, flooding, draining]) Object.assign(environment, { minutes, values: { surge: 0.9 }, surgeRate: 0 });
  flooding.surgeRate = 0.18; draining.surgeRate = -0.18;
  astronomical.syncClockAndTide(); flooding.syncClockAndTide(); draining.syncClockAndTide();
  assert.equal(flooding.waterLevel, astronomical.waterLevel);
  assert.equal(draining.waterLevel, astronomical.waterLevel);
  assert.ok(flooding.tideRate > astronomical.tideRate);
  assert.ok(draining.tideRate < astronomical.tideRate);
  assert.match(flooding.tideLabel(), /^Rising /);
  assert.match(draining.tideLabel(), /^Falling /);
});

test('leaving the backside carries its reversed wind into the next weather state', () => {
  const environment = Object.create(Environment.prototype);
  Object.assign(environment, {
    key: 'hurricane', values: { ...HURRICANE }, windAngle: 0.2, localWindAngle: 0.2 + Math.PI,
    hurricaneBlend: 1, lastHurricanePhase: 'back-eyewall', game: { save: {} },
    persistState() {},
  });
  environment.setWeather('tropical', false, false);
  assert.ok(Math.abs(Math.cos(environment.windAngle) - Math.cos(0.2 + Math.PI)) < 1e-12);
  assert.ok(Math.abs(Math.sin(environment.windAngle) - Math.sin(0.2 + Math.PI)) < 1e-12);
  assert.equal(environment.localWindAngle, environment.windAngle);
});

test('weather persistence stores the full passage duration alongside remaining time', () => {
  const environment = Object.create(Environment.prototype), game = { save: {}, persist() {} };
  Object.assign(environment, { game, minutes: 812, key: 'hurricane', from: { ...HURRICANE }, mix: 1, remaining: 71, weatherDuration: 196, windAngle: -1.2 });
  environment.persistState(false);
  assert.equal(game.save.environment.remaining, 71);
  assert.equal(game.save.environment.duration, 196);
});

test('the world HUD reads storm surge from retained environment values', () => {
  const environment = Object.create(Environment.prototype), el = {};
  Object.assign(environment, {
    el, hour: 3.5, localWindAngle: 0, tideRange: 1, key: 'hurricane', hurricane: { pressureHpa: 978 },
    values: { wind: 30, surge: 0.72 }, gust: 1, currentField: null, tideLabel: () => 'Rising +2.4 ft', weatherLabel: () => 'Hurricane eyewall',
  });
  environment.renderHud();
  assert.match(el.innerHTML, /surge \+2\.4 ft/); assert.match(el.innerHTML, /978 hPa/);
});

test('marine radio explains that eye calm is temporary and backside wind reverses', () => {
  const radio = Object.create(RadioDirector.prototype), calls = [];
  radio.transmit = message => { calls.push(message); return true; };
  assert.equal(radio.hurricanePhaseCall('eye'), true);
  assert.equal(radio.hurricanePhaseCall('back-eyewall'), true);
  assert.match(calls[0].text, /temporarily light/i);
  assert.match(calls[0].text, /surge and rough water remain/i);
  assert.match(calls[1].text, /wind is reversing/i);
  assert.ok(calls.every(call => call.priority === 4 && call.channel === 'WX-3'));
});
