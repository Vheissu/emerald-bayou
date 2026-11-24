// Routes share the terrain's metre coordinates. Only the worker evaluates depth and searches the grid.
const EDGE_SPACING = 5;
const CLEARANCE = 1.3;
const MIN_DEPTH = 0.52;
const START_SEARCH = 35;
const DESTINATION_SEARCH = 64;
const SQRT2 = Math.SQRT2;
const STEPS = [[0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1], [1, -1, SQRT2], [1, 1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

function pointSegmentDistanceSq(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
  const along = lengthSq ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0;
  return (x - ax - dx * along) ** 2 + (z - az - dz * along) ** 2;
}

function chartWater(heightAt, maxGround, minCeiling, limit, obstacles, overheadAt) {
  const heights = new Map();
  const cells = new Map(), binSize = 64, key = (x, z) => x * 65536 + z;
  for (const obstacle of obstacles) {
    const ax = obstacle.ax ?? obstacle.x, az = obstacle.az ?? obstacle.z;
    const bx = obstacle.bx ?? ax, bz = obstacle.bz ?? az, radius = obstacle.r + CLEARANCE;
    const shape = { ax, az, bx, bz, radiusSq: radius * radius };
    for (let i = Math.floor((Math.min(ax, bx) - radius) / binSize); i <= Math.floor((Math.max(ax, bx) + radius) / binSize); i++) {
      for (let j = Math.floor((Math.min(az, bz) - radius) / binSize); j <= Math.floor((Math.max(az, bz) + radius) / binSize); j++) {
        const cell = key(i, j);
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push(shape);
      }
    }
  }
  const roomAt = (x, z) => {
    if (Math.abs(x) > limit || Math.abs(z) > limit || overheadAt(x, z) < minCeiling) return false;
    const nearby = cells.get(key(Math.floor(x / binSize), Math.floor(z / binSize)));
    if (nearby) for (const o of nearby) {
      if (pointSegmentDistanceSq(x, z, o.ax, o.az, o.bx, o.bz) < o.radiusSq) return false;
    }
    const ix = Math.round(x * 2), iz = Math.round(z * 2), sample = key(ix, iz);
    if (!heights.has(sample)) heights.set(sample, heightAt(ix / 2, iz / 2));
    return heights.get(sample) <= maxGround;
  };
  const edgeClear = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    const samples = Math.max(1, Math.ceil(length / EDGE_SPACING));
    const nx = -dz / (length || 1) * CLEARANCE, nz = dx / (length || 1) * CLEARANCE;
    for (let i = 0; i <= samples; i++) {
      const x = ax + dx * i / samples, z = az + dz * i / samples;
      if (!roomAt(x, z) || !roomAt(x + nx, z + nz) || !roomAt(x - nx, z - nz)) return false;
    }
    // Compare the whole route segment to point/capsule obstacles, which can fit between depth samples.
    const seen = new Set();
    for (let i = Math.floor(Math.min(ax, bx) / binSize); i <= Math.floor(Math.max(ax, bx) / binSize); i++) {
      for (let j = Math.floor(Math.min(az, bz) / binSize); j <= Math.floor(Math.max(az, bz) / binSize); j++) {
        const nearby = cells.get(key(i, j));
        if (!nearby) continue;
        for (const o of nearby) {
          if (seen.has(o)) continue;
          seen.add(o);
          const cax = o.ax - ax, caz = o.az - az, cbx = o.bx - ax, cbz = o.bz - az;
          const crossA = dx * caz - dz * cax, crossB = dx * cbz - dz * cbx;
          const odx = o.bx - o.ax, odz = o.bz - o.az;
          const crossC = -odx * caz + odz * cax, crossD = odx * (dz - caz) - odz * (dx - cax);
          if (crossA * crossB < 0 && crossC * crossD < 0) return false;
          if (Math.min(
            pointSegmentDistanceSq(o.ax, o.az, ax, az, bx, bz), pointSegmentDistanceSq(o.bx, o.bz, ax, az, bx, bz),
            pointSegmentDistanceSq(ax, az, o.ax, o.az, o.bx, o.bz), pointSegmentDistanceSq(bx, bz, o.ax, o.az, o.bx, o.bz),
          ) < o.radiusSq) return false;
        }
      }
    }
    return true;
  };
  return { roomAt, edgeClear };
}

class OpenNodes {
  constructor() { this.items = []; }
  push(node) {
    const nodes = this.items;
    let i = nodes.length;
    nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (nodes[parent].rank <= node.rank) break;
      nodes[i] = nodes[parent]; i = parent;
    }
    nodes[i] = node;
  }
  pop() {
    const nodes = this.items, top = nodes[0], last = nodes.pop();
    if (!nodes.length) return top;
    let i = 0;
    while (i * 2 + 1 < nodes.length) {
      let child = i * 2 + 1;
      if (child + 1 < nodes.length && nodes[child + 1].rank < nodes[child].rank) child++;
      if (nodes[child].rank >= last.rank) break;
      nodes[i] = nodes[child]; i = child;
    }
    nodes[i] = last;
    return top;
  }
}

function closestWater(point, roomAt, radius) {
  if (roomAt(point.x, point.z)) return point;
  for (let r = 5; r <= radius; r += 5) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const x = point.x + Math.cos(angle) * r, z = point.z + Math.sin(angle) * r;
      if (roomAt(x, z)) return { x, z };
    }
  }
  return null;
}

function simplifyPath(raw, edgeClear) {
  const points = [raw[0]];
  for (let i = 0; i < raw.length - 1;) {
    let next = i + 1;
    // Retain some local waypoints so the simplifier never tests a whole distant estuary from each bend.
    for (let j = Math.min(raw.length - 1, i + 28); j > next; j--) {
      if (edgeClear(raw[i].x, raw[i].z, raw[j].x, raw[j].z)) { next = j; break; }
    }
    points.push(raw[next]);
    i = next;
  }
  return points;
}

function searchGrid(start, target, step, limit, water, budget, allowApproach) {
  const { roomAt, edgeClear } = water;
  const testGoalRadius = Math.max(18, step * 1.6);
  const snapRadius = allowApproach ? DESTINATION_SEARCH : 12;
  const open = new OpenNodes(), nodes = new Map();
  const key = (i, j) => i * 65536 + j;
  const margin = Math.min(4800, Math.max(480, distance(start, target) * 0.7));
  const minX = Math.max(-limit, Math.min(start.x, target.x) - margin), maxX = Math.min(limit, Math.max(start.x, target.x) + margin);
  const minZ = Math.max(-limit, Math.min(start.z, target.z) - margin), maxZ = Math.min(limit, Math.max(start.z, target.z) + margin);
  const visit = (i, j, parent, cost) => {
    const id = key(i, j), old = nodes.get(id);
    if (old && cost >= old.cost) return;
    const x = i * step, z = j * step;
    if (x < minX || x > maxX || z < minZ || z > maxZ || !roomAt(x, z)) return;
    if (!edgeClear(parent.x, parent.z, x, z)) return;
    const node = { i, j, x, z, parent, cost, rank: cost + Math.hypot(x - target.x, z - target.z) * 1.26 };
    nodes.set(id, node); open.push(node);
  };
  const i0 = Math.round(start.x / step), j0 = Math.round(start.z / step);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const i = i0 + di, j = j0 + dj;
    visit(i, j, start, Math.hypot(i * step - start.x, j * step - start.z));
  }
  let approach = null, approachRank = Infinity;
  for (let count = 0; open.items.length && count < budget; count++) {
    const node = open.pop();
    if (node !== nodes.get(key(node.i, node.j))) continue;
    const remaining = distance(node, target);
    if (!allowApproach && remaining <= testGoalRadius && edgeClear(node.x, node.z, target.x, target.z)) {
      return { ...target, parent: node };
    }
    if (remaining <= snapRadius) {
      const rank = node.cost + remaining * 3;
      if (rank < approachRank) { approach = node; approachRank = rank; }
    }
    if (approach && node.rank > approachRank + step * 3) break;
    for (const [di, dj, scale] of STEPS) visit(node.i + di, node.j + dj, node, node.cost + step * scale);
  }
  return approach;
}

export function planWaterRoute({ start, target, heightAt, limit = 12740, waterLevel = 0, obstacles = [], overheadAt = () => Infinity }) {
  if (![start.x, start.z, target.x, target.z, waterLevel].every(Number.isFinite)) return { status: 'unreachable', points: [] };
  const water = chartWater(heightAt, waterLevel - MIN_DEPTH, waterLevel + 3.3, limit, obstacles, overheadAt);
  const launch = closestWater(start, water.roomAt, START_SEARCH);
  if (!launch) return { status: 'unreachable', points: [] };
  const launchOffset = distance(start, launch);
  if (water.edgeClear(launch.x, launch.z, target.x, target.z)) return { status: 'ready', points: [launch, target], launchOffset };

  const length = distance(launch, target), approach = !water.roomAt(target.x, target.z);
  const passes = length < 900 ? [[11, 3600], [6, 9500]] : length < 4500 ? [[17, 16000], [10, 30500]] : [[23, 28000], [13, 46000]];
  for (const [step, budget] of passes) {
    const found = searchGrid(launch, target, step, limit, water, budget, approach);
    if (!found) continue;
    const raw = [];
    for (let node = found; node; node = node.parent) raw.push({ x: node.x, z: node.z });
    const points = simplifyPath(raw.reverse(), water.edgeClear);
    return { status: 'ready', points, launchOffset, destinationOffset: distance(found, target) };
  }
  return { status: 'unreachable', points: [] };
}

export function measureRoute(points) {
  const distances = [0], turns = [];
  const bearings = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    distances.push(distances[i - 1] + distance(a, b));
    bearings.push(Math.atan2(b.x - a.x, a.z - b.z));
  }
  for (let i = 1; i < bearings.length; i++) {
    const angle = Math.atan2(Math.sin(bearings[i] - bearings[i - 1]), Math.cos(bearings[i] - bearings[i - 1]));
    if (Math.abs(angle) < Math.PI / 9 || distances[i] - distances[i - 1] < 6 || distances[i + 1] - distances[i] < 6) continue;
    turns.push({ index: i, distance: distances[i], direction: angle > 0 ? 'right' : 'left', degrees: Math.round(Math.abs(angle) * 180 / Math.PI) });
  }
  return { distances, turns, length: distances[distances.length - 1] };
}

export function routeProgress(route, x, z, previous = 0) {
  const { points, distances, length, turns } = route;
  if (points.length < 2) return null;
  let best = null, bestLateral = Infinity;
  for (let i = Math.max(0, previous - 2); i < Math.min(points.length - 1, previous + 9); i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const ratio = lengthSq ? clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0, 1) : 0;
    const px = a.x + dx * ratio, pz = a.z + dz * ratio, lateral = Math.hypot(px - x, pz - z);
    if (lateral >= bestLateral) continue;
    bestLateral = lateral;
    best = { x: px, z: pz, segment: i, along: distances[i] + (distances[i + 1] - distances[i]) * ratio, lateral };
  }
  const turn = turns.find(t => t.distance >= best.along - 2);
  return {
    ...best,
    remaining: Math.max(0, length - best.along) + best.lateral,
    turn: turn ? { ...turn, remaining: Math.max(0, turn.distance - best.along) + best.lateral } : null,
  };
}
