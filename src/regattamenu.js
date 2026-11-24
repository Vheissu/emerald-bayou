import { BOAT_PART_GROUPS } from './boatmods.js';

export function raceMenu(races, results, { cash, time, distance }) {
  return `<div class="race-list">${races.map((race, i) => {
    const best = results?.[race.id];
    const purses = race.second ? `${cash(race.reward)} first · ${cash(race.second)} second` : `${cash(race.reward)} for a finish`;
    const wins = Math.max(0, Math.trunc(Number(best?.wins) || 0));
    const record = Number(best?.time) > 0 ? `<small>Best ${time(best.time)}${race.rival && wins ? ` · ${wins} won` : ''}</small>` : '';
    return `<button type="button" class="race-choice" data-race="${i}">
      <span><strong>${race.title}</strong><small>${race.type} · ${distance(race.distance)}</small><small>${race.desc}</small></span>
      <span class="race-purse"><b>${purses}</b>${record}<span>Enter race</span></span>
    </button>`;
  }).join('')}</div>`;
}

export function boatPartsMenu(parts, docked, message, cash) {
  const categories = BOAT_PART_GROUPS.map(group => {
    const item = (id, name, detail, price = 0, paint = null) => {
      const fitted = (parts?.installed?.[group.id] || 'stock') === id;
      const owned = id === 'stock' || parts?.owned?.includes(id);
      const label = fitted ? 'Fitted' : owned ? 'Fit' : cash(price);
      const swatch = paint ? `<span class="parts-chip" style="--band:#${paint[0].toString(16).padStart(6, '0')};--stripe:#${paint[1].toString(16).padStart(6, '0')}" aria-hidden="true"></span>` : '';
      return `<button type="button" class="parts-row" data-fit-part="${id}" data-part-slot="${group.id}" aria-disabled="${fitted || !docked}">
        <span><strong>${swatch}${name}</strong>${detail ? `<small>${detail}</small>` : ''}</span><span class="parts-price">${label}</span>
      </button>`;
    };
    return `<section class="parts-category"><h2>${group.label}</h2>
      ${item('stock', group.stock, '')}${group.parts.map(p => item(p.id, p.name, p.detail, p.price, p.paint)).join('')}
    </section>`;
  }).join('');
  const prompt = docked ? 'Tower dock' : 'Idle at the tower dock to fit parts.';
  return `<div class="parts-dock"><p>${prompt}</p>${docked ? '' : '<button type="button" data-parts-pin>Mark on chart</button>'}</div>
    <p class="parts-message" role="status">${message}</p><div class="parts-catalog">${categories}</div>`;
}
