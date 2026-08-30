import test from 'node:test';
import assert from 'node:assert/strict';
import { pursuitStatusLabel } from '../src/law.js';

test('wanted status distinguishes an active visual from a last-fix search', () => {
  assert.equal(pursuitStatusLabel(false, false), 'Wanted');
  assert.equal(pursuitStatusLabel(true, true), 'Wanted · FWC pursuit');
  assert.equal(pursuitStatusLabel(true, false), 'Wanted · FWC searching');
});
