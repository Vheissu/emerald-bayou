const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function wantedLevel(attention) {
  const heat = Math.max(0, Number(attention) || 0);
  return heat > 0.04 ? clamp(Math.ceil(heat), 1, 5) : 0;
}

export function pursuitSpeed(attention, playerSpeed) {
  const stars = wantedLevel(attention), speed = Math.max(0, Number(playerSpeed) || 0);
  return clamp(Math.max(12.6 + stars * 0.72, speed * 1.08 + 0.7 + stars * 0.18), 12.6, 19.5);
}

export function pursuitUnitCount(attention) {
  const stars = wantedLevel(attention);
  if (!stars) return 0;
  if (stars >= 4) return 3;
  if (stars >= 2) return 2;
  return 1;
}

export function pursuitBackupDelay(index, attention) {
  const stars = wantedLevel(attention), unit = Math.max(0, Math.floor(Number(index) || 0));
  if (unit === 0 && stars >= 2) return clamp(11.5 - stars * 1.5, 4, 8.5);
  if (unit === 1 && stars >= 4) return stars >= 5 ? 9.5 : 12;
  return Infinity;
}

export function pursuitTactic(role, attention, distance, side = 1, out = {}) {
  const stars = wantedLevel(attention), d = Math.max(0, Number(distance) || 0), flank = side < 0 ? -1 : 1;
  if (role === 1) {
    out.lead = d > 70 ? 2.3 : d > 30 ? 1.55 : 0.7;
    out.fore = d < 18 ? -1.5 : 20 + stars * 2.8;
    out.side = flank * (d < 16 ? 4.5 : 10 + stars * 1.25);
  } else if (role === 2) {
    out.lead = d > 65 ? 1.8 : d > 26 ? 1.08 : 0.42;
    out.fore = d < 17 ? -4 : 10 + stars * 1.8;
    out.side = -flank * (d < 15 ? 3.5 : 8 + stars * 1.15);
  } else {
    const aggressive = stars >= 2;
    out.lead = d > 65 ? 1.25 : d > 24 ? 0.58 : 0.12;
    out.fore = aggressive ? (d < 16 ? -0.4 : 7.5) : (d < 24 ? 8 : 2.5);
    out.side = flank * (aggressive ? (d < 16 ? 1.4 : 4.8) : (d < 24 ? 6.5 : 1.5));
  }
  return out;
}

export function pursuitUnitCanRam(role, attention) {
  return role === 0 ? wantedLevel(attention) >= 2 : wantedLevel(attention) >= 3;
}

export function pursuitVisualHeld(nearestUnitDistance, lostDistance) {
  return Number.isFinite(nearestUnitDistance) && nearestUnitDistance <= Math.max(0, Number(lostDistance) || 0);
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
