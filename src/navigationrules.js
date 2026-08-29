const SIDE_ARC = 112.5 * Math.PI / 180;
const AHEAD_OVERLAP = 0.75 * Math.PI / 180;
const ARC_EPSILON = 1e-7;
const OVERTAKING_SECTOR = Math.cos(112.5 * Math.PI / 180);
const HEAD_ON_AHEAD = Math.cos(24 * Math.PI / 180);
const HEAD_ON_COURSE = -Math.cos(35 * Math.PI / 180);
const ENCOUNTER_RANGE = 220;
const ENCOUNTER_LOOKAHEAD = 24;

export const NAVIGATION_ROLE = Object.freeze({
  CLEAR: 'clear',
  GIVE_WAY: 'give-way',
  STAND_ON: 'stand-on',
  MUTUAL: 'mutual',
});

export const NAVIGATION_VESSEL = Object.freeze({
  POWER: 0,
  FISHING: 1,
});

// Boat local frame: +X starboard, -X port, -Z ahead. A short overlap at dead ahead prevents a camera sitting
// exactly on the bow line from losing one sidelight to floating-point jitter.
export const PLAYER_NAV_LIGHT_LAYOUT = Object.freeze({
  port: Object.freeze({ x: -1.03, y: 0.78, z: -1.55 }),
  starboard: Object.freeze({ x: 1.03, y: 0.78, z: -1.55 }),
  stern: Object.freeze({ x: 0, y: 2.1, z: 1.8 }),
});

export function navigationLightVisibility(localObserverX, localObserverZ, out = {}) {
  const x = Number(localObserverX), z = Number(localObserverZ);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 0.001) {
    out.port = true; out.starboard = true; out.stern = true; return out;
  }
  const bearing = Math.atan2(x, -z);
  out.port = bearing >= -SIDE_ARC - ARC_EPSILON && bearing <= AHEAD_OVERLAP;
  out.starboard = bearing <= SIDE_ARC + ARC_EPSILON && bearing >= -AHEAD_OVERLAP;
  out.stern = Math.abs(bearing) >= SIDE_ARC - ARC_EPSILON;
  return out;
}

export function createNavigationEncounter() {
  return {
    kind: 'none', role: NAVIGATION_ROLE.CLEAR, risk: 0, emergency: false, holdCourse: false,
    distance: Infinity, closestApproach: Infinity, timeToClosest: Infinity, closingSpeed: 0,
    targetStarboard: 0, turn: 0, speedScale: 1, signalBlasts: 0,
  };
}

export function clearNavigationEncounter(out) {
  out.kind = 'none'; out.role = NAVIGATION_ROLE.CLEAR; out.risk = 0; out.emergency = false; out.holdCourse = false;
  out.distance = Infinity; out.closestApproach = Infinity; out.timeToClosest = Infinity; out.closingSpeed = 0;
  out.targetStarboard = 0; out.turn = 0; out.speedScale = 1; out.signalBlasts = 0;
  return out;
}

export function copyNavigationEncounter(source, out) {
  out.kind = source.kind; out.role = source.role; out.risk = source.risk; out.emergency = source.emergency; out.holdCourse = source.holdCourse;
  out.distance = source.distance; out.closestApproach = source.closestApproach; out.timeToClosest = source.timeToClosest; out.closingSpeed = source.closingSpeed;
  out.targetStarboard = source.targetStarboard; out.turn = source.turn; out.speedScale = source.speedScale; out.signalBlasts = source.signalBlasts;
  return out;
}

// Prefer an immediate danger, then the encounter with the greater collision risk. Stable distance/time tie-breakers
// make nearly equal appraisals deterministic when vessels are visited in the traffic pool's fixed order.
export function navigationEncounterOutranks(candidate, current) {
  if (candidate.role === NAVIGATION_ROLE.CLEAR) return false;
  if (current.role === NAVIGATION_ROLE.CLEAR) return true;
  if (candidate.emergency !== current.emergency) return candidate.emergency;
  const riskGap = candidate.risk - current.risk;
  if (Math.abs(riskGap) > 0.015) return riskGap > 0;
  const timeGap = candidate.timeToClosest - current.timeToClosest;
  if (Math.abs(timeGap) > 0.2) return timeGap < 0;
  return candidate.distance < current.distance;
}

const clamp01 = value => Math.max(0, Math.min(1, value));

// Inland collision-rule appraisal for two vessels in sight of one another. The caller owns `out`, so a traffic
// controller can retain one result per boat and run this in a hot loop without allocating temporary vectors/objects.
// Heading 0 points toward -Z; positive probe turns are port, so a starboard alteration is represented by -1.
export function evaluateNavigationEncounter(
  ownX, ownZ, ownHeading, ownSpeed,
  otherX, otherZ, otherHeading, otherSpeed,
  otherVelocityX, otherVelocityZ,
  ownVessel = NAVIGATION_VESSEL.POWER,
  otherVessel = NAVIGATION_VESSEL.POWER,
  out = createNavigationEncounter(),
) {
  clearNavigationEncounter(out);
  if (!Number.isFinite(ownX) || !Number.isFinite(ownZ) || !Number.isFinite(ownHeading) || !Number.isFinite(ownSpeed)
    || !Number.isFinite(otherX) || !Number.isFinite(otherZ) || !Number.isFinite(otherHeading) || !Number.isFinite(otherSpeed)
    || !Number.isFinite(otherVelocityX) || !Number.isFinite(otherVelocityZ)) return out;

  const rx = otherX - ownX, rz = otherZ - ownZ, distance = Math.hypot(rx, rz);
  out.distance = distance;
  if (distance < 0.001 || distance > ENCOUNTER_RANGE) return out;

  const ownForwardX = -Math.sin(ownHeading), ownForwardZ = -Math.cos(ownHeading);
  const otherForwardX = -Math.sin(otherHeading), otherForwardZ = -Math.cos(otherHeading);
  const ownVelocityX = ownForwardX * Math.max(0, ownSpeed), ownVelocityZ = ownForwardZ * Math.max(0, ownSpeed);
  const relativeVelocityX = otherVelocityX - ownVelocityX, relativeVelocityZ = otherVelocityZ - ownVelocityZ;
  const relativeSpeedSq = relativeVelocityX * relativeVelocityX + relativeVelocityZ * relativeVelocityZ;
  if (relativeSpeedSq < 0.04) return out;

  const approachDot = rx * relativeVelocityX + rz * relativeVelocityZ;
  if (approachDot >= 0) return out;
  const timeToClosest = -approachDot / relativeSpeedSq;
  out.timeToClosest = timeToClosest;
  out.closingSpeed = -approachDot / distance;
  if (timeToClosest > ENCOUNTER_LOOKAHEAD) return out;

  const closestX = rx + relativeVelocityX * timeToClosest, closestZ = rz + relativeVelocityZ * timeToClosest;
  const closestApproach = Math.hypot(closestX, closestZ);
  out.closestApproach = closestApproach;
  const safePassingDistance = 18 + Math.min(10, Math.max(Math.max(0, ownSpeed), Math.max(0, otherSpeed)) * 0.65);
  if (closestApproach >= safePassingDistance) return out;

  const invDistance = 1 / distance;
  const ownAhead = (ownForwardX * rx + ownForwardZ * rz) * invDistance;
  const targetStarboard = (Math.cos(ownHeading) * rx - Math.sin(ownHeading) * rz) * invDistance;
  const otherAhead = -(otherForwardX * rx + otherForwardZ * rz) * invDistance;
  const ownOnOtherStarboard = (-Math.cos(otherHeading) * rx + Math.sin(otherHeading) * rz) * invDistance;
  const courseDot = ownForwardX * otherForwardX + ownForwardZ * otherForwardZ;
  out.targetStarboard = targetStarboard;

  const closestRisk = clamp01((safePassingDistance - closestApproach) / safePassingDistance);
  const timeRisk = clamp01((ENCOUNTER_LOOKAHEAD - timeToClosest) / ENCOUNTER_LOOKAHEAD);
  const rangeRisk = clamp01((ENCOUNTER_RANGE - distance) / ENCOUNTER_RANGE);
  out.risk = clamp01(closestRisk * (0.32 + timeRisk * 0.43 + rangeRisk * 0.25));
  out.emergency = (timeToClosest < 4.2 && closestApproach < safePassingDistance * 0.58)
    || (distance < safePassingDistance * 1.18 && out.closingSpeed > 0.45);
  if (out.emergency) out.risk = Math.max(0.86, out.risk);

  // Rule 13 overrides the ordinary meeting/crossing hierarchy until the overtaking vessel is finally past and clear.
  if (otherAhead < OVERTAKING_SECTOR) {
    out.kind = 'overtaking-give-way'; out.role = NAVIGATION_ROLE.GIVE_WAY;
    const passStarboard = ownOnOtherStarboard >= 0;
    out.turn = passStarboard ? -1 : 1; out.speedScale = Math.max(0.5, 1 - out.risk * 0.52); out.signalBlasts = passStarboard ? 1 : 2;
  } else if (ownAhead < OVERTAKING_SECTOR) {
    out.kind = 'being-overtaken'; out.role = NAVIGATION_ROLE.STAND_ON; out.holdCourse = true;
  } else if (ownVessel === NAVIGATION_VESSEL.FISHING && otherVessel !== NAVIGATION_VESSEL.FISHING) {
    out.kind = 'fishing-stand-on'; out.role = NAVIGATION_ROLE.STAND_ON; out.holdCourse = true;
  } else if (otherVessel === NAVIGATION_VESSEL.FISHING && ownVessel !== NAVIGATION_VESSEL.FISHING) {
    out.kind = 'fishing-give-way'; out.role = NAVIGATION_ROLE.GIVE_WAY;
    out.turn = targetStarboard >= 0 ? 1 : -1;
    out.speedScale = Math.max(0.24, 1 - out.risk * 0.76); out.signalBlasts = out.turn < 0 ? 1 : 2;
  } else if (ownAhead > HEAD_ON_AHEAD && otherAhead > HEAD_ON_AHEAD && courseDot < HEAD_ON_COURSE) {
    out.kind = 'head-on'; out.role = NAVIGATION_ROLE.MUTUAL; out.turn = -1;
    out.speedScale = Math.max(0.58, 1 - out.risk * 0.42); out.signalBlasts = 1;
  } else if (targetStarboard >= 0) {
    out.kind = 'crossing-give-way'; out.role = NAVIGATION_ROLE.GIVE_WAY; out.turn = -1;
    out.speedScale = Math.max(0.34, 1 - out.risk * 0.66); out.signalBlasts = 1;
  } else {
    out.kind = 'crossing-stand-on'; out.role = NAVIGATION_ROLE.STAND_ON; out.holdCourse = true;
  }

  // Once holding course is no longer enough, every vessel acts. A crossing stand-on vessel avoids a port turn for
  // a target on its port side; a vessel being overtaken turns away from the overtaker instead.
  if (out.emergency) {
    if (out.kind === 'being-overtaken' || out.kind === 'fishing-stand-on') out.turn = targetStarboard > 0 ? 1 : -1;
    else if (out.role === NAVIGATION_ROLE.STAND_ON) out.turn = -1;
    out.holdCourse = false; out.speedScale = Math.min(out.speedScale, 0.42); out.signalBlasts = 5;
  }
  return out;
}
