import { Simplex2 } from './noise.js';

const warp = new Simplex2(1907);

export const REGIONS = [
  {
    id: 'blackwater', name: 'Blackwater Maze', strap: 'Cypress domes · blind turns · no straight line out', x: -6900, z: -6600,
    ecology: { human: 0.45, traffic: 0.5, fish: 1.15, bird: 0.85, gator: 1.35, surface: 0.9 },
    encounters: { law: 0.65, runners: 1.25, danger: 1.3 },
  },
  {
    id: 'sawgrass', name: 'Sawgrass Expanse', strap: 'Shallow water and open sky', x: 0, z: -7200,
    ecology: { human: 0.55, traffic: 0.6, fish: 0.9, bird: 1.35, gator: 0.8, surface: 1.05 },
    encounters: { law: 0.75, runners: 0.8, danger: 0.9 },
  },
  {
    id: 'mangrove', name: 'Mangrove Reach', strap: 'Tide cuts and backchannel traffic', x: 6900, z: -6500,
    ecology: { human: 0.9, traffic: 1.05, fish: 1.25, bird: 1.05, gator: 1, surface: 1 },
    encounters: { law: 0.85, runners: 1.5, danger: 1.15 },
  },
  {
    id: 'cypress', name: 'Cypress Reach', strap: 'Old timber and narrow water', x: -7300, z: 0,
    ecology: { human: 0.75, traffic: 0.7, fish: 1.1, bird: 1, gator: 1.25, surface: 0.9 },
    encounters: { law: 0.8, runners: 1, danger: 1.15 },
  },
  {
    id: 'emerald', name: 'Emerald Bayou', strap: 'Tower country · worked water and old camps', x: 20, z: -120,
    ecology: { human: 1, traffic: 1, fish: 1, bird: 1, gator: 1, surface: 1 },
    encounters: { law: 1, runners: 1, danger: 1 },
  },
  {
    id: 'broad', name: 'Broad River', strap: 'Deep water and working boats', x: 7300, z: 0,
    ecology: { human: 1.2, traffic: 1.4, fish: 0.9, bird: 0.9, gator: 0.75, surface: 1.05 },
    encounters: { law: 1.5, runners: 0.7, danger: 0.85 },
  },
  {
    id: 'rookery', name: 'Rookery Lakes', strap: 'Bird country · idle through the rookeries', x: -6900, z: 6700,
    ecology: { human: 0.55, traffic: 0.55, fish: 1.05, bird: 1.65, gator: 0.9, surface: 1.1 },
    encounters: { law: 1.1, runners: 0.65, danger: 0.8 },
  },
  {
    id: 'prairie', name: 'Ten Mile Prairie', strap: 'Flooded grass with nowhere to hide', x: 0, z: 7300,
    ecology: { human: 0.5, traffic: 0.45, fish: 0.8, bird: 1.25, gator: 1.1, surface: 0.9 },
    encounters: { law: 0.65, runners: 0.9, danger: 1 },
  },
  {
    id: 'dead-river', name: 'Dead River', strap: 'No dock lights after dark', x: 6900, z: 6700,
    ecology: { human: 0.3, traffic: 0.35, fish: 0.95, bird: 0.75, gator: 1.5, surface: 0.82 },
    encounters: { law: 0.45, runners: 1.35, danger: 1.45 },
  },
];

export function regionAt(x, z) {
  if (Math.hypot(x - 20, z + 120) < 1450) return REGIONS[4];
  const wx = x + warp.noise(x * 0.00023 + 4, z * 0.00023 + 9) * 850;
  const wz = z + warp.noise(x * 0.00023 + 17, z * 0.00023 + 2) * 850;
  let best = REGIONS[4], score = Infinity;
  for (const r of REGIONS) {
    const dx = wx - r.x, dz = wz - r.z, s = dx * dx + dz * dz;
    if (s < score) { score = s; best = r; }
  }
  return best;
}

export class RegionDirector {
  constructor(o) {
    Object.assign(this, o); // game, phys
    this.all = REGIONS; this.current = null; this.checkT = 0; this.noticeT = 0; this.enabled = false;
    this.el = document.getElementById('regionState');
    this.game.save.regions ??= [];
  }

  discovered(id) { return this.game.save.regions.includes(id); }

  enter(region) {
    this.current = region;
    if (!this.discovered(region.id)) { this.game.save.regions.push(region.id); this.game.persist(); }
    if (!this.el) return;
    this.el.innerHTML = `<span>${region.name}</span><small>${region.strap}</small>`;
    this.el.classList.add('on'); this.noticeT = 5.2;
  }

  update(dt, enabled = true) {
    this.enabled = enabled;
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0 && this.el) this.el.classList.remove('on'); }
    if (!enabled) return;
    this.checkT -= dt; if (this.checkT > 0) return; this.checkT = 0.35;
    const next = regionAt(this.phys.pos.x, this.phys.pos.y);
    if (!this.current || next.id !== this.current.id) this.enter(next);
  }
}
