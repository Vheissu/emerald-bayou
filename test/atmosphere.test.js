import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceMistEnvelope } from '../src/environment.js';

test('surface mist follows calm dawn cooling and real fog without surviving hurricane wind', () => {
  const midday = surfaceMistEnvelope({ hour: 13, fog: 0.00028, rain: 0, wind: 3.5, storm: 0 });
  const dawn = surfaceMistEnvelope({ hour: 6.35, fog: 0.00028, rain: 0, wind: 3.5, storm: 0 });
  const windyDawn = surfaceMistEnvelope({ hour: 6.35, fog: 0.00028, rain: 0, wind: 19, storm: 0 });
  const denseFog = surfaceMistEnvelope({ hour: 3, fog: 0.0034, rain: 0, wind: 1.6, storm: 0.02 });
  const hurricane = surfaceMistEnvelope({ hour: 6.35, fog: 0.00134, rain: 1, wind: 36, storm: 1 });

  assert.ok(midday < 0.01);
  assert.ok(dawn > 0.5);
  assert.ok(windyDawn < 0.01);
  assert.ok(denseFog > 0.85);
  assert.ok(hurricane < 0.2);
});
