export const STOCK_COOLER_CAPACITY = 4;
export const ICE_CHEST_CAPACITY = 8;

const part = (id, name, price, detail, tuning, paint) => Object.freeze({
  id, name, price, detail, tuning: Object.freeze(tuning), paint: paint && Object.freeze(paint),
});

export const BOAT_PART_GROUPS = Object.freeze([
  { id: 'engine', label: 'Engine', stock: 'Factory V8', parts: [
    part('torque-cam', 'Torque cam', 180, '+13% thrust, +5% fuel burn', { thrust: 1.13, fuelBurn: 1.05 }),
    part('blueprinted', 'Blueprinted V8', 690, '+23% thrust, +20% fuel burn', { thrust: 1.23, fuelBurn: 1.20 }),
  ] },
  { id: 'prop', label: 'Propeller', stock: 'Alloy prop', parts: [
    part('cruise-prop', 'Cruise pitch', 150, '−15% fuel burn, −4% thrust', { fuelBurn: 0.85, thrust: 0.96 }),
    part('race-prop', 'Carbon prop', 410, '+10% thrust and +7% rudder response', { thrust: 1.10, steer: 1.07, propScale: 0.97 }),
  ] },
  { id: 'steering', label: 'Steering', stock: 'Factory blades', parts: [
    part('deep-rudders', 'Deep rudder blades', 145, '+18% rudder response', { steer: 1.18, rudderWidth: 1.14 }),
    part('chined-rudders', 'Race rudder set', 340, '+30% rudder response, +12% side grip', { steer: 1.30, sideGrip: 1.12, rudderWidth: 1.29 }),
  ] },
  { id: 'cooler', label: 'Fish storage', stock: 'Standard cooler', stockDetail: 'Holds 4 fish', parts: [
    part('ice-chest', 'Ice chest', 175, 'Holds 8 fish', { coolerCapacity: ICE_CHEST_CAPACITY }),
  ] },
  { id: 'hull', label: 'Hull', stock: 'Utility hull', parts: [
    part('poly-shoes', 'Polymer runners', 275, '−21% bottom-strike severity and less drag', { bottomStrike: 0.79, drag: 0.94 }),
    part('rub-rails', 'Reinforced chines', 460, '−28% hull damage, +6% hull mass', { damage: 0.72, mass: 1.06 }),
  ] },
  { id: 'tank', label: 'Fuel tanks', stock: '18 gal tanks', parts: [
    part('range-tank', '24 gal tanks', 205, 'Six more gallons, +2% hull mass', { capacity: 24, mass: 1.02 }),
    part('expedition-tank', '30 gal tanks', 370, 'Twelve more gallons, +4% hull mass', { capacity: 30, mass: 1.04 }),
  ] },
  { id: 'bilge', label: 'Bilge pump', stock: 'Factory pump', parts: [
    part('high-flow', 'High-flow pump', 125, '+45% water removal when powered', { pump: 1.45 }),
    part('dual-pump', 'Twin pumps', 310, 'Twice the water removal when powered', { pump: 2 }),
  ] },
  { id: 'light', label: 'Searchlight', stock: '110 m lamp', parts: [
    part('flood-lamp', 'Wide floodlight', 170, 'Wider spill for banks and moorings', { beamAngle: 1.43, beamRange: 0.85, beamPower: 1.40 }),
    part('search-lamp', 'Long-throw searchlight', 345, 'Narrow 160 m beam for open water', { beamAngle: 0.70, beamRange: 160 / 110, beamPower: 1.64 }),
  ] },
  { id: 'livery', label: 'Hull paint', stock: 'Bare aluminium', parts: [
    part('tidewater-blue', 'Tidewater Blue', 110, 'Navy band with a cream pinstripe', {}, [0x254c68, 0xe5d5ad]),
    part('mangrove-green', 'Mangrove Green', 110, 'Olive band with a straw pinstripe', {}, [0x455c35, 0xd0a14e]),
    part('copper-reef', 'Copper Reef', 110, 'Brick red band with a bone pinstripe', {}, [0xa3442c, 0xe5d9c2]),
  ] },
].map(group => Object.freeze({ ...group, parts: Object.freeze(group.parts) })));

export const STOCK_BOAT_TUNING = Object.freeze({
  thrust: 1, steer: 1, sideGrip: 1, drag: 1, mass: 1, damage: 1, bottomStrike: 1,
  fuelBurn: 1, capacity: 18, pump: 1, beamAngle: 1, beamRange: 1, beamPower: 1, rudderWidth: 1, propScale: 1,
  coolerCapacity: STOCK_COOLER_CAPACITY,
});

const partById = new Map(BOAT_PART_GROUPS.flatMap(group => group.parts.map(item => [item.id, item])));
const groupsById = new Map(BOAT_PART_GROUPS.map(group => [group.id, group]));

export function normalizeBoatParts(value) {
  const owned = Array.isArray(value?.owned) ? [...new Set(value.owned.filter(id => partById.has(id)))] : [];
  const installed = {};
  for (const group of BOAT_PART_GROUPS) {
    const id = value?.installed?.[group.id];
    if (owned.includes(id) && group.parts.some(item => item.id === id)) installed[group.id] = id;
  }
  return { owned, installed };
}

export function boatTuning(parts) {
  const tuning = { ...STOCK_BOAT_TUNING };
  for (const group of BOAT_PART_GROUPS) {
    const item = partById.get(parts?.installed?.[group.id]);
    if (!item) continue;
    for (const [key, value] of Object.entries(item.tuning)) {
      if (key === 'capacity' || key === 'coolerCapacity') tuning[key] = value;
      else tuning[key] *= value;
    }
  }
  return tuning;
}

export function boatPaint(parts) {
  return partById.get(parts?.installed?.livery)?.paint || null;
}

export function fitBoatPart(save, { slot, id, docked, fuel = 0 }) {
  const group = groupsById.get(slot), choice = group?.parts.find(item => item.id === id);
  if (!group || (!choice && id !== 'stock')) return { status: 'invalid' };
  if (!docked) return { status: 'away' };
  const parts = normalizeBoatParts(save.boatParts);
  if ((parts.installed[slot] || 'stock') === id) return { status: 'installed' };
  const price = choice && !parts.owned.includes(id) ? choice.price : 0;
  const cash = Number.isFinite(save.cash) ? save.cash : 0;
  if (cash < price) return { status: 'funds', needed: price - cash };
  if (slot === 'tank') {
    const capacity = choice?.tuning.capacity || STOCK_BOAT_TUNING.capacity;
    if (fuel - capacity > 0.001) return { status: 'fuel', capacity };
  }
  if (slot === 'cooler') {
    const capacity = choice?.tuning.coolerCapacity || STOCK_COOLER_CAPACITY;
    if (save.catchTrade?.cargo?.count > capacity) return { status: 'cargo', capacity };
  }
  if (price) parts.owned.push(id);
  if (choice) parts.installed[slot] = id;
  else delete parts.installed[slot];
  save.cash = cash - price;
  save.boatParts = parts;
  return { status: 'fitted', name: choice?.name || group.stock, price };
}
