import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResidentRoutines, residentOnShift, residentRoutineRoll, residentRoutineState, RESIDENT_ROUTINE,
} from '../src/residentroutines.js';
import { Ecology } from '../src/ecology.js';
import { animatePerson, person } from '../src/folk.js';

const calm = { role: 'camp', seed: 0.4, day: 3, hour: 12, storm: 0, rain: 0, wind: 3, distance: 200, playerSpeed: 0, attention: 0, pursuit: false };

test('daily resident shifts are deterministic and stagger neighbouring docks', () => {
  assert.equal(residentRoutineRoll(0.25, 4, 11), residentRoutineRoll(0.25, 4, 11));
  const shifts = Array.from({ length: 20 }, (_, index) => residentOnShift('camp', 5.3, index / 20, 4));
  assert.ok(shifts.includes(true));
  assert.ok(shifts.includes(false));
  assert.equal(residentOnShift('ramp', 13, 0.2, 4), true);
  assert.equal(residentOnShift('house', 2, 0.2, 4), false);
  assert.equal(residentOnShift('blind', 6, 0.2, 4), true);
  assert.equal(residentOnShift('blind', 13, 0.2, 4), false);
});

test('working residents brace ahead of severe weather and shelter in hurricane conditions', () => {
  assert.equal(residentRoutineState(calm), RESIDENT_ROUTINE.OUTSIDE);
  assert.equal(residentRoutineState({ ...calm, storm: 0.66, rain: 0.8, wind: 17 }), RESIDENT_ROUTINE.BRACE);
  assert.equal(residentRoutineState({ ...calm, storm: 0.9, rain: 1, wind: 31 }), RESIDENT_ROUTINE.INSIDE);
  assert.equal(residentRoutineState({ ...calm, role: 'blind', storm: 0.5 }), RESIDENT_ROUTINE.INSIDE);
});

test('people already outside watch a nearby chase but take cover from high heat', () => {
  assert.equal(residentRoutineState({ ...calm, pursuit: true, attention: 1.4, distance: 240 }), RESIDENT_ROUTINE.WATCH);
  assert.equal(residentRoutineState({ ...calm, pursuit: true, attention: 2.2, distance: 130 }), RESIDENT_ROUTINE.INSIDE);
  assert.equal(residentRoutineState({ ...calm, pursuit: true, attention: 2.2, distance: 260 }), RESIDENT_ROUTINE.WATCH);
  assert.equal(residentRoutineState({ ...calm, hour: 2, pursuit: true, attention: 1.4, distance: 120 }), RESIDENT_ROUTINE.INSIDE);
});

test('reckless wake speed draws attention while an idling boat does not', () => {
  assert.equal(residentRoutineState({ ...calm, distance: 60, playerSpeed: 6 }), RESIDENT_ROUTINE.WATCH);
  assert.equal(residentRoutineState({ ...calm, distance: 60, playerSpeed: 2 }), RESIDENT_ROUTINE.OUTSIDE);
  assert.equal(residentRoutineState({ ...calm, distance: 110, playerSpeed: 9 }), RESIDENT_ROUTINE.OUTSIDE);
});

test('routine application reuses the resident rig and clears hidden fishing state', () => {
  const line = { visible: true }, userData = { seed: 0.4, line, lineOn: 12, reelT: 4 };
  const person = { visible: true, userData }, people = [person], group = { userData: { people } };
  const stats = { groups: 0, actors: 0, inside: 0, outside: 0, watching: 0, bracing: 0 };
  const input = { ...calm, hour: 2 };

  applyResidentRoutines(group, input, stats);

  assert.equal(group.userData.people, people);
  assert.equal(group.userData.people[0], person);
  assert.equal(person.visible, false);
  assert.equal(userData.routineState, RESIDENT_ROUTINE.INSIDE);
  assert.equal(line.visible, false);
  assert.equal(userData.lineOn, 0);
  assert.equal(userData.reelT, 0);
  assert.deepEqual(stats, { groups: 1, actors: 1, inside: 1, outside: 0, watching: 0, bracing: 0 });
});

test('the ecology cadence updates every loaded resident registry without adding actors', () => {
  const actor = seed => ({ visible: true, userData: { seed } });
  const campPerson = actor(0.2), housePerson = actor(0.4), angler = actor(0.6);
  const campSite = { x: 80, z: 0 }, houseSite = { x: 180, z: 0, kind: 'house' }, fishingSite = { x: 260, z: 0 };
  const camp = { userData: { site: campSite, people: [campPerson] } };
  const house = { userData: { people: [housePerson] } }, shore = { userData: { people: [angler] } };
  const input = { ...calm }, stats = { groups: 0, actors: 0, inside: 0, outside: 0, watching: 0, bracing: 0, passes: 0 };
  const ecology = Object.assign(Object.create(Ecology.prototype), {
    environment: { day: 3, hour: 8, gust: 1, values: { storm: 0, rain: 0, wind: 3 } },
    phys: { pos: { x: 0, y: 0 }, speed: 2 }, game: { law: { attention: 0, pursuit: false } },
    world: { liveCamps: new Map([['camp', camp]]), liveSites: new Map([['house', { site: houseSite, g: house }]]) },
    life: { folk: { live: new Map([['shore', { f: fishingSite, g: shore }]]) } },
    residentRoutineInput: input, residentRoutineStats: stats,
  });

  ecology.updateVisibility();

  assert.equal(ecology.residentRoutineInput, input);
  assert.equal(ecology.residentRoutineStats, stats);
  assert.equal(stats.groups, 3);
  assert.equal(stats.actors, 3);
  assert.equal(stats.outside, 3);
  assert.equal(camp.userData.people[0], campPerson);
  assert.equal(house.userData.people[0], housePerson);
  assert.equal(shore.userData.people[0], angler);
});

test('watch and storm states drive visibly different poses on the existing joint rig', () => {
  const make = () => {
    const figure = person(() => 0.35, { pose: 'stand', hat: false });
    Object.assign(figure.userData, { act: 'idle', actT: 0, actDur: 999, routineState: RESIDENT_ROUTINE.OUTSIDE });
    return figure;
  };
  const normal = make(), bracing = make(), watching = make();
  bracing.userData.routineState = RESIDENT_ROUTINE.BRACE;
  watching.userData.routineState = RESIDENT_ROUTINE.WATCH;
  for (let frame = 0; frame < 60; frame++) {
    const t = frame / 60;
    animatePerson(normal, t, 1 / 60, null, null);
    animatePerson(bracing, t, 1 / 60, null, null);
    animatePerson(watching, t, 1 / 60, { x: 20, z: 0, speed: 6 }, null);
  }

  assert.ok(bracing.userData.spine.rotation.x > normal.userData.spine.rotation.x + 0.2);
  assert.ok(bracing.userData.hips.position.y < normal.userData.hips.position.y - 0.05);
  assert.ok(Math.abs(watching.userData.spine.rotation.y) > 0.12);
  assert.ok(Math.abs(watching.userData.head.rotation.y) > 0.4);
});
