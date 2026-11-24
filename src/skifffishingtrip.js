import { CatmullRomCurve3, Vector3 } from 'three';
import { waterfrontColliders } from './waterfrontlayout.js';

const BOW_OUT = -Math.PI / 2;
const SLIP_LENGTH = 10.7;
const PASS_OFFSET = 4.3;
const LOOKAHEADS = [2.5, 5.5, 9];
const fit = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const approach = (current, target, maxStep) => current + fit(target - current, -maxStep, maxStep);

// The northern skiff works the outside bank. The southern crew goes around the
// old bar, then through the marked span to the deeper hole below Gulf Cut.
const RUNS = [
  [[-4, 32.7], [3.5, 35.4], [10.5, 47.5], [12, 61], [9, 73], [2, 83]],
  [[-5, -3.7], [4, -3.7], [17.5, -5.7], [23.5, -14.5], [25, -24], [22, -36],
    [9.8, -47.6], [7, -60.5], [8, -75], [11, -90], [12.5, -101]],
];

function buildCourse(berth, index) {
  const points = [new Vector3(berth.x, 0, berth.z), ...RUNS[index].map(([x, z]) => new Vector3(x, 0, z))];
  const course = new CatmullRomCurve3(points);
  course.arcLengthDivisions = 240;
  return course;
}

export function createFishingTrip(berth, index) {
  const course = buildCourse(berth, index), length = course.getLength();
  const end = course.points[course.points.length - 1];
  return {
    berth, course, length, index, station: { x: end.x, z: end.z },
    x: berth.x, z: berth.z, heading: BOW_OUT, turn: 0, speed: 0, vx: 0, vz: 0, courseSpeed: 0, progress: 0,
    phase: 'berthed', alarm: 0, reaction: '', greeting: 0, greeted: false, outOfEarshot: 0,
    storm: false, secured: true, reverse: false,
    timer: 15 + 9 * index, clearFor: 0, trips: 0, offset: 0, offsetGoal: 0, scanIn: 0, room: 16,
    point: new Vector3(), tangent: new Vector3(), probe: new Vector3(), probeTangent: new Vector3(),
  };
}

function pierClear(x, z) {
  for (const { ax, az, bx, bz, r } of waterfrontColliders) {
    const dx = bx - ax, dz = bz - az;
    const t = fit(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < (r + 1.22) ** 2) return false;
  }
  return true;
}

function waterRoom({ heightAt, waterLevel = 0 }, x, z, tx, tz) {
  if (!pierClear(x, z)) return false;
  if (!heightAt) return true;
  const limit = waterLevel - 0.50;
  return heightAt(x, z) < limit
    && heightAt(x - tz * 1.15, z + tx * 1.15) < limit
    && heightAt(x + tz * 1.15, z - tx * 1.15) < limit
    && heightAt(x + tx * 1.65, z + tz * 1.65) < limit
    && heightAt(x - tx * 1.35, z - tz * 1.35) < limit;
}

function positionOnCourse(trip, progress, offset, point, tangent) {
  const fraction = fit(progress / trip.length, 0, 1);
  trip.course.getPointAt(fraction, point);
  trip.course.getTangentAt(fraction, tangent);
  point.x -= tangent.z * offset;
  point.z += tangent.x * offset;
}

function velocity(boat, axis, forward) {
  return Number.isFinite(boat[axis]) ? boat[axis] : forward * (boat.speed || 0);
}

function passingAlarm(trip, player, wake) {
  if (!player) return 0;
  const dx = player.x - trip.x, dz = player.z - trip.z, distance = Math.hypot(dx, dz);
  if (distance >= 45) return 0;
  const vx = velocity(player, 'vx', -Math.sin(player.heading || 0));
  const vz = velocity(player, 'vz', -Math.cos(player.heading || 0));
  const rvx = vx - trip.vx, rvz = vz - trip.vz;
  const closestIn = fit(-(dx * rvx + dz * rvz) / Math.max(.01, rvx * rvx + rvz * rvz), 0, 5);
  const closest = Math.hypot(dx + rvx * closestIn, dz + rvz * closestIn);
  const speed = Math.hypot(vx, vz);
  const approachRisk = closestIn > .1 || distance < 8
    ? (1 - fit((closest - 3) / 12, 0, 1)) * fit((speed - 2.3) / 6.2, 0, 1)
    : 0;
  const personalSpace = .28 * (1 - fit((distance - 2) / 7, 0, 1));
  const wash = distance < 36 ? fit((Math.abs(wake) - .045) / .135, 0, 1) : 0;
  return Math.max(approachRisk, personalSpace, wash);
}

function passingClearance(trip, context, direction, offset) {
  const { player, otherBoats = [] } = context;
  let clearance = 16;
  for (const reach of LOOKAHEADS) {
    const progress = fit(trip.progress + reach * direction, 0, trip.length);
    const point = trip.probe, tangent = trip.probeTangent;
    positionOnCourse(trip, progress, offset, point, tangent);
    if (!waterRoom(context, point.x, point.z, tangent.x, tangent.z)) return 0;
    if (player && Math.hypot(trip.x - player.x, trip.z - player.z) < 27) {
      const predict = reach / Math.max(2.5, trip.speed);
      const vx = velocity(player, 'vx', -Math.sin(player.heading || 0));
      const vz = velocity(player, 'vz', -Math.cos(player.heading || 0));
      clearance = Math.min(clearance, Math.hypot(point.x - player.x - vx * predict, point.z - player.z - vz * predict) - 2.1);
    }
    for (const boat of otherBoats) {
      if (boat === trip || boat.active === false || Math.abs(boat.x - trip.x) > 25 || Math.abs(boat.z - trip.z) > 25) continue;
      clearance = Math.min(clearance, Math.hypot(point.x - boat.x, point.z - boat.z) - (boat.r || 1.4));
    }
  }
  return clearance;
}

function localStop(trip, context, direction, nextPoint, nextTangent) {
  const { player, otherBoats = [] } = context;
  const aheadX = nextTangent.x * direction, aheadZ = nextTangent.z * direction;
  if (player) {
    const dx = player.x - nextPoint.x, dz = player.z - nextPoint.z;
    if (dx * aheadX + dz * aheadZ > -1 && Math.hypot(dx, dz) < 3.8) return true;
  }
  for (const boat of otherBoats) {
    if (boat === trip || boat.active === false) continue;
    const dx = boat.x - nextPoint.x, dz = boat.z - nextPoint.z;
    if (dx * aheadX + dz * aheadZ > -1 && Math.hypot(dx, dz) < 1.9 + (boat.r || 1.4)) return true;
  }
  return !waterRoom(context, nextPoint.x, nextPoint.z, nextTangent.x, nextTangent.z);
}

function updateWeather(trip, context, dt) {
  const { storm = 0, stormApproaching = false, wind = 0 } = context;
  const unsafe = storm >= .48 + trip.index * .055 || wind > 17.5 || stormApproaching;
  if (unsafe) {
    trip.storm = true;
    trip.clearFor = 0;
  } else if (storm < .30 && wind < 13) {
    trip.clearFor += dt;
    if (trip.clearFor > 19 + trip.index * 5) trip.storm = false;
  } else {
    trip.clearFor = 0;
  }
}

function updateReaction(trip, dt, { player, wake = 0, contactHold = 0 }) {
  const risk = contactHold > 0 ? 1 : passingAlarm(trip, player, wake);
  trip.alarm = approach(trip.alarm, risk, dt * (risk > trip.alarm ? 3.5 : .52));
  const distance = player ? Math.hypot(player.x - trip.x, player.z - trip.z) : Infinity;
  trip.outOfEarshot = distance > 22 ? trip.outOfEarshot + dt : 0;
  if (trip.outOfEarshot > 3) trip.greeted = false;
  if (trip.alarm > .45) {
    trip.reaction = 'brace';
    trip.greeting = 0;
    trip.greeted = true;
    return;
  }
  if (!trip.greeted && distance < 11 && Math.hypot(player.vx ?? player.speed ?? 0, player.vz ?? 0) < 4.5) {
    trip.greeted = true;
    trip.greeting = 1.32;
  }
  trip.greeting = Math.max(0, trip.greeting - dt);
  trip.reaction = trip.greeting > .91 ? 'watch' : trip.greeting > 0 ? 'hail' : '';
}

function runCourse(trip, dt, context, returning) {
  const { course, point, tangent, berth } = trip;
  const direction = returning ? -1 : 1;
  const remaining = returning ? trip.progress : trip.length - trip.progress;
  const atSlip = trip.progress <= SLIP_LENGTH;
  const backing = returning && atSlip;
  trip.reverse = backing;
  if (returning) trip.phase = atSlip ? 'docking' : 'returning';
  else trip.phase = atSlip ? 'departing' : 'outbound';

  const cruiseSpeed = (trip.index ? 5.75 : 5.15) * (trip.storm ? .87 : 1);
  const speedLimit = backing ? .82 : atSlip ? 2.10 : cruiseSpeed;
  const look = fit(trip.progress + direction * Math.max(1.4, trip.speed * .72), 0, trip.length);
  course.getTangentAt(look / trip.length, tangent);
  const facing = returning && !backing ? -1 : 1;
  const target = Math.atan2(-tangent.x * facing, -tangent.z * facing);
  const yawError = wrap((backing && trip.progress < 3 ? BOW_OUT : target) - trip.heading);
  const turnStep = fit(yawError * dt * 2.65, -dt * .76, dt * .76);
  trip.heading = wrap(trip.heading + turnStep);
  trip.turn = turnStep / dt;

  trip.scanIn -= dt;
  if (trip.scanIn <= 0) {
    trip.scanIn = .20;
    trip.offsetGoal = 0;
    let best = passingClearance(trip, context, direction, 0);
    if (best < PASS_OFFSET && trip.progress > 15 && trip.length - trip.progress > 8) {
      for (const offset of [direction * PASS_OFFSET, -direction * PASS_OFFSET]) {
        const slot = passingClearance(trip, context, direction, offset);
        if (slot > best + .75) {
          best = slot;
          trip.offsetGoal = offset;
        }
      }
    }
    trip.room = best;
  }

  const taper = fit((trip.progress - 6) / 10, 0, 1) * fit((trip.length - trip.progress) / 8, 0, 1);
  const desiredOffset = trip.offsetGoal * taper;
  // Allow a slow sidestep while holding for a boat in the fairway. Passing slot
  // changes remain slower than the outboard can plausibly swing the bow.
  const offset = approach(trip.offset, desiredOffset, dt * (1.05 + trip.speed * .15));
  const trafficScale = fit((trip.room - 1.25) / 4, 0, 1);
  const turnScale = fit(1 - Math.abs(yawError) / 1.52, 0, 1);
  const targetSpeed = Math.min(speedLimit * (1 - trip.alarm * .48) * trafficScale * turnScale,
    Math.max(.27, Math.sqrt(remaining * 1.35)));
  const forwardSpeed = trip.courseSpeed * direction;
  const braking = forwardSpeed < 0 || targetSpeed < forwardSpeed;
  trip.courseSpeed = approach(trip.courseSpeed, direction * targetSpeed, dt * (braking ? 3.1 : 1.48));
  const progress = fit(trip.progress + trip.courseSpeed * dt, 0, trip.length);
  positionOnCourse(trip, progress, offset, point, tangent);
  if (localStop(trip, context, Math.sign(trip.courseSpeed) || direction, point, tangent)) {
    stopMotion(trip);
    return;
  }
  trip.vx = (point.x - trip.x) / dt;
  trip.vz = (point.z - trip.z) / dt;
  trip.speed = Math.abs(trip.courseSpeed);
  trip.progress = progress;
  trip.offset = offset;
  trip.x = point.x;
  trip.z = point.z;

  if (returning ? progress > 0 : progress < trip.length) return;
  if (returning) {
    trip.phase = 'berthed';
    trip.secured = true;
    trip.reverse = false;
    trip.x = berth.x;
    trip.z = berth.z;
    trip.timer = 38 + trip.index * 16;
  } else {
    trip.phase = 'fishing';
    trip.timer = 66 + trip.index * 16 + (trip.trips % 3) * 8;
    trip.trips++;
  }
  trip.turn = 0;
  stopMotion(trip);
}

function stopMotion(trip) {
  trip.speed = 0;
  trip.vx = 0;
  trip.vz = 0;
  trip.courseSpeed = 0;
}

export function stepFishingTrip(trip, dt, context = {}) {
  if (dt <= 0) return trip;
  updateWeather(trip, context, dt);
  updateReaction(trip, dt, context);
  const { daylight = 1 } = context;
  const goHome = trip.storm || daylight < .18;
  if (trip.phase === 'berthed') {
    const clear = !goHome && daylight > .32 && trip.alarm < .25;
    if (clear) trip.timer -= dt;
    if (trip.timer > 0 || !clear) return trip;
    trip.scanIn -= dt;
    if (trip.scanIn > 0) return trip;
    trip.scanIn = .25;
    if (passingClearance(trip, context, 1, 0) < 4) return trip;
    trip.phase = 'departing';
    trip.secured = false;
    trip.scanIn = 0;
  }
  if (trip.phase === 'fishing') {
    trip.timer -= dt;
    if (trip.timer > 0 && !goHome) return trip;
    trip.phase = 'returning';
    trip.scanIn = 0;
  } else if (goHome && (trip.phase === 'departing' || trip.phase === 'outbound')) {
    trip.phase = 'returning';
    trip.scanIn = 0;
  }
  const returning = trip.phase === 'returning' || trip.phase === 'docking';
  runCourse(trip, dt, context, returning);
  return trip;
}
