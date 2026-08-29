const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = (low, high, value) => {
  const t = clamp((Number(value) - low) / (high - low));
  return t * t * (3 - 2 * t);
};

// This is the chance at one formation check, not a per-frame probability. The rendered funnel has a mature spray
// ring, so it belongs to convective squalls, severe thunderstorms and tropical rainbands rather than fair weather.
export function waterspoutFormationChance(weather, values = {}) {
  const base = weather === 'squall' ? 0.12
    : weather === 'thunderstorm' ? 0.34
      : weather === 'hail' ? 0.3
        : weather === 'tropical' ? 0.42
          : weather === 'hurricane' ? 0.38 : 0;
  if (!base) return 0;
  const convection = smooth(0.5, 0.96, values.storm);
  const moisture = smooth(0.35, 0.9, values.rain);
  const windBand = 0.68 + smooth(9, 32, values.wind) * 0.32;
  const electrical = 0.78 + smooth(0.12, 0.9, values.lightning) * 0.22;
  return clamp(base * convection * moisture * windBand * electrical);
}

export function waterspoutCanForm(weather, values = {}, roll = 1) {
  const sample = Number(roll);
  return clamp(Number.isFinite(sample) ? sample : 1) < waterspoutFormationChance(weather, values);
}

// Mature Florida Keys waterspouts commonly travel with their parent cloud at roughly 10-15 knots.
export function waterspoutDriftSpeed(wind = 0) {
  return 5.15 + smooth(5, 35, wind) * 2.57;
}

export function waterspoutAvoidanceStrength(active, distance, kind = 'john') {
  if (!active) return 0;
  const d = Number(distance), reach = kind === 'canoe' ? 350 : 320;
  if (!Number.isFinite(d) || d < 0 || d >= reach) return 0;
  const proximity = clamp((reach - d) / (reach - 62));
  const sprayRing = 1 - smooth(38, 130, d);
  return clamp((proximity * 0.72 + sprayRing * 0.55) * (kind === 'canoe' ? 1.08 : 1));
}

export function waterspoutReactionReady(distance, observedSeconds, reactionDelay) {
  const d = Number(distance), observed = Math.max(0, Number(observedSeconds) || 0), delay = Math.max(0.1, Number(reactionDelay) || 0.1);
  return Number.isFinite(d) && d >= 0 && (d < 105 || observed >= delay);
}

// Scores a retained steering probe. It rewards separation from the funnel's projected position and, as marine
// guidance recommends, a course close to ninety degrees off its apparent track. Plain arithmetic keeps all seven
// traffic boats allocation-free while evaluating their five existing probes.
export function waterspoutProbeScore(spoutX, spoutZ, motionX, motionZ, boatX, boatZ, probeX, probeZ, strength = 0) {
  const weight = clamp(strength);
  if (!weight) return 0;
  const sx = Number(spoutX), sz = Number(spoutZ), mx = Number(motionX), mz = Number(motionZ);
  const bx = Number(boatX), bz = Number(boatZ), px = Number(probeX), pz = Number(probeZ);
  if (!Number.isFinite(sx) || !Number.isFinite(sz) || !Number.isFinite(mx) || !Number.isFinite(mz)
    || !Number.isFinite(bx) || !Number.isFinite(bz) || !Number.isFinite(px) || !Number.isFinite(pz)) return 0;
  const pathX = px - bx, pathZ = pz - bz, pathLength = Math.hypot(pathX, pathZ);
  if (pathLength < 0.001) return 0;
  const motionLength = Math.hypot(mx, mz), horizon = Math.max(2.5, Math.min(8, pathLength / 6));
  const futureX = sx + mx * horizon, futureZ = sz + mz * horizon;
  const before = Math.hypot(bx - futureX, bz - futureZ), after = Math.hypot(px - futureX, pz - futureZ);
  const separation = after - before;
  let rightAngle = 0;
  if (motionLength > 0.01) rightAngle = 1 - Math.abs((pathX * mx + pathZ * mz) / (pathLength * motionLength));
  const ringPenalty = after < 105 ? (105 - after) * 0.42 : 0;
  return weight * (separation * 0.64 + rightAngle * 7.5 - Math.max(0, -separation) * 0.42 - ringPenalty);
}
