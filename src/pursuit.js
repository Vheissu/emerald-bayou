const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function wantedLevel(attention) {
  const heat = Math.max(0, Number(attention) || 0);
  return heat > 0.04 ? clamp(Math.ceil(heat), 1, 5) : 0;
}

export function pursuitSpeed(attention, playerSpeed) {
  const stars = wantedLevel(attention), speed = Math.max(0, Number(playerSpeed) || 0);
  return clamp(Math.max(12.6 + stars * 0.72, speed * 1.08 + 0.7 + stars * 0.18), 12.6, 19.5);
}

export function pursuitLostDistance(attention, restrictedVisibility = 0, storm = 0) {
  const stars = wantedLevel(attention), concealment = clamp(restrictedVisibility, 0, 1) * 58 + clamp(storm, 0, 1) * 24;
  return clamp(165 + stars * 24 - concealment, 105, 275);
}

export function pursuitLostTime(attention, restrictedVisibility = 0) {
  return clamp(4.2 + wantedLevel(attention) * 1.35 - clamp(restrictedVisibility, 0, 1) * 1.4, 3.2, 11);
}

export function canEscapePursuit(attention, elapsed, lostFor, restrictedVisibility = 0) {
  const minimumRun = 9 + wantedLevel(attention) * 3.2;
  return elapsed >= minimumRun && lostFor >= pursuitLostTime(attention, restrictedVisibility);
}
