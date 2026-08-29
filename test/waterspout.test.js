import test from 'node:test';
import assert from 'node:assert/strict';
import {
  waterspoutAvoidanceStrength, waterspoutCanForm, waterspoutDriftSpeed, waterspoutFormationChance, waterspoutProbeScore, waterspoutReactionReady,
} from '../src/waterspout.js';
import { RadioDirector } from '../src/radio.js';

test('mature waterspouts form in convective weather but not fair conditions', () => {
  const squall = { storm: 0.68, rain: 0.68, wind: 14, lightning: 0.2 };
  const thunderstorm = { storm: 0.9, rain: 1, wind: 18, lightning: 0.9 };
  assert.equal(waterspoutFormationChance('fair', thunderstorm), 0);
  assert.ok(waterspoutFormationChance('squall', squall) > 0);
  assert.ok(waterspoutFormationChance('thunderstorm', thunderstorm) > waterspoutFormationChance('squall', squall));
  assert.equal(waterspoutCanForm('thunderstorm', thunderstorm, 0), true);
  assert.equal(waterspoutCanForm('thunderstorm', thunderstorm, 1), false);
});

test('waterspout parent-cloud drift stays in the observed ten-to-fifteen-knot band', () => {
  const slow = waterspoutDriftSpeed(5), severe = waterspoutDriftSpeed(36);
  assert.ok(slow >= 5.14 && slow <= 7.73); assert.ok(severe > slow); assert.ok(severe <= 7.73);
});

test('small craft react farther out and urgency rises toward the spray ring', () => {
  assert.equal(waterspoutAvoidanceStrength(false, 40, 'canoe'), 0);
  assert.equal(waterspoutAvoidanceStrength(true, 400, 'canoe'), 0);
  assert.ok(waterspoutAvoidanceStrength(true, 70, 'john') > waterspoutAvoidanceStrength(true, 250, 'john'));
  assert.ok(waterspoutAvoidanceStrength(true, 300, 'canoe') > waterspoutAvoidanceStrength(true, 300, 'john'));
});

test('skippers take time to recognize a distant funnel but react immediately inside its close danger zone', () => {
  assert.equal(waterspoutReactionReady(240, 0.8, 1.2), false);
  assert.equal(waterspoutReactionReady(240, 1.2, 1.2), true);
  assert.equal(waterspoutReactionReady(80, 0, 1.2), true);
  assert.equal(waterspoutReactionReady(Infinity, 9, 1.2), false);
});

test('traffic probes prefer a ninety-degree escape that opens distance from the projected track', () => {
  const acrossTrack = waterspoutProbeScore(0, 0, 6, 0, 0, 150, 0, 198, 1);
  const alongTrack = waterspoutProbeScore(0, 0, 6, 0, 0, 150, 48, 150, 1);
  const towardRing = waterspoutProbeScore(0, 0, 6, 0, 0, 150, 0, 102, 1);
  assert.ok(acrossTrack > alongTrack); assert.ok(alongTrack > towardRing);
});

test('the marine warning tells small craft to avoid the funnel track', () => {
  const radio = Object.create(RadioDirector.prototype); let message = null;
  radio.clock = 62; radio.transmit = value => { message = value; return true; };
  assert.equal(radio.waterspoutCall(), true); assert.equal(message.channel, 'WX-3'); assert.equal(message.priority, 4);
  assert.match(message.text, /Special marine warning/); assert.match(message.text, /ninety degrees off its apparent track/);
});
