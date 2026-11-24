import { COVE_MOORINGS } from './waterfrontlayout.js';

export const CATCH_BUY_PRICE = 14;
export const CATCH_SALE_PRICE = 44;
export const CATCH_HANDLING_WAGE = CATCH_BUY_PRICE;
const LOT_LIMIT = 4;
const INTERACTION_RANGE = 10;
const IDLE_SPEED = 2.68; // about 6 mph
const HANDLING_SECONDS = 2;

export const CATCH_SELLERS = Object.freeze(COVE_MOORINGS.map(({ pier, side }, index) => {
  const shore = index === 0 ? 'North' : 'South';
  return Object.freeze({
    id: `gulf-${shore.toLowerCase()}`, name: `Gulf Cut ${shore} Pier`, index,
    x: pier.head + 5.5, z: pier.z + side * 4.6,
  });
}));

function validCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= LOT_LIMIT;
}

function makeLot(source, count) {
  return { source, count, cost: count * CATCH_BUY_PRICE, payout: count * CATCH_SALE_PRICE };
}

function restoreLot(lot) {
  if (!lot || !validCount(lot.count) || lot.count === 0 || !CATCH_SELLERS.some(seller => seller.id === lot.source)) return null;
  return makeLot(lot.source, lot.count);
}

function onWater(boat) {
  return !boat.airborne && !(boat.wipeT > 0) && !(boat.wet < 0.45) && !(boat.landFac > 0.45);
}

export class CatchTrade {
  constructor({ game, world, phys, dockTie }) {
    this.game = game;
    this.world = world;
    this.phys = phys;
    this.saleTarget = Object.freeze({ id: 'tower', name: 'Tower Dock', label: 'Tower Dock', x: dockTie.x, z: dockTie.z });
    const saved = game.save.catchTrade;
    this.save = game.save.catchTrade = {
      cargo: restoreLot(saved?.cargo),
      lastSale: restoreLot(saved?.lastSale),
      landings: CATCH_SELLERS.map(({ index }) => {
        const entry = saved?.landings?.[index];
        return { count: validCount(entry?.count) ? entry.count : 0, handled: entry?.handled === true };
      }),
    };
    this.helping = null;
    this.seenHauls = new WeakMap();
  }

  get cargo() { return this.save.cargo; }
  get lastSale() { return this.save.lastSale; }
  get destination() { return this.cargo ? this.saleTarget : null; }

  within(point) {
    const { x, y: z } = this.phys.pos;
    return (x - point.x) ** 2 + (z - point.z) ** 2 <= INTERACTION_RANGE ** 2;
  }

  isIdle() {
    return onWater(this.phys) && Math.abs(this.phys.speed) < IDLE_SPEED;
  }

  isPaused() {
    const { game } = this;
    return !game.playing || game.paused || game.menuOpen || game.mapOpen || game.resultOpen;
  }

  busy() {
    const { game } = this;
    return game.state || game.traveling || game.inputLock || game.fishing?.blocking?.()
      || game.story?.catchTradeBusy?.() || game.aftermath?.blocking?.() || game.aftermath?.interactiveNear
      || game.encounters?.catchTradeBusy?.() || game.life?.traffic?.activeCollision?.() || game.discoveries?.prompting
      || game.incidents?.prompting || game.marshFire?.prompting || game.navigationAids?.prompting;
  }

  sellerBoat(at) {
    return this.world.waterfront?.mooredSkiffs?.[at.index];
  }

  syncLandings() {
    let changed = false;
    for (const at of CATCH_SELLERS) {
      const crew = this.sellerBoat(at);
      if (!crew?.dockShift) continue;
      const { trip, dockShift: shift } = crew;
      const landing = this.save.landings[at.index];
      const previousHaul = this.seenHauls.get(shift);
      // The world rebuilds its crews on launch. Restore their remaining
      // stock before the first fishing trip, then follow the live tray.
      if (previousHaul === undefined && trip.trips === 0) shift.landedCount = landing.count;
      this.seenHauls.set(shift, trip.trips);
      const newHaul = trip.trips > 0 && trip.trips !== previousHaul;
      const sorting = shift.sorting || (shift.unloading && shift.catchCount > 0);
      const count = sorting ? (newHaul ? 0 : landing.count) : validCount(shift.landedCount) ? shift.landedCount : 0;
      if (count !== landing.count || (newHaul && landing.handled)) changed = true;
      landing.count = count;
      if (newHaul) landing.handled = false;
    }
    return changed;
  }

  sellerOffer(at) {
    const crew = this.sellerBoat(at);
    const shift = crew?.dockShift;
    if (!shift || !crew.trip.secured) return { kind: 'empty', at };
    if (this.helping?.at === at) return { kind: 'helping', at, wage: CATCH_HANDLING_WAGE, late: this.helping.late };
    const stock = validCount(shift.landedCount) ? shift.landedCount : 0;
    const canHelp = !this.save.landings[at.index].handled;
    const late = !shift.unloading && stock > 0 && this.game.save.cash < CATCH_BUY_PRICE;
    if (canHelp && ((shift.unloading && crew.trip.trips > 0 && crew.trip.catchCount > 0) || late)) {
      return { kind: 'help', at, wage: CATCH_HANDLING_WAGE, late };
    }
    if (!stock || shift.unloading) return { kind: 'empty', at };
    const count = Math.min(stock, Math.floor(this.game.save.cash / CATCH_BUY_PRICE));
    const lot = makeLot(at.id, Math.max(1, count));
    return { ...lot, kind: count > 0 ? 'buy' : 'insufficient', at, available: stock, profit: lot.payout - lot.cost };
  }

  interaction() {
    if (this.isPaused() || this.busy()) return null;
    if (this.cargo) {
      const at = this.destination;
      if (!this.within(at)) return null;
      const { payout, cost } = this.cargo;
      return { ...this.cargo, kind: this.isIdle() ? 'sell' : 'slow', at, profit: payout - cost };
    }
    const at = CATCH_SELLERS.find(seller => this.within(seller));
    if (!at) return null;
    if (!this.isIdle()) return { kind: 'slow', at };
    return this.sellerOffer(at);
  }

  interact() {
    const stockChanged = this.syncLandings();
    const offer = this.interaction();
    switch (offer?.kind) {
      case 'help': {
        const { at, late } = offer;
        this.helping = { at, elapsed: 0, late, haul: this.sellerBoat(at).trip.trips };
        if (stockChanged) this.game.persist();
        return { ...offer, kind: 'helping' };
      }
      case 'buy': {
        const { at, source, count, cost, payout } = offer;
        const shift = this.sellerBoat(at).dockShift;
        shift.landedCount -= count;
        this.save.landings[at.index].count = shift.landedCount;
        this.save.cargo = { source, count, cost, payout };
        this.game.save.cash -= cost;
        this.game.persist();
        return { ...offer, kind: 'bought' };
      }
      case 'sell': {
        const lot = this.cargo;
        this.save.cargo = null;
        this.save.lastSale = lot;
        this.game.save.cash += lot.payout;
        this.game.persist();
        return { ...offer, kind: 'sold' };
      }
      default:
        if (stockChanged) this.game.persist();
        return offer;
    }
  }

  update(dt) {
    const stockChanged = this.syncLandings();
    const result = this.updateHandling(dt);
    if (stockChanged || result?.kind === 'helped') this.game.persist();
    return result;
  }

  updateHandling(dt) {
    if (!this.helping || !(dt > 0) || this.isPaused()) return null;
    const job = this.helping;
    const { at, haul } = job;
    const crew = this.sellerBoat(at);
    if (this.busy() || !this.within(at) || !this.isIdle() || !crew?.trip.secured || crew.trip.trips !== haul) {
      this.helping = null;
      return { kind: 'cancelled', at, wage: CATCH_HANDLING_WAGE };
    }
    job.elapsed += dt;
    const shift = crew.dockShift;
    if (job.elapsed < HANDLING_SECONDS || shift.unloading || shift.sorting) return null;
    this.helping = null;
    const landing = this.save.landings[at.index];
    if (!(shift.landedCount > 0) || landing.handled) return { kind: 'cancelled', at, wage: CATCH_HANDLING_WAGE };
    landing.handled = true;
    this.game.save.cash += CATCH_HANDLING_WAGE;
    return { kind: 'helped', at, wage: CATCH_HANDLING_WAGE };
  }
}
