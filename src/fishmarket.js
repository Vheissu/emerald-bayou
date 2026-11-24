export const CREW_CATCH_LIMIT = 4;

export const MARKET_FISH = Object.freeze({
  mullet: Object.freeze({ name: 'mullet', buy: 14 }),
  redfish: Object.freeze({ name: 'redfish', buy: 22 }),
  trout: Object.freeze({ name: 'speckled trout', buy: 18 }),
});

export const FISH_IDS = Object.freeze(Object.keys(MARKET_FISH));

const haulingPatterns = [
  [
    ['mullet', 'mullet', 'redfish', 'mullet'],
    ['mullet', 'redfish', 'redfish', 'mullet'],
    ['redfish', 'redfish', 'mullet', 'trout'],
    ['mullet', 'mullet', 'mullet', 'redfish'],
  ],
  [
    ['trout', 'trout', 'mullet', 'trout'],
    ['trout', 'mullet', 'trout', 'redfish'],
    ['redfish', 'trout', 'trout', 'mullet'],
    ['trout', 'trout', 'trout', 'mullet'],
  ],
];

export function marketHaul(crewIndex, haul) {
  const patterns = haulingPatterns[crewIndex];
  return patterns[(Math.max(1, haul) - 1) % patterns.length];
}

export function countSpecies(species) {
  const items = {};
  for (const id of species) items[id] = (items[id] || 0) + 1;
  return items;
}

export function describeFish(items) {
  return FISH_IDS.filter(id => items?.[id]).map(id => `${items[id]} ${MARKET_FISH[id].name}`).join(', ');
}

const marketRates = {
  tower: {
    base: { mullet: 44, redfish: 48, trout: 36 },
    orders: [{ species: 'redfish', quantity: 4, bonus: 24 }, { species: 'trout', quantity: 3, bonus: 28 }],
  },
  'mullet-bend': {
    base: { mullet: 40, redfish: 42, trout: 44 },
    orders: [{ species: 'trout', quantity: 4, bonus: 29 }, { species: 'mullet', quantity: 6, bonus: 20 }],
  },
};

export function buyerDemand(id, day, fulfilled = 0) {
  const rates = marketRates[id];
  if (!rates) return [];
  const order = rates.orders[(day - 1) % rates.orders.length];
  return FISH_IDS.map(species => {
    const base = rates.base[species], requested = species === order.species ? order.quantity : 0;
    const remaining = Math.max(0, requested - fulfilled);
    const premium = remaining > 0 ? order.bonus : 0;
    return { species, name: MARKET_FISH[species].name, requested, remaining, price: base + premium, base };
  });
}
