export const RESIDENT_ROUTINE = Object.freeze({
  INSIDE: 0,
  OUTSIDE: 1,
  WATCH: 2,
  BRACE: 3,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrapHour = hour => ((Number(hour) || 0) % 24 + 24) % 24;
const inWindow = (hour, start, end) => start <= end
  ? hour >= start && hour < end
  : hour >= start || hour < end;

// A resident keeps the same shift for a whole game day. Site/person seeds make neighbouring
// docks open at different times without retaining timers or writing routine state into the save.
export function residentRoutineRoll(seed = 0.5, day = 1, salt = 0) {
  let value = (Math.floor(clamp(Number(seed) || 0, 0, 0.999999) * 0x100000000)
    ^ Math.imul(Math.max(1, Math.trunc(Number(day) || 1)), 0x9e3779b1)
    ^ Math.imul(Math.trunc(Number(salt) || 0) + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

export function residentOnShift(role = 'camp', hour = 12, seed = 0.5, day = 1) {
  const h = wrapHour(hour);
  const shift = (residentRoutineRoll(seed, day, 11) - 0.5) * 1.2;
  if (role === 'angler') {
    return inWindow(h, 4.9 + shift, 11.2 + shift * 0.25)
      || inWindow(h, 15.4 + shift * 0.25, 20.35 + shift);
  }
  if (role === 'blind') {
    return inWindow(h, 4.45 + shift, 9.75 + shift * 0.25)
      || inWindow(h, 16.25 + shift * 0.25, 20.15 + shift);
  }
  if (role === 'ramp') return inWindow(h, 4.7 + shift, 22.15 + shift * 0.35);
  if (role === 'house') return inWindow(h, 6.1 + shift, 21.15 + shift * 0.5);
  if (role === 'boathouse') return inWindow(h, 5.05 + shift, 20.25 + shift * 0.45);
  return inWindow(h, 5.35 + shift, 20.45 + shift * 0.45);
}

// This is deliberately a small state machine. It runs at the ecology director's 2 Hz cadence,
// while the existing pose system performs the visible easing each render frame.
export function residentRoutineState(input = {}) {
  const role = input.role || 'camp';
  const seed = Number.isFinite(input.seed) ? input.seed : 0.5;
  const onShift = residentOnShift(role, input.hour, seed, input.day);
  if (!onShift) return RESIDENT_ROUTINE.INSIDE;

  const storm = clamp(Number(input.storm) || 0, 0, 1);
  const rain = clamp(Number(input.rain) || 0, 0, 1);
  const wind = Math.max(0, Number(input.wind) || 0);
  const distance = Math.max(0, Number(input.distance) || 0);
  const speed = Math.max(0, Number(input.playerSpeed) || 0);
  const attention = clamp(Number(input.attention) || 0, 0, 5);
  const stars = attention > 0.04 ? Math.min(5, Math.ceil(attention)) : 0;

  if (input.pursuit && stars >= 3 && distance < 175) return RESIDENT_ROUTINE.INSIDE;
  if (storm >= 0.86 || wind >= 29 || (rain >= 0.94 && wind >= 21)) return RESIDENT_ROUTINE.INSIDE;
  if (role === 'blind' && (storm >= 0.48 || wind >= 18)) return RESIDENT_ROUTINE.INSIDE;
  if (storm >= 0.56 || wind >= 18 || (rain >= 0.72 && wind >= 12)) return RESIDENT_ROUTINE.BRACE;
  if (input.pursuit && stars > 0 && distance < 330) return RESIDENT_ROUTINE.WATCH;
  if (distance < 82 && speed > 4) return RESIDENT_ROUTINE.WATCH;
  return RESIDENT_ROUTINE.OUTSIDE;
}

// One retained input object serves every figure. Mutating only its seed here avoids allocating
// a wrapper for each streamed actor on every routine pass.
export function applyResidentRoutines(group, input, stats = null) {
  const people = group?.userData?.people;
  if (!people?.length) return;
  if (stats) stats.groups++;
  for (const person of people) {
    const user = person.userData || (person.userData = {});
    input.seed = Number.isFinite(user.seed) ? user.seed : 0.5;
    const state = residentRoutineState(input);
    const visible = state !== RESIDENT_ROUTINE.INSIDE;
    if (!visible && user.routineState !== RESIDENT_ROUTINE.INSIDE && user.line) {
      user.line.visible = false;
      user.lineOn = 0;
      user.reelT = 0;
      user.castCd = 3 + input.seed * 7;
    }
    user.routineState = state;
    person.visible = visible;
    if (!stats) continue;
    stats.actors++;
    if (state === RESIDENT_ROUTINE.INSIDE) stats.inside++;
    else if (state === RESIDENT_ROUTINE.WATCH) stats.watching++;
    else if (state === RESIDENT_ROUTINE.BRACE) stats.bracing++;
    else stats.outside++;
  }
}
