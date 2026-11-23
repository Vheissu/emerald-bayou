import test from 'node:test';
import assert from 'node:assert/strict';
import { Environment } from '../src/environment.js';
import { createWeatherBand, nextWeatherKey, restoreWeatherBand, serializeWeatherBand, weatherBandStrength } from '../src/weatherfronts.js';

function environment() {
  const env = Object.create(Environment.prototype);
  Object.assign(env, {
    game: { save: {}, persist() {} }, phys: { pos: { x: 0, y: 0 }, wet: 0 },
    key: 'calm', values: {}, localWeather: {}, hurricane: {}, windAngle: 0, localWindAngle: 0,
    minutes: 900, minutesPerSecond: 0.8, transition: 24, surfaceWetness: 0,
  });
  env.setWeather('calm', true, false);
  return env;
}

test('a bowed band leaves a dry bank and advects as a continuous field in metres', () => {
  const band = createWeatherBand('lightRain', 15, -40, 0, 0, 0.2);
  const center = weatherBandStrength(band, 15, -40);
  assert.equal(center, 1);
  assert.equal(weatherBandStrength(band, 15, 820), 0);
  const edgeAt = band.shape.width * 0.9;
  const edge = weatherBandStrength(band, edgeAt, -40);
  assert.ok(edge > 0.2 && edge < 0.85);
  assert.ok(Math.abs(weatherBandStrength(band, edgeAt + 0.1, -40) - edge) < 0.001);
  band.age = 74;
  assert.equal(weatherBandStrength(band, 15 + 74 * band.shape.speed, -40), center);
  assert.ok(weatherBandStrength(band, 15, -40) < center);
});

test('the band field and its center survive save and reload even when the boat has moved', () => {
  const band = createWeatherBand('squall', 410, -1267, 1.28, 22, -2.1);
  band.age = 23.87;
  const saved = JSON.parse(JSON.stringify(serializeWeatherBand(band)));
  const restored = restoreWeatherBand('squall', saved);
  for (const [x, z] of [[345, -1450], [380, -1250], [410, -1240], [620, -1550]]) {
    assert.ok(Math.abs(weatherBandStrength(restored, x, z) - weatherBandStrength(band, x, z)) < 1e-12);
  }
  assert.equal(restoreWeatherBand('squall', { ...saved, age: -30 }), null);
  assert.equal(restoreWeatherBand('hurricane', saved), null);
});

test('the saved forecast expires into light rain and the current weather reads the player location', () => {
  const env = environment();
  env.nextKey = 'lightRain'; env.remaining = 1;
  env.persistState(false);
  assert.equal(env.game.save.environment.nextKey, 'lightRain');
  const forecast = env.weatherForecast();
  assert.equal(forecast.currentLabel, 'Calm');
  assert.equal(forecast.nextLabel, 'Light rain');
  env.advanceWeather(0);
  assert.deepEqual(env.weatherForecast(), forecast);
  env.advanceWeather(1);
  assert.equal(env.key, forecast.nextKey);
  assert.ok(env.values.rain < 0.005);
  for (let second = 0; second < 22; second++) env.advanceWeather(1);
  const local = { ...env.values };
  assert.ok(local.rain > 0.3 && local.hail === 0 && local.lightning === 0);
  assert.equal(env.sampleRainAt(env.phys.pos.x, env.phys.pos.y), local.rain);
  assert.equal(env.sampleWindAt(env.phys.pos.x, env.phys.pos.y), local.wind);
  env.phys.pos.x += 2500;
  env.advanceWeather(0);
  assert.ok(env.values.rain < 0.03 && env.values.wind < local.wind && env.values.fog < local.fog);
  assert.equal(env.values.surge, local.surge);
});

test('paused weather keeps its progress and a thunderstorm builds from calm over several seconds', () => {
  const env = environment();
  env.setWeather('thunderstorm', false, false);
  assert.equal(env.values.rain, 0);
  for (let i = 0; i < 12; i++) env.advanceWeather(1);
  const half = { ...env.values }, band = env.weatherBandSnapshot(), forecast = env.weatherForecast();
  assert.ok(half.rain > 0.3 && half.rain < 0.6);
  for (let i = 0; i < 6; i++) env.advanceWeather(0);
  assert.deepEqual(env.values, half);
  assert.deepEqual(env.weatherBandSnapshot(), band);
  assert.deepEqual(env.weatherForecast(), forecast);
  for (let i = 0; i < 12; i++) env.advanceWeather(1);
  assert.ok(env.values.rain > 0.96 && env.values.lightning >= 0.8 && env.values.wind > 17);
  assert.ok(env.values.sea > 1 && env.values.fog > 0.0015);
});

test('afternoon showers favor convection and a spent storm gives way to rain', () => {
  assert.equal(nextWeatherKey('lightRain', 5, 0.76), 'squall');
  assert.equal(nextWeatherKey('lightRain', 15, 0.76), 'thunderstorm');
  assert.equal(nextWeatherKey('calm', 5, 0.18), 'fog');
  assert.equal(nextWeatherKey('thunderstorm', 17, 0.50), 'lightRain');
});

test('forecast arrival rounds to five game minutes and wraps through midnight', () => {
  const env = environment();
  env.minutes = 1438; env.remaining = 9;
  assert.equal(env.weatherForecast().arrivalLabel, '12:05 AM');
  env.minutes = 1021; env.remaining = 3;
  assert.equal(env.weatherForecast().arrivalLabel, '5:05 PM');
  env.minutesPerSecond = 0;
  assert.equal(env.weatherForecast().arrivalLabel, null);
});
