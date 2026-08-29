const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function pursuitYieldStrength(active, attention, distance, playerSpeed, kind = 'john', enforcement = false) {
  if (!active || enforcement) return 0;
  const d = Number(distance);
  if (!Number.isFinite(d) || d < 0) return 0;
  const reach = kind === 'canoe' ? 210 : 180;
  if (d >= reach) return 0;
  const proximity = clamp((reach - d) / (reach * 0.72));
  const speedUrgency = clamp((Math.max(0, Number(playerSpeed) || 0) - 2) / 14);
  const heatUrgency = clamp(Math.max(0, Number(attention) || 0) / 5);
  const vulnerability = kind === 'canoe' ? 1 : 0.86;
  return clamp(proximity * (0.5 + speedUrgency * 0.24 + heatUrgency * 0.2) * vulnerability);
}

export function pursuitYieldSpeedScale(strength, kind = 'john') {
  const yieldStrength = clamp(Number(strength) || 0);
  return 1 - yieldStrength * (kind === 'canoe' ? 0.86 : 0.58);
}
