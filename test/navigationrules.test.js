import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationLightVisibility, PLAYER_NAV_LIGHT_LAYOUT } from '../src/navigationrules.js';

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
