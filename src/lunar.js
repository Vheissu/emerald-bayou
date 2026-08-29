const TAU = Math.PI * 2;

export const SYNODIC_MONTH_DAYS = 29.53059;
// Day one opens close to a full moon, then the phase advances continuously with the saved world clock.
export const LUNAR_START_AGE_DAYS = 13.75;
export const LUNAR_PHASE_NAMES = Object.freeze(['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent']);

export function lunarAgeAt(minutes) {
  const days = Number.isFinite(minutes) ? minutes / 1440 : 0;
  const age = ((days + LUNAR_START_AGE_DAYS) % SYNODIC_MONTH_DAYS + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  return age > SYNODIC_MONTH_DAYS - 1e-9 ? 0 : age;
}

export function lunarPhaseAt(minutes) { return lunarAgeAt(minutes) / SYNODIC_MONTH_DAYS * TAU; }
export function lunarIllumination(phase) { return (1 - Math.cos(phase)) * 0.5; }

// New/full alignments retain the existing maximum tidal range. Quarter moons ease it to a neap range instead of
// inventing extra water height that could invalidate hand-placed docks and shorelines.
export function lunarTideRange(phase) { return 0.72 + 0.28 * Math.pow(Math.abs(Math.cos(phase)), 1.25); }
export function lunarPhaseName(phase) {
  const cycle = (((phase / TAU) % 1) + 1) % 1;
  return LUNAR_PHASE_NAMES[Math.round(cycle * 8) % 8];
}
