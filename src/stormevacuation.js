const BACKSIDE_START = 0.58;
const PICKUP_PHASES = new Set(['outer-bands', 'front-eyewall', 'eye']);

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

// The pickup window closes when the backside eyewall arrives. NHC surge guidance stresses that
// protective action has to finish before wind and inundation remove the remaining safe route.
export function stormEvacuationLeadSeconds(state = {}) {
  const duration = Math.max(0, finite(state.duration));
  const progress = clamp(finite(state.progress));
  return Math.max(0, (BACKSIDE_START - progress) * duration);
}

export function stormEvacuationWindow(state = {}) {
  if (state.weather !== 'hurricane' || !PICKUP_PHASES.has(state.phase)) return false;
  if (finite(state.surge) < 0.2 || finite(state.surgeRate) <= 0.008) return false;
  return stormEvacuationLeadSeconds(state) >= 28;
}

export function stormEvacuationCampScore(camp, context = {}) {
  if (!camp?.tie || !camp?.bank) return -Infinity;
  const playerX = finite(context.playerX), playerZ = finite(context.playerZ), waterLevel = finite(context.waterLevel);
  const distance = Math.hypot(camp.tie.x - playerX, camp.tie.z - playerZ);
  const lead = Math.max(0, finite(context.leadSeconds));
  const reachable = clamp((lead - 10) * 16, 180, 1400);
  if (distance < 90 || distance > reachable) return -Infinity;

  // The bank is the camp's access route. Once the rising water is within half a metre of it, a
  // stilted shack can still be dry while its resident is about to become isolated.
  const bankHeight = finite(camp.bank.h, finite(camp.h, Infinity));
  const clearance = bankHeight - waterLevel;
  if (!Number.isFinite(clearance) || clearance > 0.5 || clearance < -0.9) return -Infinity;

  const inundation = clamp((0.5 - clearance) / 1.4);
  const floorClearance = finite(camp.h, bankHeight) - waterLevel;
  const lowStructure = clamp((1.8 - floorClearance) / 1.8);
  const approach = clamp(1 - distance / reachable);
  return inundation * 4 + lowStructure * 0.65 + approach * 0.6;
}

export function pickStormEvacuationCamp(camps, context = {}) {
  let best = null, bestScore = -Infinity;
  for (const item of camps || []) {
    const camp = item?.userData?.site || item;
    const score = stormEvacuationCampScore(camp, context);
    if (score > bestScore) { best = camp; bestScore = score; }
  }
  return best;
}
