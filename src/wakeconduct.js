export const MAX_SHIFT_WAKE_COMPLAINTS = 2;

export function wakeSeverity({ kind, working = false, playerSpeed = 0, wakeHeight = 0 } = {}) {
  const speed = Math.max(0, Number(playerSpeed) || 0), wake = Math.abs(Number(wakeHeight) || 0);
  let minSpeed = Infinity, minWake = Infinity;
  if (kind === 'canoe') { minSpeed = 4; minWake = 0.012; }
  else if (working) { minSpeed = 4.5; minWake = 0.022; }
  if (speed < minSpeed || wake < minWake) return 0;
  const force = speed / minSpeed * 0.45 + wake / minWake * 0.55;
  return force >= 1.8 ? 2 : 1;
}

export function wakeConsequence({ severity = 1, shiftComplaints = 1, previousComplaints = 0, enforcementCrew = false } = {}) {
  const level = severity >= 2 ? 2 : 1;
  const prior = Math.max(0, Number(previousComplaints) || 0);
  const reported = level === 2 || shiftComplaints >= 2 || prior >= 1;
  return {
    reported,
    horn: reported,
    attention: reported ? Math.min(0.78, 0.18 + level * 0.12 + Math.min(0.18, prior * 0.04) + (enforcementCrew ? 0.12 : 0)) : 0,
    reputation: reported ? (level === 2 ? -0.28 : -0.18) : -0.08,
  };
}
