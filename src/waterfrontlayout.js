// The crossing and near-bank slips are shared by the scene, physics and chart.
export const GULF_CUT = Object.freeze({
  name: 'Gulf Cut Bridge', x: -1.5, z: -58,
  west: -108, east: 139, width: 8.6,
  piers: [-93, -75, -57, -39, -22, 19, 38, 57, 76, 95, 114, 130],
  channelWest: -22, channelEast: 19,
});

export const COVE = Object.freeze({ name: 'Gulf Cut swim cove', x: -16, z: 13, radius: 23 });

export const WATERFRONT_HOUSES = [
  { x: -22, z: 35.1, floor: 2.62, width: 7, depth: 5.1, color: 0xc5c3a7, roof: 0x727c76 },
  { x: -26.3, z: 21.3, floor: 3.65, width: 6.1, depth: 4.8, color: 0x819b8a, roof: 0x806b59 },
  { x: -28.6, z: 2.3, floor: 2.27, width: 7.9, depth: 5.6, color: 0xcbb095, roof: 0x6a7a76, workroom: true },
];

export const FISHING_PIERS = [
  { x: -21, head: -8.4, z: 29.9, deck: 0.9 },
  { x: -23.5, head: -9.4, z: -0.9, deck: 0.82 },
];

export const PIER_ROOF = { offsetX: 1.7, rise: 2.31, length: 3.75, width: 2.42, pitch: 0.12 };

// Stop the falling drops at the sloping tin, including dry space over the catch bench.
export function underPierRoof(x, y, z) {
  if (y > 3.45 || x < -24 || x > -17 || z < -2.2 || z > 31.2) return false;
  for (const pier of FISHING_PIERS) {
    if (Math.abs(x - pier.x - PIER_ROOF.offsetX) <= PIER_ROOF.length / 2 &&
      Math.abs(z - pier.z) <= PIER_ROOF.width / 2 &&
      y <= pier.deck + PIER_ROOF.rise - (z - pier.z) * Math.tan(PIER_ROOF.pitch)) return true;
  }
  return false;
}

// Keep the tied boats on the outside of the two piers, away from the swim cove.
export const MOORING_TRAVEL = Object.freeze({ end: 0.38, inward: 0.16, outward: 0.36, yaw: 0.09 });
export const COVE_MOORINGS = FISHING_PIERS.map((pier, i) => {
  const side = i === 0 ? 1 : -1;
  return { pier, side, x: pier.head - 2.11, z: pier.z + side * 2.8, tint: i === 0 ? 0x4f766f : 0x96a09a };
});

// The chart and NPC placement reserve the full sweep. Player physics follows each live hull.
export const mooringClearance = COVE_MOORINGS.map(({ x, z }) => ({
  ax: x - 1.65 - MOORING_TRAVEL.end, az: z, bx: x + 1.62 + MOORING_TRAVEL.end, bz: z, r: 1.27, tag: 'tied skiff',
}));

export function bridgeZAt(x) { return GULF_CUT.z + 0.00036 * (x - GULF_CUT.x) ** 2; }

export function bridgeDeckAt(x) {
  const gauge = x < GULF_CUT.x ? 103 : 135;
  const f = Math.min(1, Math.abs(x - GULF_CUT.x) / gauge);
  return 2.6 + 7.55 * (1 - f ** 2);
}

export function bridgeOverheadAt(x, z) {
  if (x < GULF_CUT.west || x > GULF_CUT.east || Math.abs(z - bridgeZAt(x)) > GULF_CUT.width / 2) return Infinity;
  return bridgeDeckAt(x) - 1.18;
}

export const waterfrontColliders = [
  ...GULF_CUT.piers.map(x => ({
    ax: x, az: bridgeZAt(x) - 2.75, bx: x, bz: bridgeZAt(x) + 2.75, r: 0.92, tag: 'bridge',
  })),
  ...[GULF_CUT.channelWest + 2, GULF_CUT.channelEast - 2].map(x => ({
    ax: x, az: bridgeZAt(x) - 8, bx: x, bz: bridgeZAt(x) + 8, r: 0.76, tag: 'bridge',
  })),
  ...FISHING_PIERS.map(({ x, head, z }) => ({ ax: x, az: z, bx: head + 0.7, bz: z, r: 1.25, tag: 'dock' })),
];

export function waterfrontGroundOccupied(x, z) {
  if (x < GULF_CUT.west - 20 || x > GULF_CUT.east + 20 || z < -77 || z > 49) return false;
  if (Math.abs(z - bridgeZAt(x)) < 6.3) return true;
  if (x > -29 && x < -19 && z > 7 && z < 18) return true;
  for (const house of WATERFRONT_HOUSES) {
    if (Math.abs(x - house.x) < house.depth / 2 + 4.4 && Math.abs(z - house.z) < house.width / 2 + 2.8) return true;
  }
  for (const pier of FISHING_PIERS) {
    if (x >= pier.x - 2 && x <= pier.head + 2 && Math.abs(z - pier.z) < 2.7) return true;
  }
  return false;
}

export function waterfrontWaterOccupied(x, z) {
  if (x < -105 || x > 139 || z < -69 || z > 35) return false;
  if (x > -25 && x < -9 && z > 4 && z < 20) return true;
  for (const { ax, az, bx, bz, r } of waterfrontColliders) {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    if ((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2 < (r + 1.4) ** 2) return true;
  }
  for (const { ax, bx, az, r } of mooringClearance) {
    const dx = x - Math.max(ax, Math.min(bx, x));
    if (dx * dx + (z - az) ** 2 < (r + 1.4) ** 2) return true;
  }
  return false;
}

// When a wake or squall hits, residents head for the shallows and wait there before returning.
export function swimmerStep(state, { dt, threat, storm, dry, safe, daylight }) {
  if (!daylight || storm || threat || dry) {
    state.clearFor = 0;
    state.mode = safe ? 'shore' : 'retreat';
    return state.mode;
  }
  if (state.mode === 'retreat' && safe) state.mode = 'shore';
  if (state.mode === 'shore') {
    state.clearFor += dt;
    if (state.clearFor >= 10) state.mode = 'swim';
  }
  return state.mode;
}
