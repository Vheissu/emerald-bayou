import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closePassProbeScore, createClosePass, hornYieldSpeedScale, hornYieldStrength,
  pursuitYieldSpeedScale, pursuitYieldStrength, stepClosePass,
} from '../src/trafficresponse.js';

test('ambient boats only yield to a real nearby pursuit', () => {
  assert.equal(pursuitYieldStrength(false, 4, 30, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, Infinity, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, 190, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, 30, 15, 'john', true), 0);
});

test('pursuit response grows with proximity, speed, and wanted heat', () => {
  const far = pursuitYieldStrength(true, 1, 150, 5);
  const near = pursuitYieldStrength(true, 1, 45, 5);
  const urgent = pursuitYieldStrength(true, 5, 45, 16);
  assert.ok(near > far);
  assert.ok(urgent > near);
  assert.ok(urgent <= 1);
});

test('vulnerable paddle craft see farther and yield more speed', () => {
  assert.ok(pursuitYieldStrength(true, 3, 190, 12, 'canoe') > 0);
  assert.ok(pursuitYieldSpeedScale(0.8, 'canoe') < pursuitYieldSpeedScale(0.8, 'john'));
  assert.equal(pursuitYieldSpeedScale(0), 1);
  assert.ok(pursuitYieldSpeedScale(99, 'canoe') >= 0.14);
});

test('a horn only triggers an avoidance response ahead and inside audible range', () => {
  assert.equal(hornYieldStrength(Infinity, 1, 12), 0);
  assert.equal(hornYieldStrength(40, -0.2, 12), 0);
  assert.equal(hornYieldStrength(180, 1, 12), 0);
  assert.ok(hornYieldStrength(55, 1, 12) > 0);
});

test('horn response grows for a closing vessel and a prolonged signal carries farther', () => {
  const slow = hornYieldStrength(70, 0.9, 2);
  const closing = hornYieldStrength(70, 0.9, 14);
  assert.ok(closing > slow);
  assert.equal(hornYieldStrength(220, 1, 10), 0);
  assert.ok(hornYieldStrength(220, 1, 10, 'john', true) > 0);
});

test('paddle craft shed more speed after a close sound signal', () => {
  assert.ok(hornYieldSpeedScale(0.8, 'canoe') < hornYieldSpeedScale(0.8, 'john'));
  assert.equal(hornYieldSpeedScale(0), 1);
  assert.ok(hornYieldSpeedScale(99, 'canoe') >= 0.28);
});


const skiff = { x: 0, z: 0, heading: 0, speed: 3, kind: 'skiff', passReactionDelay: 0.25 };
const approach = { pos: { x: 7, y: 37 }, vel: { x: 0, y: -13 }, heading: 0, speed: 13 };

test('an impending fast overtake turns the crew toward its side after a short notice delay', () => {
  const pass = createClosePass();
  for (let i = 0; i < 4; i++) stepClosePass(pass, skiff, approach, 0, 0.05);
  assert.equal(pass.strength, 0);
  assert.equal(pass.closest, 7);
  assert.ok(pass.bearing > Math.PI / 2);
  const closing = { ...approach, pos: { x: 7, y: 28 } };
  for (let i = 0; i < 10; i++) stepClosePass(pass, skiff, closing, 0, 0.05);
  assert.ok(pass.strength > 0.5);

  const departing = { ...approach, pos: { x: 7, y: -14 } };
  stepClosePass(pass, skiff, departing, 0, 0.05);
  assert.equal(pass.timeToClosest, Infinity);
  assert.ok(pass.strength > 0.4);
  const gone = { ...departing, pos: { x: 7, y: -57 } };
  for (let i = 0; i < 76; i++) stepClosePass(pass, skiff, gone, 0, 0.05);
  assert.ok(pass.strength < 0.01);
});

test('parallel travel at idle has no alert, but passing wash braces a canoe immediately', () => {
  const canoe = { ...skiff, kind: 'canoe', speed: 0.65 };
  const idle = { speed: 0.65, heading: 0, pos: { x: 3, y: 0 }, vel: { x: 0, y: -canoe.speed } };
  const pass = createClosePass();
  for (let i = 0; i < 50; i++) stepClosePass(pass, canoe, idle, 0, 0.05);
  assert.equal(pass.strength, 0);
  stepClosePass(pass, canoe, idle, 0.17, 0.05);
  assert.ok(pass.strength > 0.25);
  assert.equal(stepClosePass(pass, canoe, approach, 0.17, 0.05, true), 0);
  assert.equal(pass.hold, 0);
});

test('unclassified steering favors a course with greater predicted passing clearance', () => {
  const toward = closePassProbeScore(8, 16, 0.5, -0.866, 4, 0, -12, 0.8);
  const away = closePassProbeScore(8, 16, -0.5, -0.866, 4, 0, -12, 0.8);
  assert.ok(away > toward);
  assert.equal(closePassProbeScore(8, 16, 0, -1, 4, 0, -12, 0), 0);
});
