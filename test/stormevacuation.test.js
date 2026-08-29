import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickStormEvacuationCamp, stormEvacuationCampScore, stormEvacuationLeadSeconds, stormEvacuationWindow,
} from '../src/stormevacuation.js';
import { EncounterDirector } from '../src/encounters.js';
import { RadioDirector } from '../src/radio.js';

const risingFront = {
  weather: 'hurricane', phase: 'front-eyewall', progress: 0.28,
  surge: 0.62, surgeRate: 0.13, duration: 200,
};

const camp = (key, x, bankHeight, floorHeight = 1.2) => ({
  key, name: key, x, z: 0, h: floorHeight,
  tie: { x, z: 0 }, bank: { x: x + 9, z: 0, h: bankHeight },
});

test('surge evacuation opens only while hurricane water is rising ahead of the backside', () => {
  assert.ok(Math.abs(stormEvacuationLeadSeconds(risingFront) - 60) < 1e-9);
  assert.equal(stormEvacuationWindow(risingFront), true);
  assert.equal(stormEvacuationWindow({ ...risingFront, weather: 'tropical' }), false);
  assert.equal(stormEvacuationWindow({ ...risingFront, surgeRate: -0.04 }), false);
  assert.equal(stormEvacuationWindow({ ...risingFront, phase: 'back-eyewall', progress: 0.59 }), false);
  assert.equal(stormEvacuationWindow({ ...risingFront, phase: 'eye', progress: 0.46, duration: 200 }), false);
});

test('camp selection uses bank inundation and the remaining pickup time', () => {
  const context = { playerX: 0, playerZ: 0, waterLevel: 0.58, leadSeconds: 60 };
  const low = camp('low camp', 420, 0.64, 0.88);
  const lowerButFarther = camp('far low camp', 610, 0.45, 0.62);
  const high = camp('high camp', 330, 1.3, 1.8);
  const unreachable = camp('unreachable camp', 920, 0.55, 0.8);

  assert.ok(stormEvacuationCampScore(lowerButFarther, context) > stormEvacuationCampScore(low, context));
  assert.equal(stormEvacuationCampScore(high, context), -Infinity);
  assert.equal(stormEvacuationCampScore(unreachable, context), -Infinity);
  assert.equal(pickStormEvacuationCamp([high, low, lowerButFarther, unreachable], context), lowerButFarther);
});

test('selection accepts streamed camp groups without creating a second world registry', () => {
  const low = camp('streamed low camp', 280, 0.62, 0.9);
  const group = { userData: { site: low } };
  assert.equal(pickStormEvacuationCamp(new Map([['camp', group]]).values(), {
    playerX: 0, playerZ: 0, waterLevel: 0.55, leadSeconds: 52,
  }), low);
});

test('encounter director consumes at most one loaded-camp evacuation per hurricane passage', () => {
  const high = camp('high', 260, 1.4, 1.9), low = camp('low', 420, 0.62, 0.9);
  const director = Object.create(EncounterDirector.prototype);
  Object.assign(director, {
    environment: {
      key: 'hurricane', hurricane: { phase: 'front-eyewall', progress: 0.28 },
      values: { surge: 0.62 }, surgeRate: 0.13, weatherDuration: 200, waterLevel: 0.58,
    },
    world: { liveCamps: new Map([['high', { userData: { site: high } }], ['low', { userData: { site: low } }]]) },
    phys: { pos: { x: 0, y: 0 } }, stormEvacuationUsed: false, stormEvacuationWeather: 'hurricane',
    stormEvacuationContext: {},
  });

  assert.equal(director.stormEvacuationCamp(), low);
  director.stormEvacuationUsed = true;
  assert.equal(director.stormEvacuationCamp(), null);
  director.environment.key = 'tropical'; director.syncStormEvacuationPassage();
  assert.equal(director.stormEvacuationUsed, false);
});

test('starting an evacuation only reconfigures the pooled distress rig', () => {
  let sceneAdds = 0;
  const rig = {
    boat: { visible: false, position: { set(x, y, z) { Object.assign(this, { x, y, z }); } }, rotation: { y: 0 } },
    survivor: { visible: false, userData: { waveT: 0 } }, passenger: { visible: true },
    flare: { group: { visible: false } },
  };
  const director = Object.create(EncounterDirector.prototype);
  Object.assign(director, {
    scene: { add() { sceneAdds++; } }, rigs: { distress: rig }, environment: { waterLevel: 0.58 },
    water: { waveHeight: () => 0.7 }, game: { toast() {} }, stormEvacuationUsed: false,
    clearDistressEcho() {}, stormEvacuationDrop: () => ({ x: 900, z: 0, name: 'public boat ramp' }),
  });
  const low = camp('Lostman Camp', 420, 0.62, 0.9);
  director.startStormEvacuation(low, { x: 420, z: 3, heading: 1.2 });

  assert.equal(sceneAdds, 0); assert.equal(director.rigs.distress, rig);
  assert.equal(rig.boat.visible, true); assert.equal(rig.survivor.visible, true); assert.equal(rig.passenger.visible, false);
  assert.equal(director.active.variant, 'surge-evacuation'); assert.equal(director.active.drop.name, 'public boat ramp');
});

test('camp evacuation radio traffic carries pickup, transfer and persistent aftermath', () => {
  const radio = Object.create(RadioDirector.prototype), calls = [];
  radio.transmit = message => { calls.push(message); return true; };
  const encounter = { type: 'distress', variant: 'surge-evacuation', campName: 'Lostman Camp', drop: { name: 'public boat ramp' }, t: 0 };

  radio.encounterCall(encounter); radio.encounterStateCall(encounter, 'aboard');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.priority === 4));
  assert.match(calls[0].text, /water is across the low bank/i); assert.match(calls[0].text, /public boat ramp/i);
  assert.match(calls[1].text, /has them/i);
  const followup = radio.encounterFollowupMessage({ outcome: 'surge-evacuation', place: 'Lostman Camp to public boat ramp' });
  assert.match(followup.text, /resident is dry/i); assert.match(followup.text, /Lostman Camp to public boat ramp/);
});
