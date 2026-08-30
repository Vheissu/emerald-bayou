const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const amount = clamp((value - low) / Math.max(1e-6, high - low));
  return amount * amount * (3 - 2 * amount);
};
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const retainedDistance = value => value === Infinity ? Infinity : finite(value);

export const MANATEE_CLEARANCE_METERS = 15.24; // FWC asks powered vessels to remain at least fifty feet away.
export const MANATEE_LOOKAHEAD_SECONDS = 7;

export function createManateeAvoidance() {
  return {
    active: false, urgency: 0, distance: Infinity, closestApproach: Infinity, timeToClosest: Infinity,
    closingSpeed: 0, ahead: 0, turn: 0, targetX: 0, targetZ: 0, targetDistance: Infinity,
  };
}

export function clearManateeAvoidance(out = {}) {
  out.active = false; out.urgency = 0; out.distance = Infinity; out.closestApproach = Infinity; out.timeToClosest = Infinity;
  out.closingSpeed = 0; out.ahead = 0; out.turn = 0; out.targetX = 0; out.targetZ = 0; out.targetDistance = Infinity;
  return out;
}

export function copyManateeAvoidance(source, out = {}) {
  out.active = Boolean(source?.active); out.urgency = finite(source?.urgency); out.distance = retainedDistance(source?.distance);
  out.closestApproach = retainedDistance(source?.closestApproach); out.timeToClosest = retainedDistance(source?.timeToClosest);
  out.closingSpeed = finite(source?.closingSpeed); out.ahead = finite(source?.ahead); out.turn = finite(source?.turn);
  out.targetX = finite(source?.targetX); out.targetZ = finite(source?.targetZ); out.targetDistance = retainedDistance(source?.targetDistance);
  return out;
}

// Predict the closest point between one retained traffic hull and one manatee. The caller owns both `input` and
// `out`, so the seven-boat traffic loop can appraise the four resident animals without allocating every frame.
export function evaluateManateeApproach(input = {}, out = {}) {
  clearManateeAvoidance(out);
  if (!input.visible) return out;
  const boatX = finite(input.boatX), boatZ = finite(input.boatZ), boatHeading = finite(input.boatHeading);
  const boatSpeed = Math.max(0, finite(input.boatSpeed)), animalX = finite(input.animalX), animalZ = finite(input.animalZ);
  const animalHeading = finite(input.animalHeading), animalSpeed = Math.max(0, finite(input.animalSpeed));
  const sightRange = Math.max(MANATEE_CLEARANCE_METERS, finite(input.sightRange) || 80);
  const dx = animalX - boatX, dz = animalZ - boatZ, distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance > sightRange || boatSpeed < 0.45) return out;

  const boatVX = -Math.sin(boatHeading) * boatSpeed, boatVZ = -Math.cos(boatHeading) * boatSpeed;
  const animalVX = -Math.sin(animalHeading) * animalSpeed, animalVZ = -Math.cos(animalHeading) * animalSpeed;
  const relativeVX = animalVX - boatVX, relativeVZ = animalVZ - boatVZ;
  const relativeSpeedSq = relativeVX * relativeVX + relativeVZ * relativeVZ;
  const closestTime = relativeSpeedSq > 1e-5
    ? clamp(-(dx * relativeVX + dz * relativeVZ) / relativeSpeedSq, 0, MANATEE_LOOKAHEAD_SECONDS)
    : 0;
  const closestX = dx + relativeVX * closestTime, closestZ = dz + relativeVZ * closestTime;
  const closestApproach = Math.hypot(closestX, closestZ);
  const closingSpeed = distance > 1e-4 ? Math.max(0, -(dx * relativeVX + dz * relativeVZ) / distance) : boatSpeed;
  const forwardX = -Math.sin(boatHeading), forwardZ = -Math.cos(boatHeading);
  const ahead = distance > 1e-4 ? (dx * forwardX + dz * forwardZ) / distance : 1;
  if (ahead < -0.2 && distance > MANATEE_CLEARANCE_METERS * 1.35) return out;

  const directRisk = 1 - smooth(MANATEE_CLEARANCE_METERS, MANATEE_CLEARANCE_METERS + 13, distance);
  const pathRisk = 1 - smooth(MANATEE_CLEARANCE_METERS, MANATEE_CLEARANCE_METERS + 28, closestApproach);
  const timeRisk = 1 - smooth(0.6, MANATEE_LOOKAHEAD_SECONDS, closestTime);
  const rangeRisk = 1 - smooth(sightRange * 0.7, sightRange, distance);
  const speedRisk = smooth(0.6, 5.8, boatSpeed);
  const closingRisk = smooth(0.15, 5.5, closingSpeed);
  const urgency = clamp(Math.max(directRisk * 0.9, pathRisk * (0.34 + timeRisk * 0.66))
    * speedRisk * rangeRisk * (0.48 + closingRisk * 0.52));
  if (urgency <= 0.012) return out;

  const rightX = Math.cos(boatHeading), rightZ = -Math.sin(boatHeading), side = dx * rightX + dz * rightZ;
  const sidePreference = finite(input.sidePreference) < 0 ? -1 : 1;
  const turn = Math.abs(side) < 1.5 ? sidePreference : side >= 0 ? 1 : -1;
  out.active = true; out.urgency = urgency; out.distance = distance; out.closestApproach = closestApproach;
  out.timeToClosest = closestTime; out.closingSpeed = closingSpeed; out.ahead = ahead; out.turn = turn;
  out.targetX = animalX + animalVX * closestTime; out.targetZ = animalZ + animalVZ * closestTime;
  out.targetDistance = Math.hypot(out.targetX - boatX, out.targetZ - boatZ);
  return out;
}

export function manateeReactionReady(state, noticeTime = 0, reactionDelay = 0) {
  if (!state?.active || finite(state.urgency) <= 0.012) return false;
  const immediate = finite(state.distance) <= MANATEE_CLEARANCE_METERS * 1.45
    || (finite(state.timeToClosest) <= 1.35 && finite(state.closestApproach) <= MANATEE_CLEARANCE_METERS * 0.62);
  return immediate || Math.max(0, finite(noticeTime)) >= Math.max(0.12, finite(reactionDelay));
}

export function manateeSpeedScale(response = 0, kind = 'john') {
  const strength = clamp(finite(response));
  return 1 - strength * (kind === 'canoe' ? 0.38 : kind === 'cruiser' ? 0.76 : 0.84);
}

// Probe candidates receive a larger score when they open the predicted fifty-foot clearance and turn away from the
// animal's side. `state` is the retained closest-approach result already owned by the traffic boat.
export function manateeProbeScore(state, probeX = 0, probeZ = 0, probeTurn = 0, response = 0) {
  const strength = clamp(finite(response));
  if (!strength || !state?.active) return 0;
  const separation = Math.hypot(finite(probeX) - finite(state.targetX), finite(probeZ) - finite(state.targetZ));
  const opened = clamp((separation - finite(state.targetDistance)) / 35, -1.5, 1.5);
  const alignment = Math.abs(finite(probeTurn) - finite(state.turn) * 0.7);
  return strength * (opened * 5.4 - alignment * 4.6);
}
