import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { SITE_CELL } from '../src/sites.js';

const CAMP_CELL = 1600;
const cellKey = (i, j) => `${i},${j}`;

function fixtureWorld(sites = [], camps = []) {
  const world = Object.create(World.prototype);
  const siteCells = new Map(sites.map(site => [cellKey(Math.floor(site.x / SITE_CELL), Math.floor(site.z / SITE_CELL)), site]));
  const campCells = new Map(camps.map(camp => [cellKey(Math.floor(camp.x / CAMP_CELL), Math.floor(camp.z / CAMP_CELL)), camp]));
  world.siteAt = (i, j) => siteCells.get(cellKey(i, j)) ?? null;
  world.campAt = (i, j) => campCells.get(cellKey(i, j)) ?? null;
  return world;
}

function legacyBlockedAt(x, z) {
  for (const st of this.sitesNear(x, z, 30)) {
    const radius = st.kind === 'house' ? 16 : st.kind === 'ramp' ? 22 : 9;
    if (Math.hypot(st.x - x, st.z - z) < radius) return true;
    if (st.kind === 'house' && Math.hypot(st.bank.x - x, st.bank.z - z) < 8) return true;
    if (st.kind === 'ramp') {
      const px = st.x - Math.cos(st.ang) * 14, pz = st.z - Math.sin(st.ang) * 14;
      if (Math.hypot(px - x, pz - z) < 12) return true;
    }
  }
  for (const camp of this.campsNear(x, z, 30)) {
    if (Math.hypot(camp.x - x, camp.z - z) < 12 || Math.hypot(camp.bank.x - x, camp.bank.z - z) < 7) return true;
  }
  return false;
}

test('blocked water checks preserve site, bank, ramp, and camp boundaries', () => {
  const house = { kind: 'house', x: 0, z: 0, bank: { x: 20, z: 0 } };
  const ramp = { kind: 'ramp', x: 800, z: 0, ang: 0 };
  const blind = { kind: 'blind', x: 1600, z: 0 };
  const camp = { x: 3200, z: 0, bank: { x: 3225, z: 0 } };
  const world = fixtureWorld([house, ramp, blind], [camp]);

  assert.equal(world.blockedAt(0, 15.999), true);
  assert.equal(world.blockedAt(0, 16), false);
  assert.equal(world.blockedAt(27.999, 0), true);
  assert.equal(world.blockedAt(28, 0), false);
  assert.equal(world.blockedAt(774.001, 0), true);
  assert.equal(world.blockedAt(774, 0), false);
  assert.equal(world.blockedAt(1600, 8.999), true);
  assert.equal(world.blockedAt(1600, 9), false);
  assert.equal(world.blockedAt(3200, 11.999), true);
  assert.equal(world.blockedAt(3200, 12), false);
  assert.equal(world.blockedAt(3231.999, 0), false);
  assert.equal(world.blockedAt(3225, 6.999), true);
  assert.equal(world.blockedAt(3225, 7), false);
});

test('blocked water checks retain the legacy 30 metre candidate filter', () => {
  const house = { kind: 'house', x: 0, z: 0, bank: { x: 31, z: 0 } };
  const camp = { x: 1600, z: 0, bank: { x: 1631, z: 0 } };
  const world = fixtureWorld([house], [camp]);

  assert.equal(world.blockedAt(31, 0), false);
  assert.equal(world.blockedAt(1631, 0), false);
});

test('allocation-free blocked water checks match the collector implementation', () => {
  const sites = [], camps = [];
  for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
    const hash = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;
    if (hash % 5 === 0) {
      const kind = ['house', 'ramp', 'boathouse', 'blind'][hash % 4];
      const x = (i + 0.5) * SITE_CELL + ((hash >>> 7) % 101) - 50;
      const z = (j + 0.5) * SITE_CELL + ((hash >>> 14) % 101) - 50;
      const ang = (hash % 6283) / 1000;
      sites.push({ kind, x, z, ang, bank: { x: x + Math.cos(ang) * 24, z: z + Math.sin(ang) * 24 } });
    }
    if (i % 2 === 0 && j % 2 === 0 && hash % 5 === 0) {
      const x = (i / 2 + 0.5) * CAMP_CELL + ((hash >>> 5) % 121) - 60;
      const z = (j / 2 + 0.5) * CAMP_CELL + ((hash >>> 12) % 121) - 60;
      camps.push({ x, z, bank: { x: x + 21, z: z - 5 } });
    }
  }
  const world = fixtureWorld(sites, camps);
  world.sitesNear = World.prototype.sitesNear;
  world.campsNear = World.prototype.campsNear;
  let seed = 0x51f15e1d;
  for (let n = 0; n < 20000; n++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = (seed / 4294967296 - 0.5) * 8000;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const z = (seed / 4294967296 - 0.5) * 8000;
    assert.equal(world.blockedAt(x, z), legacyBlockedAt.call(world, x, z), `mismatch at ${x}, ${z}`);
  }
});

test('blocked water checks no longer use array-returning nearby collectors', () => {
  const world = fixtureWorld(
    [{ kind: 'blind', x: 0, z: 0 }],
    [{ x: 1600, z: 0, bank: { x: 1620, z: 0 } }],
  );
  world.sitesNear = () => { throw new Error('sitesNear allocated'); };
  world.campsNear = () => { throw new Error('campsNear allocated'); };

  assert.equal(world.blockedAt(0, 0), true);
  assert.equal(world.blockedAt(1600, 0), true);
  assert.equal(world.blockedAt(4000, 4000), false);
});
