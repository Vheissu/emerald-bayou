import assert from 'node:assert/strict';
import test from 'node:test';
import { CatchTrade, CATCH_SELLERS } from '../src/catchtrade.js';
import { ICE_CHEST_CAPACITY } from '../src/boatmods.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';
import { createDockShift, stepDockShift } from '../src/skiffdockshift.js';

function setup(cash = 60, save = { cash }) {
  const [north, south] = CATCH_SELLERS;
  const dockTie = { x: 55, z: -250 };
  const phys = { pos: { x: north.x, y: north.z }, speed: 0, wet: 1 };
  const snapshots = [];
  const game = {
    playing: true, save,
    persist() { snapshots.push(structuredClone(this.save)); },
  };
  const crews = COVE_MOORINGS.map((berth, i) => ({
    dockShift: createDockShift(berth, i),
    trip: { secured: true, trips: 0, storm: false, phase: 'berthed', timer: 50, catchCount: 0 },
  }));
  const world = {
    waterfront: { mooredSkiffs: crews },
    environment: { day: 1, persistState() { save.environment = { day: this.day }; } },
    campAt(i, j) {
      if (i === -1 && j === 0) return { name: 'Mullet Bend', bank: { x: 300, z: 180 }, tie: { x: 309, z: 180 } };
      return null;
    },
  };
  const trade = new CatchTrade({ game, world, phys, dockTie });
  const mulletBend = trade.buyers[1];
  const move = ({ x, z }, speed = 0) => {
    phys.pos = { x, y: z };
    phys.speed = speed;
  };
  function arrive(index, count) {
    const { dockShift, trip } = crews[index];
    trip.secured = false;
    trip.phase = 'fishing';
    trip.trips++;
    trip.catchCount = count;
    stepDockShift(dockShift, trip, 0.05);
    trip.secured = true;
    trip.phase = 'berthed';
    stepDockShift(dockShift, trip, 0.05);
    assert.equal(dockShift.unloading, true);
  }
  function unload(index) {
    const { dockShift, trip } = crews[index];
    for (let n = 0; n < 700 && dockShift.unloading; n++) stepDockShift(dockShift, trip, 0.05);
    assert.equal(dockShift.unloading, false);
  }
  return { game, world, crews, trade, north, south, dockTie, mulletBend, move, arrive, unload, snapshots, phys };
}

test('crews land different species and the stock cooler takes at most four fish across both crews', () => {
  const { trade, game, arrive, unload, crews, move, north, south, dockTie, snapshots } = setup(200);
  assert.equal(trade.interact().kind, 'empty');
  arrive(0, 3);
  assert.equal(trade.interaction().kind, 'help');
  unload(0);
  assert.deepEqual(trade.stockAt(north.id), { mullet: 2, redfish: 1 });
  assert.equal(trade.interaction().kind, 'buy');
  const sale = trade.interact();
  assert.equal(sale.kind, 'bought');
  assert.equal(sale.count, 3);
  assert.equal(sale.cost, 50);
  assert.equal(sale.payout, 160);
  assert.equal(sale.profit, 110);
  assert.equal(game.save.cash, 150);
  assert.equal(crews[0].dockShift.landedCount, 0);
  assert.equal(snapshots[0].cash, 150);
  assert.deepEqual(snapshots[0].catchTrade.cargo, trade.cargo);
  assert.equal(trade.interact().kind, 'empty');
  arrive(1, 4);
  unload(1);
  move(south);
  assert.deepEqual(trade.stockAt(south.id), { trout: 3, mullet: 1 });
  assert.equal(trade.interact().kind, 'bought');
  assert.equal(trade.capacity, 4);
  assert.equal(trade.cargo.count, 4);
  assert.deepEqual(trade.cargo.items, { mullet: 3, redfish: 1 });
  assert.equal(crews[1].dockShift.landedCount, 3);
  assert.deepEqual(trade.stockAt(south.id), { trout: 3 });
  assert.equal(trade.interact().kind, 'full');
  move(dockTie, 5);
  assert.equal(trade.interact().kind, 'slow');
  assert.equal(game.save.cash, 136);
  move(north);
  assert.ok(trade.cargo);
  move(dockTie);
  assert.equal(trade.interact().kind, 'sold');
  assert.equal(trade.cargo, null);
  assert.equal(trade.destination, null);
  assert.equal(game.save.cash, 340);
  assert.equal(trade.interact(), null);
  assert.equal(snapshots.at(-1).cash, 340);
  assert.equal(snapshots.at(-1).catchTrade.lastSale.count, 4);
});

test('a new player can help finish unloading, use the fee to buy one fish, and repeat the route with the remainder', () => {
  const { trade, game, arrive, unload, crews, move, north, dockTie } = setup(0);
  arrive(0, 3);
  assert.equal(trade.interact().kind, 'helping');
  assert.equal(trade.interact().kind, 'helping', 'repeating the key does not start another shift');
  assert.equal(trade.update(20), null, 'catch is still being unloaded');
  unload(0);
  assert.equal(trade.update(0.1).kind, 'helped');
  assert.equal(trade.update(200), null);
  assert.equal(game.save.cash, 14);
  assert.equal(trade.interact().count, 1);
  assert.equal(game.save.cash, 0);
  assert.equal(crews[0].dockShift.landedCount, 2);
  move(dockTie);
  assert.equal(trade.interact().payout, 44);
  move(north);
  assert.equal(trade.interact().count, 2, 'the same remaining stock stays available');
  move(dockTie);
  assert.equal(trade.interact().kind, 'sold');
  assert.equal(game.save.cash, 124);
});

test('late dock work needs actual unsold fish and is paid once per crew haul', () => {
  const { trade, game, arrive, unload, move, north } = setup(0);
  assert.equal(trade.interact().kind, 'empty');
  arrive(0, 0);
  unload(0);
  assert.equal(trade.interact().kind, 'empty');
  arrive(0, 3);
  unload(0);
  assert.equal(trade.interact().late, true);
  move({ ...north, x: north.x + 11 });
  assert.equal(trade.update(3).kind, 'cancelled');
  assert.equal(game.save.cash, 0);
  move(north);
  assert.equal(trade.interact().kind, 'helping');
  assert.equal(trade.update(1), null);
  game.paused = true;
  assert.equal(trade.update(60), null);
  game.paused = false;
  assert.equal(trade.update(1).kind, 'helped');
  game.save.cash = 0;
  assert.equal(trade.interact().kind, 'insufficient');
  assert.equal(trade.update(20), null);
  arrive(0, 2);
  assert.equal(trade.interact().kind, 'helping', 'a new outing is eligible');
});

test('unloading a specialty catch pays enough to buy at least one fish', () => {
  const { trade, game, arrive, unload, move, south } = setup(0);
  move(south);
  arrive(1, 2);
  assert.equal(trade.interact().wage, 18);
  unload(1);
  assert.equal(trade.update(2).kind, 'helped');
  assert.equal(game.save.cash, 18);
  assert.deepEqual(trade.interact().items, { trout: 1 });
  assert.equal(game.save.cash, 0);
  assert.equal(trade.destination.id, 'mullet-bend');
});

test('cargo and its completed delivery survive a reload without re-running either payment', () => {
  const first = setup(80);
  first.arrive(1, 4);
  first.unload(1);
  first.move(first.south);
  assert.equal(first.trade.interact().kind, 'bought');
  const recovered = setup(0, first.snapshots[0]);
  assert.equal(recovered.trade.cargo.source, recovered.south.id);
  assert.equal(recovered.game.save.cash, 12);
  assert.equal(recovered.trade.destination.name, 'Mullet Bend');
  recovered.move(recovered.mulletBend);
  assert.equal(recovered.trade.update(8), null, 'idling at the destination never sells automatically');
  assert.equal(recovered.trade.interact().kind, 'sold');
  const afterSale = setup(0, recovered.snapshots[0]);
  afterSale.move(afterSale.mulletBend);
  assert.equal(afterSale.trade.interact(), null);
  assert.equal(afterSale.game.save.cash, 271);
  assert.equal(afterSale.trade.lastSale.count, 4);
});

test('remaining stock and the handling receipt reload into a newly spawned crew', () => {
  const first = setup(0);
  first.arrive(0, 3);
  assert.equal(first.trade.interact().kind, 'helping');
  first.unload(0);
  assert.equal(first.trade.update(2).kind, 'helped');
  const wage = first.snapshots.at(-1);
  assert.equal(wage.cash, 14);
  assert.deepEqual(wage.catchTrade.landings[0], { count: 3, species: ['mullet', 'mullet', 'redfish'], haul: 1, handled: true });
  assert.equal(first.trade.interact().count, 1);
  const purchase = first.snapshots.at(-1);
  assert.equal(purchase.cash, 0);
  assert.deepEqual(purchase.catchTrade.landings[0], { count: 2, species: ['mullet', 'redfish'], haul: 1, handled: true });
  assert.equal(purchase.catchTrade.cargo.count, 1);

  const restored = setup(0, purchase);
  restored.trade.update(.05);
  assert.equal(restored.crews[0].trip.trips, 0);
  assert.equal(restored.crews[0].dockShift.landedCount, 2);
  restored.move(restored.dockTie);
  assert.equal(restored.trade.interact().kind, 'sold');
  restored.move(restored.north);
  restored.game.save.cash = 0;
  assert.equal(restored.trade.interaction().kind, 'insufficient', 'the loaded handling receipt cannot pay twice');

  const { dockShift, trip } = restored.crews[0];
  trip.secured = false;
  trip.trips++;
  trip.phase = 'fishing';
  stepDockShift(dockShift, trip, .05);
  restored.trade.update(.05);
  assert.equal(dockShift.landedCount, 0);
  assert.deepEqual(restored.snapshots.at(-1).catchTrade.landings[0], { count: 0, species: [], haul: 2, handled: false });
  trip.catchCount = 4;
  stepDockShift(dockShift, trip, .05);
  trip.secured = true;
  trip.phase = 'berthed';
  stepDockShift(dockShift, trip, .05);
  restored.unload(0);
  assert.deepEqual(restored.trade.stockAt(restored.north.id), { mullet: 2, redfish: 2 });
  assert.equal(restored.trade.interact().kind, 'helping', 'only a new haul earns another wage');
});

test('larger cooler takes a mixed load, tracks manual routing, and pays the actual receiving dock quote', () => {
  const run = setup(200);
  const { trade, arrive, unload, move, south, phys, mulletBend, snapshots } = run;
  phys.tuning = { coolerCapacity: ICE_CHEST_CAPACITY };
  arrive(0, 4);
  unload(0);
  assert.equal(trade.interact().count, 4);
  arrive(1, 4);
  unload(1);
  move(south);
  assert.equal(trade.interact().count, 4);
  assert.equal(trade.capacity, 8);
  assert.equal(trade.cargo.count, 8);
  assert.equal(trade.cargo.cost, 132);
  assert.deepEqual(trade.cargo.items, { mullet: 4, redfish: 1, trout: 3 });
  assert.deepEqual(trade.quotes().map(({ at, payout }) => [at.id, payout]), [
    ['tower', 356], ['mullet-bend', 421],
  ]);
  assert.equal(trade.destination, mulletBend);
  assert.equal(trade.selectBuyer('tower'), true);
  assert.equal(trade.selectBuyer('tower'), true);
  assert.equal(trade.selectBuyer('invalid'), false);

  const restored = setup(0, snapshots.at(-1));
  assert.equal(restored.trade.cargo.count, 8);
  assert.equal(restored.trade.destination.id, 'tower');
  assert.equal(restored.trade.cargo.payout, 356);
  restored.move(restored.mulletBend);
  assert.equal(restored.trade.interaction().payout, 421);
  assert.equal(restored.trade.interact().kind, 'sold');
  assert.equal(restored.game.save.cash, 489);
  assert.equal(restored.trade.receiptAt('mullet-bend').payout, 421);
  assert.equal(restored.trade.receiptAt('tower'), null);
  assert.equal(restored.trade.demand('mullet-bend').find(rate => rate.species === 'trout').remaining, 1);
});

test('a dock pays its premium on only the requested quantity, persists it, and opens a fresh order the next day', () => {
  const { trade, arrive, unload, move, south, mulletBend, snapshots } = setup(200);
  move(south);
  arrive(1, 4);
  unload(1);
  trade.interact();
  move(mulletBend);
  assert.equal(trade.interact().payout, 259);
  move(south);
  arrive(1, 3);
  unload(1);
  trade.interact();
  move(mulletBend);
  const trout = trade.interaction().lines.find(rate => rate.species === 'trout');
  assert.deepEqual([trout.count, trout.premiumCount, trout.payout], [2, 1, 117]);
  assert.equal(trade.interact().payout, 157);
  const restored = setup(0, snapshots.at(-1));
  const rate = species => restored.trade.demand('mullet-bend').find(row => row.species === species);
  assert.deepEqual([rate('trout').remaining, rate('trout').price], [0, 44]);
  restored.world.environment.day = 2;
  restored.trade.update(.05);
  assert.deepEqual(restored.snapshots.at(-1).environment, { day: 2 });
  assert.deepEqual([rate('mullet').remaining, rate('mullet').price], [6, 60]);
  assert.equal(restored.trade.demand('tower').find(row => row.species === 'trout').remaining, 3);
  assert.equal(restored.trade.receiptAt('mullet-bend').payout, 157);
});

test('legacy single-species cargo, tray stock and receipts retain their value', () => {
  const old = {
    cash: 9,
    catchTrade: {
      cargo: { source: 'gulf-north', count: 2, cost: 28, payout: 88 },
      lastSale: { source: 'gulf-south', count: 1, cost: 14, payout: 44 },
      landings: [{ count: 1, handled: true }],
    },
  };
  const { trade, game, north, dockTie, move } = setup(0, old);
  assert.deepEqual(trade.cargo.items, { mullet: 2 });
  assert.equal(trade.destination.id, 'tower');
  assert.equal(trade.cargo.payout, 88);
  assert.deepEqual(trade.stockAt(north.id), { mullet: 1 });
  assert.equal(trade.receiptAt('tower').payout, 44);
  move(dockTie);
  assert.equal(trade.interact().payout, 88);
  assert.equal(game.save.cash, 97);
});

test('purchases verify afloat approach and availability at the moment of interaction', () => {
  const { trade, game, phys, arrive, unload, north, move } = setup(80);
  arrive(0, 1);
  unload(0);
  assert.equal(trade.interaction().kind, 'buy');
  move(north, 8);
  assert.equal(trade.interact().kind, 'slow');
  move(north);
  phys.airborne = true;
  assert.equal(trade.interact().kind, 'slow');
  phys.airborne = false;
  game.state = {};
  assert.equal(trade.interact(), null);
  game.state = null;
  game.navigationAids = { prompting: true };
  assert.equal(trade.interact(), null);
  assert.equal(game.save.cash, 80);
});
