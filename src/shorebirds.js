import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { willetMesh } from './shorebirdmodel.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = (x) => x * x * (3 - 2 * x);
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Project onto a gently sloping bank at today's water level. Stop at deep water,
// vertical faces and obstructions rather than placing a foot on an arbitrary slope.
export function findFeedingShelf(terrain, x, z, level, offset = 0, blocked) {
  for (let i = 0; i < 6; i++) {
    const y = terrain.heightAt(x, z);
    const dx = (terrain.heightAt(x + 0.55, z) - terrain.heightAt(x - 0.55, z)) / 1.1;
    const dz = (terrain.heightAt(x, z + 0.55) - terrain.heightAt(x, z - 0.55)) / 1.1;
    const slope = Math.hypot(dx, dz),
      error = level + offset - y;
    if (!Number.isFinite(slope + error) || slope > 0.49 || Math.abs(error) > 2.2) return null;
    if (Math.abs(error) < 0.035) {
      if (blocked?.(x, z)) return null;
      return { x, y, z, nx: dx / (slope || 1), nz: dz / (slope || 1) };
    }
    if (slope < 0.025) return null;
    const step = clamp(error / slope, -4, 4);
    x += (step * dx) / slope;
    z += (step * dz) / slope;
  }
  return null;
}

function levelFeet(terrain, b, dt) {
  const floor = terrain.heightAt(b.x, b.z);
  b.y += (floor - b.y) * (1 - Math.exp(-dt * 16));
}

export class ShorebirdFlock {
  constructor(terrain, count, blocked) {
    this.terrain = terrain;
    this.blocked = blocked;
    this.count = count;
    this.rand = mulberry32(69047);
    this.mesh = willetMesh(count);
    this.mesh.visible = false;
    this.birds = [];
    this.clock = 0;
    this.searchIn = 0;
    this.alarmIn = 0;
    this.remoteIndex = 0;
    this.transforms = new THREE.Object3D();
    this.pose = { morphTargetInfluences: new Float32Array(6) };
    for (let i = 0; i < count; i++) this.mesh.setMorphAt(i, this.pose);
    this.mesh.boundingSphere = new THREE.Sphere();
    this.ripples = 0;
    this.flushes = 0;
  }
  shelf(x, z, offset = 0) {
    return findFeedingShelf(this.terrain, x, z, this.level, offset, this.blocked);
  }
  locate(bx, bz) {
    if (Math.hypot(bx - 71.3, bz + 25) < 180) {
      const home = this.shelf(71.3, -25);
      if (home) return home;
    }
    // Amortize the offscreen habitat search while travelling through deep channels.
    for (let i = 0; i < 16; i++) {
      const n = this.remoteIndex++,
        angle = n * 2.399963,
        r = 56 + (n % 11) * 7;
      const x = bx + Math.cos(angle) * r,
        z = bz + Math.sin(angle) * r;
      if (Math.abs(this.terrain.heightAt(x, z) - this.level) > 1.4) continue;
      const point = this.shelf(x, z);
      if (point) return point;
    }
    return null;
  }
  footing(patch, index) {
    const spread = (index - (this.count - 1) / 2) * 1.48 + (this.rand() - 0.5) * 0.58;
    return this.shelf(patch.x + patch.nz * spread, patch.z - patch.nx * spread, this.rand() * 0.12 - 0.08);
  }
  populate(patch) {
    this.birds.length = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.footing(patch, i);
      if (!p) continue;
      this.birds.push({
        ...p,
        phase: this.rand() * TAU,
        heading: this.rand() * TAU,
        scale: 0.91 + this.rand() * 0.16,
        state: 'rest',
        left: 0.2 + this.rand() * 4,
        duration: 1,
        air: 0,
        probe: 0,
        stride: 0,
        stepClock: 0,
        tideCheck: this.rand() * 1.7,
      });
    }
    this.patch = this.birds.length ? patch : null;
    this.mesh.count = this.birds.length;
    this.mesh.visible = this.birds.length > 0;
    this.alarmIn = 1;
  }
  nextPatch(x, z) {
    const p = this.patch,
      tangentX = p.nz,
      tangentZ = -p.nx;
    const away = (p.x - x) * tangentX + (p.z - z) * tangentZ >= 0 ? 1 : -1;
    for (const dir of [away, -away]) {
      for (const stride of [14, 23, 32]) {
        const target = this.shelf(p.x + dir * tangentX * stride, p.z + dir * tangentZ * stride);
        if (target) return target;
      }
    }
    return p;
  }
  startleNear(x, z, radius) {
    if (!this.birds.some((b) => Math.hypot(b.x - x, b.z - z) < radius)) return false;
    return this.alarm(x, z);
  }
  alarm(bx, bz) {
    if (!this.patch || this.alarmIn > 0 || this.birds.some((b) => b.state === 'flight' || b.state === 'alert'))
      return false;
    const target = this.nextPatch(bx, bz);
    let closest = Infinity;
    for (const b of this.birds) closest = Math.min(closest, Math.hypot(b.x - bx, b.z - bz));
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.destination = this.footing(target, i) || this.shelf(b.x, b.z) || target;
      const delay = (Math.hypot(b.x - bx, b.z - bz) - closest) * 0.045;
      b.state = 'alert';
      b.left = 0.1 + delay + this.rand() * 0.18;
      b.probe = 0;
      b.stride = 0;
    }
    this.patch = target;
    this.alarmIn = 7;
    this.flushes++;
    this.callOnLiftoff = true;
    return true;
  }
  contact(x, z, strong, fx) {
    if (this.terrain.heightAt(x, z) > this.level + 0.012) return;
    fx?.emitStamp?.(x, z, strong ? 0.54 : 0.34, strong ? 0.2 : 0.08, strong ? 0.16 : 0.035, strong ? 0.48 : 0.29);
    this.ripples++;
  }
  flight(b, dt, fx) {
    if (b.left < b.duration * 0.3 && Math.abs(b.destination.y - this.level) > 0.12) {
      const newShelf = this.shelf(b.destination.x, b.destination.z, -0.025);
      if (newShelf) b.destination = newShelf;
    }
    const p = b.destination;
    b.left = Math.max(0, b.left - dt);
    const u = 1 - b.left / b.duration,
      t = smooth(u);
    const arc = Math.sin(Math.PI * u);
    const oldX = b.x,
      oldZ = b.z;
    b.x = THREE.MathUtils.lerp(b.sx, p.x, t) - b.bendX * arc;
    b.z = THREE.MathUtils.lerp(b.sz, p.z, t) - b.bendZ * arc;
    const ground = this.terrain.heightAt(b.x, b.z);
    const base = THREE.MathUtils.lerp(b.sy, p.y, t);
    b.y = Math.max(base + arc * b.altitude, ground + 0.08 * arc, this.level + arc * 0.32 - 0.13);
    const targetHeading = Math.atan2(b.x - oldX, b.z - oldZ);
    const turn = angleTo(b.heading, targetHeading);
    b.heading += turn * (1 - Math.exp(-dt * 9));
    b.bank = clamp(turn, -0.55, 0.55) * arc;
    b.air = Math.min(1, u * 15, (1 - u) * 12);
    if (b.left > 0) return;
    b.state = 'rest';
    b.left = 1 + this.rand() * 2.5;
    b.air = 0;
    b.bank = 0;
    b.y = ground;
    this.contact(b.x, b.z, true, fx);
  }
  walkTo(b, dest) {
    b.destination = dest;
    b.state = 'walk';
    b.stride = 1;
    b.heading = Math.atan2(dest.x - b.x, dest.z - b.z);
  }
  birdStep(b, dt, fx) {
    if (b.state === 'flight') {
      this.flight(b, dt, fx);
      return;
    }
    if (b.state === 'walk') {
      const dx = b.destination.x - b.x,
        dz = b.destination.z - b.z,
        d = Math.hypot(dx, dz);
      const step = Math.min(d, dt * 0.38);
      if (d > 0.001) {
        b.x += (dx / d) * step;
        b.z += (dz / d) * step;
      }
      const old = b.stepClock;
      b.stepClock += dt * 8.4;
      if (Math.floor(old / Math.PI) !== Math.floor(b.stepClock / Math.PI)) this.contact(b.x, b.z, false, fx);
      if (d < 0.025) {
        b.state = 'rest';
        b.stride = 0;
        b.left = 0.4 + this.rand() * 2.4;
      }
      levelFeet(this.terrain, b, dt);
      return;
    }
    b.left -= dt;
    if (b.state === 'alert') {
      if (b.left <= 0) {
        b.state = 'flight';
        if (this.callOnLiftoff) {
          fx?.audio?.willetCall?.(b.x, b.z);
          this.callOnLiftoff = false;
        }
        b.sx = b.x;
        b.sy = b.y;
        b.sz = b.z;
        const distance = Math.hypot(b.x - b.destination.x, b.z - b.destination.z);
        b.left = b.duration = 2.8 + distance * 0.058;
        b.altitude = 1.3 + this.rand() * 0.95;
        b.bendX = this.patch.nx * (4 + this.rand() * 1.6);
        b.bendZ = this.patch.nz * (4 + this.rand() * 1.6);
        this.contact(b.x, b.z, true, fx);
      }
      return;
    }
    levelFeet(this.terrain, b, dt);
    b.tideCheck -= dt;
    if (b.tideCheck <= 0) {
      b.tideCheck = 1.15 + this.rand() * 0.8;
      if (b.y < this.level - 0.11 || b.y > this.level + 0.15) {
        const place = this.shelf(b.x, b.z, -0.025);
        if (place) {
          b.probe = 0;
          this.walkTo(b, place);
          return;
        }
        this.alarm(b.x - this.patch.nz * 12, b.z + this.patch.nx * 12);
        return;
      }
    }
    if (b.state === 'probe') {
      const old = b.probe;
      const u = clamp(1 - b.left / b.duration, 0, 1);
      b.probe = Math.sin(u * Math.PI) ** 2;
      if (old < 0.91 && b.probe >= 0.91)
        this.contact(b.x + Math.sin(b.heading) * 0.12, b.z + Math.cos(b.heading) * 0.12, false, fx);
      if (b.left <= 0) {
        b.state = 'rest';
        b.left = 0.4 + this.rand() * 2.7;
        b.probe = 0;
      }
    } else if (b.left <= 0) {
      if (this.rand() < 0.61) {
        b.state = 'probe';
        b.left = b.duration = 0.38 + this.rand() * 0.32;
      } else {
        const distance = (this.rand() - 0.5) * 1.65;
        const patch = this.patch;
        const spread = Math.hypot(b.x - patch.x, b.z - patch.z);
        const home = spread > 7 ? 0.2 : 0;
        const dest = this.shelf(
          b.x + patch.nz * distance + (patch.x - b.x) * home,
          b.z - patch.nx * distance + (patch.z - b.z) * home,
          this.rand() * 0.11 - 0.065,
        );
        if (dest) this.walkTo(b, dest);
        else b.left = 1;
      }
    }
  }
  draw() {
    const o = this.transforms,
      weights = this.pose.morphTargetInfluences;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i],
        air = b.air;
      const wing = Math.sin(this.clock * 25 + b.phase);
      const effort = b.state === 'flight' && b.left / b.duration < 0.17 ? 0.1 : 0.86;
      weights[0] = b.probe;
      weights[2] = air * Math.max(0, wing) * effort;
      weights[3] = air * Math.max(0, -wing) * effort;
      weights[1] = air - weights[2] - weights[3];
      weights[4] = Math.max(0, Math.sin(b.stepClock)) * b.stride;
      weights[5] = Math.max(0, -Math.sin(b.stepClock)) * b.stride;
      o.position.set(b.x, b.y + 0.003, b.z);
      o.rotation.set(0, b.heading, b.bank || 0, 'YXZ');
      o.scale.setScalar(b.scale);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
      this.mesh.setMorphAt(i, this.pose);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.morphTexture) this.mesh.morphTexture.needsUpdate = true;
  }
  update(dt, time, boat, level, fx, weather) {
    if (!(dt > 0)) return;
    this.clock += dt;
    this.level = level;
    this.alarmIn = Math.max(0, this.alarmIn - dt);
    const bx = boat.pos.x,
      bz = boat.pos.y;
    if (this.patch && Math.hypot(this.patch.x - bx, this.patch.z - bz) > 220) {
      this.patch = null;
      this.birds.length = 0;
      this.mesh.visible = false;
      this.searchIn = 0.1;
    }
    if (!this.patch) {
      this.searchIn -= dt;
      if (this.searchIn > 0) return;
      this.searchIn = 2.4;
      const p = this.locate(bx, bz);
      if (p) this.populate(p);
      if (!this.patch) return;
    }
    let nearest = Infinity,
      wake = 0;
    for (const b of this.birds) {
      nearest = Math.min(nearest, Math.hypot(b.x - bx, b.z - bz));
      if (b.state !== 'flight' && nearest < 95)
        wake = Math.max(wake, Math.abs(fx?.playerWakeAt?.(b.x, b.z, time) || 0));
    }
    const storm = weather?.values?.storm || 0;
    if (
      nearest < Math.min(40, 5 + Math.abs(boat.speed) * 1.9) ||
      (wake > 0.085 && nearest < 85) ||
      (storm > 0.6 && !this.stormFlushed)
    ) {
      if (this.alarm(bx, bz)) this.stormFlushed = storm > 0.6;
    }
    if (storm < 0.38) this.stormFlushed = false;
    for (const bird of this.birds) this.birdStep(bird, dt, fx);
    this.mesh.castShadow = nearest < 48;
    const bounds = this.mesh.boundingSphere;
    bounds.center.set(this.patch.x, this.level + 1, this.patch.z);
    let reach = 0;
    for (const b of this.birds)
      reach = Math.max(reach, bounds.center.distanceToSquared(this.transforms.position.set(b.x, b.y, b.z)));
    bounds.radius = Math.sqrt(reach) + 0.5;
    this.draw();
  }
}
