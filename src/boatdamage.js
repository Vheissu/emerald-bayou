const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));

const smooth = (low, high, value) => {
  const amount = clamp((Number(value) - low) / Math.max(1e-6, high - low));
  return amount * amount * (3 - 2 * amount);
};

// A bottom strike is the instant a fast, floating hull first loads onto a submerged bed. Running slowly over mud or
// grass remains normal airboat work; speed, abrupt contact and a rising bed have to combine before this reports a hit.
export function bottomStrikeSeverity(speed = 0, previousGrounded = 0, grounded = 0, depth = 1, bowRise = 0) {
  const waterSpeed = Math.max(0, Number(speed) || 0), contact = clamp(grounded), previous = clamp(previousGrounded);
  const entry = clamp((contact - previous - 0.025) / 0.32);
  if (waterSpeed < 5.2 || contact < 0.055 || entry < 0.035) return 0;

  const bedDepth = Number(depth) || 0;
  const submerged = smooth(-0.1, 0.11, bedDepth) * (1 - smooth(0.48, 0.82, bedDepth));
  if (submerged < 0.02) return 0;
  const abruptness = 0.52 + entry * 0.82 + smooth(0.05, 0.72, Math.max(0, Number(bowRise) || 0)) * 0.72;
  return Math.max(0, waterSpeed - 4.75) * abruptness * submerged;
}

// Writes into a caller-owned record so even repeated grounding checks do not create garbage for the collector.
export function bottomStrikeDamage(severity = 0, currentBreach = 0, out = {}) {
  const strike = Math.max(0, Number(severity) || 0), breach = clamp(currentBreach);
  const excess = Math.max(0, strike - 5);
  out.hull = excess > 0 ? Math.pow(excess, 1.25) * 0.7 : 0;
  out.engine = out.hull * 0.035;
  out.breachGain = strike > 6.5 ? Math.min(0.66, Math.pow(strike - 6.5, 1.18) * 0.028) : 0;
  out.breach = clamp(breach + out.breachGain);
  out.flood = out.breachGain * 0.085;
  return out;
}

// Positive values fill the bilge; negative values mean the pump is gaining. A deepening stern puts the tear farther
// below the surface, so a serious breach accelerates instead of behaving like a flat hit-point countdown.
export function boatFloodRate(hull = 100, breach = 0, bilge = 0, wet = 1, pumpPowered = true) {
  const hullHealth = clamp((Number(hull) || 0) / 100), tear = clamp(breach), water = clamp(bilge), immersion = smooth(0.18, 0.72, wet);
  const hullLeak = hullHealth < 0.55 ? (0.55 - hullHealth) / 0.55 * 0.0015 : 0;
  const breachLeak = (tear * 0.015 + tear * tear * 0.009) * (0.64 + water * 0.76);
  const pump = pumpPowered ? (hullHealth > 0.7 ? 0.0012 : 0.00058) : 0.00005;
  return (hullLeak + breachLeak) * immersion - pump;
}

export function boatSinkOffset(bilge = 0, breach = 0) {
  return smooth(0.62, 0.985, bilge) * (0.07 + clamp(breach) * 0.34);
}
