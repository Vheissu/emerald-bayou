import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SAVE_DEFER_MS } from '../src/game.js';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { const text = String(value); values.set(key, text); writes.push([key, text]); },
    removeItem(key) { values.delete(key); },
  };
}

function makeGame() {
  return Object.assign(Object.create(Game.prototype), {
    persistenceDisabled: false,
    persistTimer: null,
    persistPending: false,
    persistenceStats: { requests: 0, writes: 0, coalesced: 0, errors: 0, lastMs: 0, maxMs: 0, lastChars: 0 },
    save: { cash: 0, best: {}, done: [] },
    captures: 0,
    captureBoatPosition() { this.captures++; return true; },
  });
}

async function withStorage(storage, run) {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  try { return await run(storage); }
  finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
}

test('same-frame save requests serialize only the latest state once', async () => {
  await withStorage(makeStorage(), storage => {
    const game = makeGame();
    assert.equal(game.persist(), true);
    game.save.cash = 42;
    assert.equal(game.persist(), false);
    assert.equal(game.persist(), false);
    assert.equal(storage.writes.length, 0);

    assert.equal(game.flushPersistence(), true);
    assert.equal(storage.writes.length, 1);
    assert.equal(JSON.parse(storage.writes[0][1]).cash, 42);
    assert.equal(game.captures, 1);
    assert.deepEqual(
      { requests: game.persistenceStats.requests, writes: game.persistenceStats.writes, coalesced: game.persistenceStats.coalesced },
      { requests: 3, writes: 1, coalesced: 2 },
    );
    assert.equal(game.persistTimer, null);
  });
});

test('ordinary saves leave the triggering frame before the deferred write', async () => {
  assert.equal(SAVE_DEFER_MS, 40);
  await withStorage(makeStorage(), async storage => {
    const game = makeGame(); game.persist();
    assert.equal(storage.writes.length, 0);
    await new Promise(resolve => setTimeout(resolve, SAVE_DEFER_MS + 20));
    assert.equal(storage.writes.length, 1);
    assert.equal(game.persistenceStats.writes, 1);
  });
});

test('page-exit flush can durably save even without a pending timer', async () => {
  await withStorage(makeStorage(), storage => {
    const game = makeGame(); game.save.cash = 17;
    assert.equal(game.flushPersistence(true), true);
    assert.equal(JSON.parse(storage.writes[0][1]).cash, 17);
  });
});

test('new-game reset cancels a pending write before clearing storage', async () => {
  const key = 'emeraldBayou.save.v2', storage = makeStorage({ [key]: '{"cash":9}' });
  const previousLocation = globalThis.location;
  let reloaded = 0;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { reload() { reloaded++; } } });
  try {
    await withStorage(storage, () => {
      const game = makeGame(); game.newGameArmed = () => true; game.persist();
      assert.notEqual(game.persistTimer, null);
      assert.equal(game.requestNewGame(), true);
      assert.equal(game.persistTimer, null);
      assert.equal(game.persistPending, false);
      assert.equal(game.flushPersistence(true), false);
      assert.equal(storage.getItem(key), null);
      assert.equal(storage.writes.length, 0);
      assert.equal(reloaded, 1);
    });
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', { configurable: true, value: previousLocation });
  }
});
