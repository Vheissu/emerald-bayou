import { COVE_MOORINGS } from './waterfrontlayout.js';
import { MULLET_BEND_KEY } from './mulletlanding.js';
import { buyerDemand, countSpecies, marketHaul, MARKET_FISH, FISH_IDS, CREW_CATCH_LIMIT } from './fishmarket.js';
import { STOCK_COOLER_CAPACITY, ICE_CHEST_CAPACITY } from './boatmods.js';

const INTERACTION_RANGE = 10;
const IDLE_SPEED = 2.68; // about 6 mph
const HANDLING_SECONDS = 2;
const LEGACY_MULLET_PRICE = 44;

export const CATCH_SELLERS = Object.freeze(COVE_MOORINGS.map(({ pier, side }, index) => {
  const shore = index === 0 ? 'North' : 'South';
  return Object.freeze({
    id: `gulf-${shore.toLowerCase()}`, name: `Gulf Cut ${shore} Pier`, index,
    x: pier.head + 5.5, z: pier.z + side * 4.6,
  });
}));

function whole(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : 0;
}

function isFish(id) { return FISH_IDS.includes(id); }

function stockCost(items) {
  return FISH_IDS.reduce((sum, id) => sum + (items[id] || 0) * MARKET_FISH[id].buy, 0);
}

function restoreStock(landing) {
  if (!Array.isArray(landing?.species)) return Array(whole(landing?.count, CREW_CATCH_LIMIT)).fill('mullet');
  return landing.species.filter(isFish).slice(0, CREW_CATCH_LIMIT);
}

function restoreLot(lot, buyers) {
  const sources = (Array.isArray(lot?.sources) ? lot.sources : [lot?.source])
    .filter(id => CATCH_SELLERS.some(seller => seller.id === id));
  if (sources.length === 0) return null;
  const items = {};
  if (lot.items && typeof lot.items === 'object') {
    let slots = ICE_CHEST_CAPACITY;
    for (const id of FISH_IDS) {
      const count = Math.min(slots, whole(lot.items[id], ICE_CHEST_CAPACITY));
      if (count > 0) items[id] = count;
      slots -= count;
    }
  } else {
    const count = whole(lot.count, CREW_CATCH_LIMIT);
    if (count > 0) items.mullet = count;
  }
  const count = Object.values(items).reduce((sum, n) => sum + n, 0);
  if (!count) return null;
  const buyer = buyers.some(at => at.id === lot.buyer) ? lot.buyer : 'tower';
  return {
    source: sources[0], sources: [...new Set(sources)], items, count, cost: stockCost(items),
    payout: lot.items ? whole(lot.payout, ICE_CHEST_CAPACITY * 100) : LEGACY_MULLET_PRICE * count,
    buyer, selected: !lot.items || lot.selected === true,
  };
}

function buyer(id, name, at) {
  return Object.freeze({ id, name, label: name, x: at.x, z: at.z });
}

function makeBuyers(world, dockTie) {
  const sites = [buyer('tower', 'Tower Dock', dockTie)];
  const [i, j] = MULLET_BEND_KEY.split(',').map(Number);
  const camp = world?.campAt?.(i, j);
  if (camp) {
    const dx = camp.tie.x - camp.bank.x, dz = camp.tie.z - camp.bank.z;
    const length = Math.hypot(dx, dz);
    // The camp's tie lies on the dock centerline. Route to its deep approach alongside.
    if (length > 0) sites.push(buyer('mullet-bend', camp.name, {
      x: camp.bank.x + (13 * dx + 5 * dz) / length,
      z: camp.bank.z + (13 * dz - 5 * dx) / length,
    }));
  }
  return Object.freeze(sites);
}

function onWater(boat) {
  return !boat.airborne && !(boat.wipeT > 0) && !(boat.wet < 0.45) && !(boat.landFac > 0.45);
}

export class CatchTrade {
  constructor({ game, world, phys, dockTie }) {
    this.game = game;
    this.world = world;
    this.phys = phys;
    this.buyers = makeBuyers(world, dockTie);
    this.saleTarget = this.buyers[0];
    const saved = game.save.catchTrade;
    const lastSale = restoreLot(saved?.lastSale, this.buyers);
    this.save = game.save.catchTrade = {
      cargo: restoreLot(saved?.cargo, this.buyers),
      lastSale,
      receipts: Object.fromEntries(this.buyers.map(at => [
        at.id, restoreLot(saved?.receipts?.[at.id], this.buyers) || (lastSale?.buyer === at.id ? lastSale : null),
      ])),
      day: whole(saved?.day, 36501) || 1,
      fulfilled: Object.fromEntries(this.buyers.map(({ id }) => [id, whole(saved?.fulfilled?.[id], ICE_CHEST_CAPACITY)])),
      landings: CATCH_SELLERS.map(({ index }) => {
        const entry = saved?.landings?.[index];
        const species = restoreStock(entry);
        return { count: species.length, species, haul: whole(entry?.haul, Number.MAX_SAFE_INTEGER), handled: entry?.handled === true };
      }),
    };
    this.helping = null;
    this.seenHauls = new WeakMap();
    this.repriceLoad();
  }

  get capacity() { return this.phys.tuning?.coolerCapacity || STOCK_COOLER_CAPACITY; }
  get cargo() { return this.save.cargo; }
  get lastSale() { return this.save.lastSale; }
  get destination() { return this.findBuyer(this.cargo?.buyer); }
  findBuyer(id) { return this.buyers.find(at => at.id === id) || null; }
  receiptAt(id) { return this.save.receipts[id] || null; }

  demand(id) {
    return buyerDemand(id, this.save.day, this.save.fulfilled[id] || 0);
  }

  quotes(items = this.cargo?.items) {
    return this.buyers.map(at => {
      const lines = this.demand(at.id).map(rate => {
        const count = items?.[rate.species] || 0;
        const premiumCount = Math.min(count, rate.remaining);
        const payout = premiumCount * rate.price + (count - premiumCount) * rate.base;
        return { ...rate, count, premiumCount, payout };
      });
      const payout = lines.reduce((sum, line) => sum + line.payout, 0);
      return { at, lines, payout };
    });
  }

  bestQuote(quotes) {
    return quotes.reduce((best, quote) => quote.payout > best.payout ? quote : best);
  }

  repriceLoad() {
    if (!this.cargo) return;
    const quotes = this.quotes();
    const quote = (this.cargo.selected && quotes.find(({ at }) => at.id === this.cargo.buyer)) || this.bestQuote(quotes);
    this.cargo.buyer = quote.at.id;
    this.cargo.payout = quote.payout;
  }

  selectBuyer(id) {
    if (!this.cargo || !this.findBuyer(id)) return false;
    this.cargo.buyer = id;
    this.cargo.selected = true;
    this.repriceLoad();
    this.game.persist();
    return true;
  }

  syncOrders() {
    const day = whole(this.world?.environment?.day, 36501);
    if (day <= this.save.day) return false;
    this.save.day = day;
    for (const at of this.buyers) this.save.fulfilled[at.id] = 0;
    this.world.environment.persistState?.(false);
    this.repriceLoad();
    return true;
  }

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
    return this.world?.waterfront?.mooredSkiffs?.[at.index];
  }

  landingSpecies(index) {
    const at = CATCH_SELLERS[index], crew = this.sellerBoat(at), landing = this.save.landings[index];
    const shift = crew?.dockShift;
    if (!shift) return [];
    const previous = this.seenHauls.get(shift);
    if (previous === undefined && crew.trip.trips === 0) return landing.species;
    const next = crew.trip.trips > 0 && crew.trip.trips !== previous;
    const haul = landing.haul + Number(next);
    const count = whole(shift.landedCount, CREW_CATCH_LIMIT);
    if (!next && count === landing.count) return landing.species;
    if (!next && count < landing.count) return landing.species.slice(0, count);
    return marketHaul(index, haul).slice(0, count);
  }

  stockAt(id) {
    const at = CATCH_SELLERS.find(seller => seller.id === id);
    if (!at) return {};
    const crew = this.sellerBoat(at);
    if (!crew?.trip.secured || !crew.dockShift || crew.dockShift.unloading || crew.dockShift.sorting) return {};
    return countSpecies(this.landingSpecies(at.index));
  }

  syncLandings() {
    let changed = false;
    for (const at of CATCH_SELLERS) {
      const crew = this.sellerBoat(at);
      if (!crew?.dockShift) continue;
      const { trip, dockShift: shift } = crew;
      const landing = this.save.landings[at.index];
      const previous = this.seenHauls.get(shift);
      // Restore the remaining tray before either crew has fished since launch.
      if (previous === undefined && trip.trips === 0) shift.landedCount = landing.count;
      const next = trip.trips > 0 && trip.trips !== previous;
      const count = whole(shift.landedCount, CREW_CATCH_LIMIT);
      if (next || count !== landing.count) {
        landing.species = this.landingSpecies(at.index);
        landing.count = count;
        if (next) {
          landing.haul++;
          landing.handled = false;
        }
        changed = true;
      }
      this.seenHauls.set(shift, trip.trips);

      const haul = marketHaul(at.index, landing.haul);
      shift.haulSpecies = haul;
      shift.marketSpecies = landing.species;
      shift.species = landing.species[0] || haul[0];
      if (!trip.secured) {
        shift.creelSpecies = haul;
      } else if (shift.unloading) {
        const hasFishInHand = shift.sorting && shift.sortProgress >= 0.28 && shift.sortProgress < 0.78;
        const nextFish = count + Number(hasFishInHand);
        shift.sortSpecies = haul[count];
        shift.creelSpecies = haul.slice(nextFish, nextFish + shift.catchCount);
      }
    }
    return changed;
  }

  sellerOffer(at) {
    const crew = this.sellerBoat(at);
    const shift = crew?.dockShift;
    if (!shift || !crew.trip.secured) return { kind: 'empty', at };
    if (this.helping?.at === at) return { kind: 'helping', at, wage: this.helping.wage, late: this.helping.late };
    const stock = this.landingSpecies(at.index);
    const sorting = shift.unloading || shift.sorting;
    const slots = Math.max(0, this.capacity - (this.cargo?.count ?? 0));
    const landing = this.save.landings[at.index];
    const newHaul = crew.trip.trips > 0 && this.seenHauls.get(shift) !== crew.trip.trips;
    const canHelp = !landing.handled || newHaul;
    const cash = this.game.save.cash;
    const late = !sorting && stock.length > 0 && stock.every(id => MARKET_FISH[id].buy > cash);
    if (canHelp && ((sorting && crew.trip.trips > 0 && crew.trip.catchCount > 0) || late)) {
      // An unloading wage always covers at least one fish from this crew's haul.
      const species = sorting ? marketHaul(at.index, landing.haul + Number(newHaul)).slice(0, crew.trip.catchCount) : stock;
      const wage = Math.min(...species.map(id => MARKET_FISH[id].buy));
      return { kind: 'help', at, wage, late };
    }
    if (!stock.length || sorting) return { kind: 'empty', at };
    if (!slots) return { kind: 'full', at };
    const order = [...stock].sort((a, b) => MARKET_FISH[a].buy - MARKET_FISH[b].buy);
    const fish = [];
    let cost = 0;
    for (const id of order) {
      const price = MARKET_FISH[id].buy;
      if (cost + price > cash || fish.length === slots) break;
      fish.push(id);
      cost += price;
    }
    if (!fish.length) return { kind: 'insufficient', at, cost: MARKET_FISH[order[0]].buy, available: stock.length, items: countSpecies(stock) };
    const items = countSpecies(fish);
    const { at: buyer, payout } = this.bestQuote(this.quotes(items));
    return { kind: 'buy', at, source: at.id, items, count: fish.length, cost, payout, buyer, available: stock.length, profit: payout - cost };
  }

  interaction() {
    if (this.isPaused() || this.busy()) return null;
    if (this.cargo) {
      const at = this.buyers.find(point => this.within(point));
      if (at) {
        if (!this.isIdle()) return { kind: 'slow', at };
        const { lines, payout } = this.quotes().find(quote => quote.at === at);
        return { ...this.cargo, kind: 'sell', at, lines, payout, profit: payout - this.cargo.cost };
      }
    }
    const at = CATCH_SELLERS.find(seller => this.within(seller));
    if (!at) return null;
    if (!this.isIdle()) return { kind: 'slow', at };
    return this.sellerOffer(at);
  }

  purchase(offer) {
    const { at, source, count, items } = offer;
    const shift = this.sellerBoat(at).dockShift;
    const landing = this.save.landings[at.index];
    const bought = { ...items };
    landing.species = landing.species.filter(id => {
      if (!bought[id]) return true;
      bought[id]--;
      return false;
    });
    shift.landedCount = landing.count = landing.species.length;
    shift.marketSpecies = landing.species;
    const prior = this.cargo;
    const allItems = { ...prior?.items };
    for (const id of FISH_IDS) if (items[id]) allItems[id] = (allItems[id] || 0) + items[id];
    const sources = [...new Set([...(prior?.sources || []), source])];
    const cost = stockCost(allItems);
    this.save.cargo = {
      source: sources[0], sources, items: allItems, count: (prior?.count || 0) + count, cost,
      payout: 0, buyer: prior?.buyer || offer.buyer.id, selected: prior?.selected || false,
    };
    this.repriceLoad();
    this.game.save.cash -= offer.cost;
    this.game.persist();
    return { ...offer, kind: 'bought', cargo: this.cargo };
  }

  sell(offer) {
    const { at, lines, payout } = offer;
    const receipt = { ...this.cargo, buyer: at.id, payout };
    this.save.fulfilled[at.id] += lines.reduce((sum, line) => sum + line.premiumCount, 0);
    this.save.cargo = null;
    this.save.lastSale = this.save.receipts[at.id] = receipt;
    this.game.save.cash += payout;
    this.game.persist();
    return { ...offer, kind: 'sold' };
  }

  interact() {
    const changed = this.syncOrders();
    const stockChanged = this.syncLandings();
    const offer = this.interaction();
    switch (offer?.kind) {
      case 'help': {
        const { at, late, wage } = offer;
        this.helping = { at, elapsed: 0, late, wage, haul: this.sellerBoat(at).trip.trips };
        if (changed || stockChanged) this.game.persist();
        return { ...offer, kind: 'helping' };
      }
      case 'buy': return this.purchase(offer);
      case 'sell': return this.sell(offer);
      default:
        if (changed || stockChanged) this.game.persist();
        return offer;
    }
  }

  update(dt) {
    const changed = this.syncOrders();
    const stockChanged = this.syncLandings();
    const result = this.updateHandling(dt);
    if (changed || stockChanged || result?.kind === 'helped') this.game.persist();
    return result;
  }

  updateHandling(dt) {
    if (!this.helping || !(dt > 0) || this.isPaused()) return null;
    const job = this.helping;
    const { at, haul } = job;
    const crew = this.sellerBoat(at);
    if (this.busy() || !this.within(at) || !this.isIdle() || !crew?.trip.secured || crew.trip.trips !== haul) {
      this.helping = null;
      return { kind: 'cancelled', at };
    }
    job.elapsed += dt;
    const shift = crew.dockShift;
    if (job.elapsed < HANDLING_SECONDS || shift.unloading || shift.sorting) return null;
    this.helping = null;
    const landing = this.save.landings[at.index];
    if (!(shift.landedCount > 0) || landing.handled) return { kind: 'cancelled', at };
    landing.handled = true;
    this.game.save.cash += job.wage;
    return { kind: 'helped', at, wage: job.wage };
  }
}
