import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Environment } from '../src/environment.js';
import {
  insertNearestSettlement, MAX_SETTLEMENT_LIGHTS, MAX_SETTLEMENT_OUTAGES, normalizeSettlementOutages,
  resetSettlementCandidates, serializeSettlementOutages, settlementGridStress, settlementLightLevel,
  settlementPowerRoll, settlementPowerStep, settlementPowerTarget, settlementStrikeOutageMinutes,
} from '../src/settlementpower.js';

test('grid stress follows the weather while hurricane eye conditions remain an outage risk', () => {
  const squall = settlementGridStress('squall', { storm: 0.68, wind: 14, lightning: 0.2, surge: 0.08 });
  const thunder = settlementGridStress('thunderstorm', { storm: 0.9, wind: 18, lightning: 0.9, surge: 0.12 });
  const tropical = settlementGridStress('tropical', { storm: 1, wind: 25, lightning: 0.45, surge: 0.32 });
  const hurricane = settlementGridStress('hurricane', { storm: 1, wind: 36, lightning: 0.62, surge: 0.9 });
  const eye = settlementGridStress('hurricane', { storm: 0.32, wind: 3.2, lightning: 0.035, surge: 0.9 });
  assert.equal(settlementGridStress('fair', { storm: 1, wind: 40, lightning: 1, surge: 1 }), 0);
  assert.ok(squall < thunder && thunder < tropical && tropical < hurricane);
  assert.ok(eye > 0.68); assert.ok(hurricane <= 0.86);
});

test('each settlement keeps a deterministic daily grid vulnerability', () => {
  const first = settlementPowerRoll('camp:12,-7', 4);
  assert.equal(settlementPowerRoll('camp:12,-7', 4), first);
  assert.notEqual(settlementPowerRoll('camp:12,-7', 5), first);
  assert.notEqual(settlementPowerRoll('site:12,-7', 4), first);
});

test('grid stress produces blackouts, brownouts and surviving power without random frame churn', () => {
  assert.equal(settlementPowerTarget(0.2, 0.3), 0);
  assert.ok(settlementPowerTarget(0.35, 0.3) > 0.48 && settlementPowerTarget(0.35, 0.3) < 0.78);
  assert.equal(settlementPowerTarget(0.9, 0.3), 1);
  assert.equal(settlementPowerTarget(0.9, 0, true), 0);
});

test('lights lose supply quickly and restore it slowly after conditions clear', () => {
  const failed = settlementPowerStep(1, 0, 1);
  const restoring = settlementPowerStep(0, 1, 1);
  assert.ok(failed < 0.01); assert.ok(restoring > 0.12 && restoring < 0.14);
  assert.equal(settlementPowerStep(0.6, 0.6, 1), 0.6);
});

test('storm flicker is deterministic and a dead circuit stays dark', () => {
  assert.equal(settlementLightLevel(1, 0, 12, 0.4), 1);
  assert.equal(settlementLightLevel(0, 1, 12, 0.4), 0);
  const a = settlementLightLevel(0.62, 0.75, 12, 0.4), b = settlementLightLevel(0.62, 0.75, 12.17, 0.4);
  assert.equal(settlementLightLevel(0.62, 0.75, 12, 0.4), a);
  assert.notEqual(a, b); assert.ok(a >= 0 && a <= 0.62); assert.ok(b >= 0 && b <= 0.62);
});

test('only a close enough strike can leave a lasting settlement outage', () => {
  assert.equal(settlementStrikeOutageMinutes(106, 1, 0), 0);
  assert.equal(settlementStrikeOutageMinutes(90, 0.2, 0.95), 0);
  assert.ok(settlementStrikeOutageMinutes(18, 0.9, 0.1) > 100);
});

test('saved strike outages discard stale data and stay bounded', () => {
  const raw = [['expired', 99], ['invalid', 'later']];
  for (let i = 0; i < 32; i++) raw.push([`site:${i}`, 110 + i]);
  const outages = normalizeSettlementOutages(raw, 100, MAX_SETTLEMENT_OUTAGES);
  assert.equal(outages.size, MAX_SETTLEMENT_OUTAGES); assert.equal(outages.has('expired'), false); assert.equal(outages.has('site:0'), false);
  const saved = serializeSettlementOutages(outages, 100, MAX_SETTLEMENT_OUTAGES);
  assert.equal(saved.length, MAX_SETTLEMENT_OUTAGES); assert.ok(saved[0][1] >= saved.at(-1)[1]);
});

test('nearest-light selection reuses its fixed slots and rejects farther settlements', () => {
  const slots = Array.from({ length: MAX_SETTLEMENT_LIGHTS }, () => ({ key: '', x: 0, y: 0, z: 0, distanceSq: Infinity }));
  const identities = slots.slice(); resetSettlementCandidates(slots);
  for (let i = 9; i >= 0; i--) insertNearestSettlement(slots, `site:${i}`, i, 2, 0, i * i);
  assert.deepEqual(slots.map(slot => slot.key), ['site:0', 'site:1', 'site:2', 'site:3', 'site:4']);
  assert.ok(slots.every((slot, index) => slot === identities[index]));
});

test('settlement lighting keeps one five-light pool with shared bulb resources', () => {
  const environment = Object.create(Environment.prototype); environment.scene = new THREE.Scene(); environment.settlementOutages = new Map(); environment.settlementPowerFailures = 0;
  environment.makeSettlementLights();
  assert.equal(environment.settlementLights.length, MAX_SETTLEMENT_LIGHTS);
  assert.equal(new Set(environment.settlementLights.map(entry => entry.bulb.geometry)).size, 1);
  assert.equal(new Set(environment.settlementLights.map(entry => entry.bulb.material)).size, 1);
  assert.ok(environment.settlementLights.every(entry => entry.light.isPointLight && entry.light.castShadow === false));
  environment.settlementBulbGeometry.dispose(); environment.settlementBulbMaterial.dispose();
});

test('a close lightning strike records bounded outages against loaded settlement ids', () => {
  const environment = Object.create(Environment.prototype), site = { key: '1,1', kind: 'house', x: 0, z: 0 }, camp = { key: '2,2', x: 28, z: 0 };
  let persisted = 0;
  Object.assign(environment, {
    minutes: 100, values: { lightning: 1 }, settlementOutages: new Map(), settlementPowerFailures: 0,
    world: { liveSites: new Map([['site', { site }]]), liveCamps: new Map([['camp', { userData: { site: camp } }]]) },
    persistState() { persisted++; },
  });
  const random = Math.random; Math.random = () => 0;
  try { assert.equal(environment.registerSettlementPowerStrike(0, 0), 2); } finally { Math.random = random; }
  assert.equal(environment.settlementOutages.size, 2); assert.ok(environment.settlementOutages.size <= MAX_SETTLEMENT_OUTAGES);
  assert.equal(environment.settlementPowerFailures, 2); assert.equal(persisted, 1);
});
