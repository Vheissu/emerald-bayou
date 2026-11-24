import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { CatchTrade, CATCH_SELLERS } from '../src/catchtrade.js';
import { EncounterDirector } from '../src/encounters.js';
import { StoryDirector } from '../src/story.js';
import { WorldMap } from '../src/worldmap.js';

const [pier] = CATCH_SELLERS;
const tower = { x: 60, z: -210 };

function fixture() {
  const hudNode = () => ({ classList: { toggle() {}, remove() {} } });
  const game = Object.assign(Object.create(Game.prototype), {
    playing: true, save: { cash: 0 }, toast() {}, persist() {},
    audio: { pickup() {}, complete() {} },
    phys: { pos: { x: pier.x, y: pier.z }, speed: 0, wet: 1, landFac: 0 },
    dockTie: tower,
    el: { prompt: hudNode(), mission: hudNode(), timer: hudNode(), wp: hudNode(), tricks: hudNode() },
    tricks: { events: [], chain: [] },
  });
  const shift = { landedCount: 0, unloading: true, sorting: true };
  const trip = { trips: 1, secured: true, catchCount: 3 };
  const world = {
    waterfront: { mooredSkiffs: [{ dockShift: shift, trip }] },
    campAt: () => ({ name: 'Mullet Bend', bank: { x: 110, z: -320 }, tie: { x: 110, z: -329 } }),
  };
  game.catchTrade = new CatchTrade({ game, world, phys: game.phys, dockTie: tower });
  game.navigation = {
    pin: pier,
    setPin(x, z, label) { this.pin = { x, z, label }; },
    clearPin() { this.pin = null; },
  };
  const press = (repeat = false) => {
    let prevented = false;
    let claimed = false;
    game.onKey({
      code: 'KeyE', repeat,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { claimed = true; },
    });
    return { prevented, claimed };
  };
  return { game, shift, press };
}

test('the same dock action pays a new player once and requires a fresh press to buy or sell', () => {
  const { game, shift, press } = fixture();
  const trade = game.catchTrade;
  const help = trade.interaction();
  assert.match(game.catchPrompt(help), /input-keyboard"><b>E<.*input-gamepad"><b>A \/ Cross<.*Help unload.*\$14/);
  assert.deepEqual(press(), { prevented: true, claimed: true });
  assert.match(game.catchPrompt(trade.interaction()), /Stay alongside/);
  shift.unloading = shift.sorting = false;
  shift.landedCount = 3;
  game.updateCatchTrade(3);
  assert.equal(game.save.cash, 14);
  assert.match(game.catchPrompt(trade.interaction()), /Buy 1 mullet.*\$14.*1 \/ 4 in cooler/);
  press(true);
  assert.equal(trade.cargo, null);
  press();
  assert.equal(trade.cargo.count, 1);
  assert.equal(game.save.cash, 0);
  assert.equal(game.navigation.pin, null);
  assert.equal(game.navigationTarget(), trade.destination);
  game.phys.pos = { x: tower.x, y: tower.z };
  game.atBoard = true;
  let openedShop = false;
  game.openMenu = () => { openedShop = true; };
  press(true);
  assert.equal(trade.cargo.count, 1);
  press();
  assert.equal(game.save.cash, 44);
  assert.equal(trade.cargo, null);
  press(true);
  assert.equal(openedShop, false);
  press();
  assert.equal(openedShop, true);
});

test('a suggested waypoint yields to a delivery and a real mission retains its own route', () => {
  const { game, shift, press } = fixture();
  shift.unloading = shift.sorting = false;
  shift.landedCount = 3;
  game.save.cash = 50;
  const pin = game.navigation.pin = { x: 58, z: -205, label: 'My pin' };
  press();
  assert.equal(game.navigation.pin, pin);
  game.wpTarget = { x: 1, z: 4, suggested: true };
  assert.equal(game.navigationTarget(), game.catchTrade.destination);
  game.wpTarget = { x: 1, z: 4, label: 'Mission dock' };
  game.state = { m: {} };
  assert.equal(game.navigationTarget(), game.wpTarget);
  game.wpTarget = null;
  assert.equal(game.navigationTarget(), null);
  game.state = null;
  assert.equal(game.navigationTarget(), game.catchTrade.destination);
});

test('automatic radio search and a distant offer leave buying, the delivery route and the Tower Dock shop available', () => {
  const { game, shift, press } = fixture();
  game.story = Object.assign(Object.create(StoryDirector.prototype), {
    state: { stage: 'search' }, wantInput: false,
    hud: () => ({ title: 'Running Dark', obj: 'Leon’s last radio fix' }),
  });
  game.encounters = Object.assign(Object.create(EncounterDirector.prototype), {
    active: { type: 'race', state: 'challenge', known: true }, enabled: true, prompting: false,
  });
  game.wpTarget = { x: 1, z: 4, label: 'Leon’s last radio fix', story: true };
  game.condition = { serviceLocation: () => ({ home: true }) };
  game.save.cash = 50;
  shift.unloading = shift.sorting = false;
  shift.landedCount = 3;
  assert.equal(game.story.blocking(), true);
  game.updateDockPrompt(false, true);
  assert.match(game.el.prompt.innerHTML, /Buy 2 mullet, 1 redfish.*\$50.*3 \/ 4 in cooler/);
  press();
  assert.equal(game.navigationTarget(), game.catchTrade.destination);
  game.renderHud();
  assert.match(game.el.mission.innerHTML, /Fish delivery.*Tower Dock/);
  game.encounters.game = game;
  game.encounters.point(9, 4, 'Race challenge', '#fff');
  assert.equal(game.wpTarget.label, 'Race challenge');
  assert.equal(game.el.wp.textContent, '');
  assert.equal(game.el.wp.innerHTML, undefined);
  game.phys.pos = { x: tower.x, y: tower.z };
  game.updateDockPrompt(false, true);
  assert.match(game.el.prompt.innerHTML, /Unload 2 mullet, 1 redfish.*\$160/);
  press();
  assert.equal(game.catchTrade.cargo, null);
  assert.equal(game.save.cash, 160);
  assert.equal(game.navigationTarget(), game.wpTarget);
  game.renderHud();
  assert.match(game.el.mission.innerHTML, /Running Dark/);
  game.updateDockPrompt(false, true);
  assert.match(game.el.prompt.innerHTML, /dock shop/);
  let tab;
  game.openMenu = value => { tab = value; };
  press();
  assert.equal(tab, 'boat');
});

test('a route selected from the chart becomes a trade destination and shows the chosen offer', () => {
  const { game, shift, press } = fixture();
  const trade = game.catchTrade;
  const [, bend] = trade.buyers;
  const chart = Object.assign(Object.create(WorldMap.prototype), {
    G: game, market: { hidden: true }, render() {},
  });
  shift.unloading = shift.sorting = false;
  shift.landedCount = 3;
  game.save.cash = 50;
  chart.routeToBuyer(bend.id);
  assert.deepEqual(game.navigation.pin, { x: bend.x, z: bend.z, label: bend.label });
  press();
  assert.equal(game.navigation.pin, null);
  assert.equal(trade.destination, bend);
  game.renderHud();
  assert.match(game.el.mission.innerHTML, /Deliver to Mullet Bend.*\$122 on delivery/);
  chart.routeToBuyer('tower');
  assert.equal(trade.destination, trade.saleTarget);
  game.phys.pos = { x: bend.x, y: bend.z };
  game.updateDockPrompt(true, true);
  assert.match(game.el.prompt.innerHTML, /Unload 2 mullet, 1 redfish.*\$122/);
  press();
  assert.equal(trade.receiptAt(bend.id).payout, 122);
});

test('committed story work and encounters keep priority over cargo', () => {
  const { game, shift, press } = fixture();
  game.save.cash = 14;
  shift.unloading = shift.sorting = false;
  shift.landedCount = 1;
  press();
  game.phys.pos = { x: tower.x, y: tower.z };
  game.wpTarget = { x: 1, z: 4, label: 'Picked-up story objective' };
  game.story = Object.assign(Object.create(StoryDirector.prototype), {
    state: { stage: 'delivery' }, wantInput: false,
  });
  assert.equal(game.catchTrade.interaction(), null);
  assert.equal(game.navigationTarget(), game.wpTarget);
  game.story.state.stage = 'search';
  game.story.wantInput = true;
  assert.equal(game.catchTrade.interaction(), null);
  game.story.wantInput = false;
  game.encounters = Object.assign(Object.create(EncounterDirector.prototype), {
    active: { type: 'race', state: 'running' }, enabled: true, prompting: false,
  });
  assert.equal(game.catchTrade.interaction(), null);
  assert.equal(game.navigationTarget(), game.wpTarget);
  game.encounters.active.state = 'challenge';
  game.encounters.prompting = true;
  assert.equal(game.catchTrade.interaction(), null);
  game.encounters.enabled = false;
  assert.equal(game.catchTrade.interaction().kind, 'sell');
  assert.equal(game.navigationTarget(), game.catchTrade.destination);
  game.encounters.active = { type: 'patrol', state: 'check' };
  assert.equal(game.catchTrade.interaction(), null);
});

test('cargo and the latest sale count as game progress', () => {
  const { game } = fixture();
  assert.equal(game.hasProgress(), false);
  const lot = { source: pier.id, count: 1, cost: 14, payout: 44 };
  game.save.catchTrade.cargo = lot;
  assert.equal(game.hasProgress(), true);
  game.save.catchTrade.cargo = null;
  game.save.catchTrade.lastSale = lot;
  assert.equal(game.hasProgress(), true);
});
