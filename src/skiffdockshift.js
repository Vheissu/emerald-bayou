const WALK_SPEED = 1.46;
const CARRY_SPEED = 1.28;
const CONTACT = 0.5;
const ABOARD_YAW = Math.PI;
const SORT_PICKUP = 0.28;
const SORT_DROP = 0.78;
const SORT_SECONDS = 1.65;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const smooth = value => value * value * (3 - 2 * value);
const anchor = (space, x, y, z) => ({ space, x, y, z });
const heading = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

const REVERSE_ACTION = {
  lift: 'lower', lower: 'lift', board: 'step-off', 'step-off': 'board', seat: 'rise', rise: 'seat',
};

function crewRoute(berth, job, gearName, storage, load, shelter) {
  const { side, pier } = berth;
  const dock = (x, z) => anchor('dock', x, pier.deck, pier.z + side * z);
  const hull = (x, y, z) => anchor('boat', side * x, y, z);
  const helm = job === 'helm';
  const pickup = helm ? dock(pier.x + 2.93, -0.09) : dock(pier.x + 1.46, 0.05);
  const approach = dock(berth.x - 0.78, 0.24);
  const landing = dock(berth.x, 1.17), sill = dock(berth.x, 1.49);
  const tread = anchor('dock', berth.x, pier.deck - 0.125, pier.z + side * 1.67);
  const gunwale = hull(-0.61, 0.48, 0), cockpit = hull(-0.24, 0.095, -0.03);
  const seat = helm ? anchor('boat', -0.21, 0.064, 1.23) : anchor('boat', 0.02, 0.073, -0.95);
  const drop = helm ? hull(0.045, 0.095, -0.045) : hull(-0.31, 0.095, 0.77);
  const steps = [];
  let position = shelter, clock = 0, facing = Math.PI / 2;
  const add = (action, to, duration, gear = 'none', reach = null, yaw = null) => {
    const from = position, moving = from !== to;
    if (yaw !== null) facing = yaw;
    else if (reach && reach.space === from.space) facing = heading(from, reach);
    else if (moving && from.space === to.space && Math.hypot(from.x - to.x, from.z - to.z) > 0.03) facing = heading(from, to);
    const end = clock + duration;
    steps.push({ action, from, to, start: clock, end, facing, gear, reach, moving });
    clock = end; position = to;
  };
  const walk = (to, gear = 'none') => {
    const distance = Math.hypot(to.x - position.x, to.z - position.z);
    if (distance > 0.01) add(gear === 'none' ? 'walk' : 'carry', to, Math.max(0.25, distance / (gear === 'none' ? WALK_SPEED : CARRY_SPEED)), gear);
  };

  add('idle', shelter, helm ? 0.15 : 1.10);
  walk(pickup);
  const storageAt = clock;
  const pickupAt = clock + (helm ? 0.9 : 0.75) * CONTACT;
  add('lift', pickup, helm ? 0.90 : 0.75, gearName, storage);
  walk(approach, gearName);
  walk(landing, gearName);
  // Only one crew member occupies the opening at a time. The second person
  // waits clear of the rail with the pail so both have a handhold at the sill.
  if (!helm) add('carry', landing, 1.88, gearName, null, side > 0 ? 0 : Math.PI);
  walk(sill, gearName);
  const firstBoardAt = clock;
  add('board', tread, 0.31, gearName);
  add('board', gunwale, 0.58, gearName);
  add('board', cockpit, 0.62, gearName);

  if (!helm) {
    // The pail stays aft of the bench without blocking passage to the tiller.
    walk(hull(-0.36, 0.095, 0.17), gearName);
    add('board', hull(-0.53, 0.56, 0.46), 0.54, gearName);
    add('board', drop, 0.49, gearName);
  } else {
    walk(drop, gearName);
  }
  const dropAt = clock + 0.87 * CONTACT;
  add('lower', drop, 0.87, gearName, load);

  if (helm) {
    walk(hull(-0.36, 0.095, 0.17));
    add('board', hull(-0.53, 0.56, 0.46), 0.49);
    add('board', hull(-0.40, 0.095, 0.82), 0.52);
  } else {
    add('board', hull(-0.46, 0.56, 0.46), 0.52);
    add('board', cockpit, 0.52);
    walk(hull(-0.04, 0.095, -0.52));
  }
  walk(seat);
  add('seat', seat, 0.82, 'none', null, ABOARD_YAW);
  return { steps, shelter, seat, pickup, storageAt, pickupAt, dropAt, firstBoardAt, duration: clock };
}

export function createDockShift(berth, index) {
  const { pier, side } = berth;
  const shelter = (x, z) => anchor('dock', pier.x + x, pier.deck, pier.z + side * z);
  const coolerDock = anchor('dock', pier.x + 2.96, pier.deck + 0.82, pier.z + side * 0.49);
  const tackleDock = shelter(1.55, 0.56);
  const coolerBoat = anchor('boat', side * 0.38, 0.095, -0.31);
  const tackleBoat = anchor('boat', side * 0.25, 0.095, 0.76);
  const helm = crewRoute(berth, 'helm', 'cooler', coolerDock, coolerBoat, shelter(1.0, -0.43));
  const angler = crewRoute(berth, 'angler', 'tackle', tackleDock, tackleBoat, shelter(1.91, 0.29));
  const createActor = home => ({
    from: home, to: home, progress: 0, action: 'idle', actionProgress: 0, moving: false,
    gear: 'none', reach: null, facing: Math.PI / 2,
  });
  return {
    helm: createActor(helm.shelter), angler: createActor(angler.shelter),
    routes: { helm, angler }, phase: 'waiting', elapsed: 0, duration: Math.max(helm.duration, angler.duration),
    atSea: false, atFishingGround: false, retreating: false, unloading: false, storm: false, ready: false,
    delay: index * 2.25, catchCount: 0, showCatchFor: 0,
    sorting: false, sortProgress: 0, sortOffset: 0, landedCount: 0,
    sortFrom: anchor('dock', pier.x + 2.92, pier.deck + 1.05, pier.z + side * 0.42),
    sortTo: anchor('dock', pier.x + 3.34, pier.deck + 0.89, pier.z + side * 0.47),
    gear: {
      cooler: { owner: 'dock', point: coolerDock, dock: coolerDock, boat: coolerBoat, count: 0, open: 0, rotation: 0 },
      tackle: { owner: 'dock', point: tackleDock, dock: tackleDock, boat: tackleBoat, count: 0, rotation: 0 },
    },
  };
}

function skinActor(actor, route, elapsed, reversing, shelterAction) {
  const { steps, shelter, seat, duration } = route;
  if (elapsed <= 0) {
    actor.from = actor.to = shelter;
    actor.progress = actor.actionProgress = 0;
    actor.action = shelterAction;
    actor.moving = false; actor.gear = 'none'; actor.reach = null; actor.facing = Math.PI / 2;
    return;
  }
  if (elapsed >= duration) {
    actor.from = actor.to = seat;
    actor.progress = actor.actionProgress = 1;
    actor.action = 'aboard';
    actor.moving = false; actor.gear = 'none'; actor.reach = null; actor.facing = ABOARD_YAW;
    return;
  }
  const step = steps.find(segment => reversing ? elapsed <= segment.end : elapsed < segment.end);
  let progress = (elapsed - step.start) / (step.end - step.start);
  if (reversing) progress = 1 - progress;
  actor.from = reversing ? step.to : step.from;
  actor.to = reversing ? step.from : step.to;
  actor.action = reversing ? (REVERSE_ACTION[step.action] || step.action) : step.action;
  actor.actionProgress = progress;
  actor.progress = step.action === 'board' ? smooth(progress) : progress;
  actor.moving = step.moving;
  actor.gear = step.gear;
  actor.reach = step.reach;
  const backTrack = reversing && step.moving && actor.from.space === actor.to.space;
  actor.facing = backTrack ? heading(actor.from, actor.to) : step.facing;
}

function placeGear(prop, route, elapsed, actor) {
  if (elapsed <= route.pickupAt) {
    prop.owner = 'dock'; prop.point = prop.dock;
  } else if (elapsed >= route.dropAt) {
    prop.owner = 'boat'; prop.point = prop.boat;
  } else {
    prop.owner = actor;
  }
}

function sortCatch(shift, dt) {
  const before = shift.sortProgress;
  shift.sortProgress = Math.min(1, before + dt / SORT_SECONDS);
  shift.sortOffset += dt;
  if (before < SORT_PICKUP && shift.sortProgress >= SORT_PICKUP) shift.catchCount--;
  if (before < SORT_DROP && shift.sortProgress >= SORT_DROP) shift.landedCount = Math.min(4, shift.landedCount + 1);
  if (shift.sortProgress === 1) {
    shift.sortProgress = 0;
    shift.sorting = shift.catchCount > 0;
  }
}

function prepareReturn(shift, received) {
  shift.atSea = false;
  shift.atFishingGround = false;
  shift.unloading = true;
  shift.retreating = true;
  shift.catchCount = received;
}

function returnAlongDock(shift, dt, stayIn) {
  shift.ready = false;
  shift.phase = shift.unloading ? 'unloading' : 'sheltering';
  if (shift.sorting) {
    sortCatch(shift, dt);
    return;
  }
  const next = Math.max(0, shift.elapsed - dt * (stayIn ? 1.08 : 1));
  const benchAt = shift.routes.helm.storageAt;
  if (shift.unloading && shift.catchCount > 0 && shift.elapsed > benchAt && next <= benchAt) {
    shift.elapsed = benchAt;
    shift.sorting = true;
    return;
  }
  shift.elapsed = next;
  if (next === 0) {
    shift.retreating = shift.unloading = false;
    shift.sortOffset = 0;
    shift.phase = stayIn ? 'sheltered' : 'waiting';
  }
}

function benchPose(shift) {
  const actor = shift.helm, bench = shift.routes.helm.pickup;
  actor.from = actor.to = bench;
  actor.progress = 0;
  actor.action = 'sort';
  actor.actionProgress = shift.sortProgress;
  actor.moving = false;
  actor.gear = 'none';
  actor.reach = shift.sortFrom;
  actor.facing = Math.atan2((shift.sortFrom.x + shift.sortTo.x) * 0.5 - bench.x,
    (shift.sortFrom.z + shift.sortTo.z) * 0.5 - bench.z);
}

export function stepDockShift(shift, trip, dt, daylight = 1) {
  if (!(dt > 0)) return shift;
  shift.storm = Boolean(trip.storm);
  const stayIn = shift.storm || daylight < 0.32;
  const shelterAction = stayIn ? 'shelter' : 'idle';
  const received = clamp(Math.floor(trip.catchCount || 0), 0, 4);
  if (!trip.secured) {
    shift.atSea = true;
    if (trip.phase === 'fishing' && !shift.atFishingGround) {
      shift.atFishingGround = true;
      shift.landedCount = 0;
    }
    shift.elapsed = shift.duration;
    shift.phase = 'aboard';
    shift.ready = true;
    if (received > shift.catchCount && trip.phase === 'fishing') shift.showCatchFor = 1.8;
    shift.catchCount = received;
  } else {
    if (shift.atSea) prepareReturn(shift, received);
    if (stayIn && shift.elapsed > 0) shift.retreating = true;
    if (shift.retreating) {
      returnAlongDock(shift, dt, stayIn);
    } else if (!stayIn && (shift.elapsed > 0 || trip.timer <= shift.duration + 1)) {
      shift.delay = Math.max(0, shift.delay - dt);
      if (shift.delay === 0) {
        shift.elapsed = Math.min(shift.duration, shift.elapsed + dt);
        shift.ready = shift.elapsed >= shift.duration;
        shift.phase = shift.ready ? 'aboard' : shift.elapsed < shift.routes.helm.firstBoardAt ? 'loading' : 'boarding';
        if (shift.elapsed > shift.routes.helm.pickupAt) shift.catchCount = 0;
      }
    } else {
      shift.ready = false;
      shift.phase = stayIn ? 'sheltered' : 'waiting';
    }
  }

  const anglerElapsed = Math.max(0, shift.elapsed - shift.sortOffset);
  if (shift.sorting) benchPose(shift);
  else skinActor(shift.helm, shift.routes.helm, shift.elapsed, shift.retreating, shelterAction);
  skinActor(shift.angler, shift.routes.angler, anglerElapsed, shift.retreating, shelterAction);
  placeGear(shift.gear.cooler, shift.routes.helm, shift.elapsed, 'helm');
  placeGear(shift.gear.tackle, shift.routes.angler, anglerElapsed, 'angler');
  const cooler = shift.gear.cooler;
  cooler.count = shift.catchCount;
  shift.showCatchFor = Math.max(0, shift.showCatchFor - dt);
  const showCatch = shift.sorting || (cooler.count > 0 && (cooler.owner === 'dock' || (shift.showCatchFor > 0 && trip.phase === 'fishing')));
  cooler.open += ((showCatch ? 1 : 0) - cooler.open) * -Math.expm1(-dt * 5);
  return shift;
}
