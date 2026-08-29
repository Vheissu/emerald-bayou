import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAVIGATION_ROLE, NAVIGATION_VESSEL, PLAYER_NAV_LIGHT_LAYOUT, copyNavigationEncounter, createNavigationEncounter,
  evaluateNavigationEncounter, navigationEncounterOutranks, navigationLightVisibility,
} from '../src/navigationrules.js';

const velocity = (heading, speed) => ({ x: -Math.sin(heading) * speed, z: -Math.cos(heading) * speed });
function encounter({ ownX = 0, ownZ = 0, ownHeading = 0, ownSpeed = 8, otherX = 0, otherZ = -100, otherHeading = Math.PI, otherSpeed = 8, vessel = NAVIGATION_VESSEL.POWER, otherVessel = NAVIGATION_VESSEL.POWER } = {}, out = createNavigationEncounter()) {
  const otherVelocity = velocity(otherHeading, otherSpeed);
  return evaluateNavigationEncounter(ownX, ownZ, ownHeading, ownSpeed, otherX, otherZ, otherHeading, otherSpeed, otherVelocity.x, otherVelocity.z, vessel, otherVessel, out);
}

test('player navigation lights use the boat local port and starboard sides', () => {
  assert.ok(PLAYER_NAV_LIGHT_LAYOUT.port.x < 0);
  assert.ok(PLAYER_NAV_LIGHT_LAYOUT.starboard.x > 0);
  assert.ok(PLAYER_NAV_LIGHT_LAYOUT.stern.z > 0);
});

test('navigation lights expose only their legal horizontal sectors', () => {
  assert.deepEqual(navigationLightVisibility(0, -20), { port: true, starboard: true, stern: false });
  assert.deepEqual(navigationLightVisibility(-20, 0), { port: true, starboard: false, stern: false });
  assert.deepEqual(navigationLightVisibility(20, 0), { port: false, starboard: true, stern: false });
  assert.deepEqual(navigationLightVisibility(0, 20), { port: false, starboard: false, stern: true });
});

test('sidelight and stern sectors meet at 22.5 degrees abaft the beam', () => {
  const boundary = 112.5 * Math.PI / 180;
  assert.deepEqual(navigationLightVisibility(Math.sin(boundary), -Math.cos(boundary)), { port: false, starboard: true, stern: true });
  assert.deepEqual(navigationLightVisibility(Math.sin(boundary + 0.01), -Math.cos(boundary + 0.01)), { port: false, starboard: false, stern: true });
});

test('reciprocal power vessels both make an early starboard alteration', () => {
  const result = encounter();
  assert.equal(result.kind, 'head-on'); assert.equal(result.role, NAVIGATION_ROLE.MUTUAL);
  assert.equal(result.turn, -1); assert.equal(result.signalBlasts, 1); assert.ok(result.risk > 0.5);
  assert.ok(result.speedScale < 1); assert.equal(result.emergency, false);
});

test('crossing responsibility follows which skipper sees the other to starboard', () => {
  const giveWay = encounter({ otherX: 50, otherZ: -50, otherHeading: Math.PI / 2 });
  assert.equal(giveWay.kind, 'crossing-give-way'); assert.equal(giveWay.role, NAVIGATION_ROLE.GIVE_WAY);
  assert.ok(giveWay.targetStarboard > 0); assert.equal(giveWay.turn, -1); assert.equal(giveWay.signalBlasts, 1); assert.ok(giveWay.speedScale < 0.7);

  const standOn = encounter({ otherX: -50, otherZ: -50, otherHeading: -Math.PI / 2 });
  assert.equal(standOn.kind, 'crossing-stand-on'); assert.equal(standOn.role, NAVIGATION_ROLE.STAND_ON);
  assert.ok(standOn.targetStarboard < 0); assert.equal(standOn.holdCourse, true); assert.equal(standOn.speedScale, 1); assert.equal(standOn.signalBlasts, 0);
});

test('the overtaking vessel keeps clear while the overtaken vessel holds course and speed', () => {
  const overtaking = encounter({ ownSpeed: 8, otherZ: -50, otherHeading: 0, otherSpeed: 4 });
  assert.equal(overtaking.kind, 'overtaking-give-way'); assert.equal(overtaking.role, NAVIGATION_ROLE.GIVE_WAY);
  assert.ok(overtaking.speedScale < 1); assert.ok(Math.abs(overtaking.turn) === 1);

  const overtaken = encounter({ ownSpeed: 4, otherZ: 50, otherHeading: 0, otherSpeed: 8 });
  assert.equal(overtaken.kind, 'being-overtaken'); assert.equal(overtaken.role, NAVIGATION_ROLE.STAND_ON);
  assert.equal(overtaken.holdCourse, true); assert.equal(overtaken.speedScale, 1);
});

test('a working fishing vessel stands on unless it is itself overtaking', () => {
  const fishing = encounter({ otherX: 50, otherZ: -50, otherHeading: Math.PI / 2, vessel: NAVIGATION_VESSEL.FISHING });
  assert.equal(fishing.kind, 'fishing-stand-on'); assert.equal(fishing.role, NAVIGATION_ROLE.STAND_ON); assert.equal(fishing.holdCourse, true);

  const overtaking = encounter({ ownSpeed: 8, otherZ: -50, otherHeading: 0, otherSpeed: 4, vessel: NAVIGATION_VESSEL.FISHING });
  assert.equal(overtaking.kind, 'overtaking-give-way'); assert.equal(overtaking.role, NAVIGATION_ROLE.GIVE_WAY);
});

test('a power vessel keeps clear of working fishing gear while two fishing vessels use ordinary meeting rules', () => {
  const power = encounter({ otherX: 50, otherZ: -50, otherHeading: Math.PI / 2, otherVessel: NAVIGATION_VESSEL.FISHING });
  assert.equal(power.kind, 'fishing-give-way'); assert.equal(power.role, NAVIGATION_ROLE.GIVE_WAY);
  assert.equal(power.holdCourse, false); assert.equal(power.turn, 1); assert.equal(power.signalBlasts, 2); assert.ok(power.speedScale < 0.5);

  const bothFishing = encounter({ vessel: NAVIGATION_VESSEL.FISHING, otherVessel: NAVIGATION_VESSEL.FISHING });
  assert.equal(bothFishing.kind, 'head-on'); assert.equal(bothFishing.role, NAVIGATION_ROLE.MUTUAL);
});

test('close-quarters doubt overrides stand-on behavior with five rapid blasts', () => {
  const result = encounter({ otherX: -16, otherZ: -16, otherHeading: -Math.PI / 2 });
  assert.equal(result.kind, 'crossing-stand-on'); assert.equal(result.emergency, true); assert.equal(result.holdCourse, false);
  assert.equal(result.turn, -1); assert.equal(result.signalBlasts, 5); assert.ok(result.speedScale <= 0.42);
});

test('diverging traffic clears the retained result object without replacing it', () => {
  const retained = createNavigationEncounter();
  assert.equal(encounter({}, retained), retained); assert.notEqual(retained.kind, 'none');
  const result = encounter({ ownSpeed: 4, otherZ: -50, otherHeading: 0, otherSpeed: 8 }, retained);
  assert.equal(result, retained); assert.equal(result.kind, 'none'); assert.equal(result.role, NAVIGATION_ROLE.CLEAR);
  assert.equal(result.risk, 0); assert.equal(result.signalBlasts, 0);
});

test('encounter selection copies retained state and prioritizes immediate danger', () => {
  const ordinary = encounter({ otherX: 50, otherZ: -50, otherHeading: Math.PI / 2 });
  const danger = encounter({ otherX: -16, otherZ: -16, otherHeading: -Math.PI / 2 });
  assert.equal(danger.emergency, true); assert.equal(navigationEncounterOutranks(danger, ordinary), true);

  const retained = createNavigationEncounter();
  assert.equal(copyNavigationEncounter(danger, retained), retained);
  assert.deepEqual(retained, danger);
});
