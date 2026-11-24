import { measureRoute, routeProgress } from './waterroute.js';
import { waterfrontColliders } from './waterfrontlayout.js';

export const ROUTE_COLOR = '#ff9489';
const point = p => ({ x: p.x, z: p.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function fixedObstacles(boat, world, target) {
  const obstacles = [];
  const append = list => {
    for (const o of list) {
      if (!Number.isFinite(o.r)) continue;
      const ax = o.ax ?? o.x, az = o.az ?? o.z, bx = o.bx ?? ax, bz = o.bz ?? az;
      if ([ax, az, bx, bz].every(Number.isFinite)) obstacles.push({ ax, az, bx, bz, r: o.r });
    }
  };
  append(boat.obstacles || []);
  append(waterfrontColliders);
  for (const [key, list] of boat.dyn || []) {
    if (key.startsWith('camp:') || key.startsWith('site:')) append(list);
  }
  // The destination may be beyond the live scenery radius, but its berth already exists in the chart.
  for (const camp of world?.campsNear(target.x, target.z, 90) || []) {
    if (!boat.dyn?.has(`camp:${camp.key}`)) append(world.campColliders(camp));
  }
  for (const site of world?.sitesNear(target.x, target.z, 90) || []) {
    if (site.colliders && !boat.dyn?.has(`site:${site.key}`)) append(site.colliders);
  }
  return obstacles;
}

export class ChartNavigation {
  constructor(seed, world = null) {
    this.seed = seed;
    this.world = world;
    this.worker = null;
    this.workerFailed = false;
    this.pin = null;
    this.target = null;
    this.request = null;
    this.inFlight = false;
    this.plan = null;
    this.progress = null;
    this.status = '';
    this.clock = 0;
    this.serial = 0;
  }

  setPin(x, z, label = 'Waypoint') {
    this.pin = { x, z, label, color: ROUTE_COLOR };
    this.target = null;
    this.plan = this.progress = null;
    this.status = 'plotting';
  }

  clearPin() {
    this.pin = null;
    this.target = null;
    this.plan = this.progress = null;
    this.status = '';
  }

  suspend() {
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
    this.request = null;
  }

  update(dt, boat, target, waterLevel) {
    this.clock += dt;
    const chosen = this.pin || (target?.suggested ? null : target);
    if (!chosen) {
      this.target = null;
      this.request = this.plan = this.progress = null;
      this.status = '';
      return;
    }
    const position = { x: boat.pos.x, z: boat.pos.y };
    const newTarget = !this.target || this.target.label !== chosen.label || distance(this.target, chosen) > 90;
    this.target = this.pin || chosen;
    if (newTarget) {
      this.plan = this.progress = null;
      this.request = null;
    }
    if (distance(position, chosen) < 5) {
      this.plan = this.progress = null;
      this.request = null;
      this.status = 'arrived';
      return;
    }
    if (this.plan) this.progress = routeProgress(this.plan, position.x, position.z, this.progress?.segment);
    const water = Math.round(waterLevel * 5) / 5;
    const elapsed = this.request ? this.clock - this.request.when : Infinity;
    const missed = this.progress?.lateral > 24;
    const moved = this.request && distance(this.request.start, position);
    const targetMoved = this.request && distance(this.request.target, chosen);
    const nearby = distance(position, chosen) < 200;
    const tideChanged = this.request && Math.abs(this.request.waterLevel - water) > 0.15;
    if (!this.request || (!this.inFlight && elapsed >= 1.5 && (
      (tideChanged && elapsed >= 4) || (missed && moved > 18) || targetMoved > (nearby ? 12 : 30)
      || (this.status === 'unreachable' && moved > 35)
    ))) {
      if (tideChanged && this.request.waterLevel > water) this.plan = this.progress = null;
      this.requestPlan(position, chosen, water, boat);
    }
    if (this.plan?.destinationOffset && this.progress?.remaining < 8) this.status = 'approach';
    else if (this.plan?.launchOffset > 9 && this.progress?.along < 2 && this.progress?.lateral > 9) this.status = 'channel';
    else if (missed && this.inFlight) this.status = 'plotting';
    else if (this.plan && this.status !== 'plotting') this.status = 'ready';
  }

  requestPlan(start, target, waterLevel, boat) {
    if (this.inFlight) {
      // A changed pin should supersede a long search immediately.
      if (this.request) return;
      this.worker?.terminate();
      this.worker = null;
      this.inFlight = false;
    }
    if (this.workerFailed) { this.status = 'unreachable'; return; }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./waterroute.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => this.receive(data);
        this.worker.onerror = () => {
          this.worker?.terminate(); this.worker = null; this.workerFailed = true;
          this.inFlight = false;
          if (this.target && !this.plan) this.status = 'unreachable';
        };
      } catch {
        this.workerFailed = true;
        this.status = 'unreachable';
        return;
      }
    }
    this.request = { id: ++this.serial, start, target: point(target), waterLevel, when: this.clock };
    this.inFlight = true;
    if (!this.plan) this.status = 'plotting';
    this.worker.postMessage({ ...this.request, seed: this.seed, obstacles: fixedObstacles(boat, this.world, target) });
  }

  receive(data) {
    this.inFlight = false;
    if (data.id !== this.request?.id) return;
    this.status = data.status;
    this.plan = data.points.length > 1 ? { ...data, ...measureRoute(data.points) } : null;
    this.progress = null;
  }

  guidance(formatDistance) {
    const turn = this.progress?.turn;
    if (this.status === 'plotting') return 'Plotting route';
    if (this.status === 'unreachable') return 'No charted water route';
    if (this.status === 'arrived') return 'Arrived';
    if (this.status === 'approach') return 'Shore approach';
    if (this.status === 'channel') return 'Return to the channel';
    if (turn) return `${turn.direction === 'left' ? 'Left' : 'Right'} in ${formatDistance(turn.remaining)}`;
    return '';
  }

  plot(c, scale, zoom = 1) {
    const path = this.plan?.points;
    if (!path || !this.progress) return;
    const { x, z, segment, turn } = this.progress;
    c.save();
    c.lineJoin = c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, z);
    for (let i = segment + 1; i < path.length; i++) c.lineTo(path[i].x, path[i].z);
    c.strokeStyle = '#1e2d35';
    c.lineWidth = 6 * zoom / scale;
    c.stroke();
    c.strokeStyle = ROUTE_COLOR;
    c.lineWidth = 3.5 * zoom / scale;
    c.stroke();
    if (turn) {
      const b = path[turn.index], lead = path[turn.index + 1], px = 3.3 * zoom / scale;
      c.translate(b.x, b.z);
      c.rotate(Math.atan2(lead.z - b.z, lead.x - b.x));
      c.beginPath(); c.moveTo(-px, -px); c.lineTo(px, 0); c.lineTo(-px, px);
      c.lineJoin = 'miter'; c.lineWidth = 1.3 * zoom / scale; c.strokeStyle = '#1e2d35'; c.stroke();
    }
    c.restore();
  }
}
