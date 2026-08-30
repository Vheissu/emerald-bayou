const TAU = Math.PI * 2;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = (low, high, value) => {
  const amount = clamp((value - low) / Math.max(1e-6, high - low));
  return amount * amount * (3 - 2 * amount);
};

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

// A phase alone does not describe a bright night: the Moon also has to be above the local horizon and visible
// through the current cloud deck. The normalized result is shared by lighting and nocturnal systems so they react
// to the same sky instead of each inventing a separate moon clock.
export function lunarNightLight(input = {}, altitudeArg = 0, illuminationArg = 0, transmissionArg = 1) {
  const object = input && typeof input === 'object';
  const night = object ? input.night ?? 1 : input, altitude = object ? input.altitude ?? 0 : altitudeArg;
  const illumination = object ? input.illumination ?? 0 : illuminationArg, transmission = object ? input.transmission ?? 1 : transmissionArg;
  const lifted = smooth(0.01, 0.68, Number(altitude) || 0);
  return clamp(night) * lifted * Math.pow(clamp(illumination), 0.72) * clamp(transmission);
}

// New/full alignments retain the existing maximum tidal range. Quarter moons ease it to a neap range instead of
// inventing extra water height that could invalidate hand-placed docks and shorelines.
export function lunarTideRange(phase) { return 0.72 + 0.28 * Math.pow(Math.abs(Math.cos(phase)), 1.25); }
export function lunarPhaseName(phase) {
  const cycle = (((phase / TAU) % 1) + 1) % 1;
  return LUNAR_PHASE_NAMES[Math.round(cycle * 8) % 8];
}
