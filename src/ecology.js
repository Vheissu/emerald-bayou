import * as THREE from 'three';
import { WORLD_HALF } from './terrain.js';
import { applyResidentRoutines } from './residentroutines.js';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hourDistance = (hour, target) => { const d = Math.abs(hour - target); return Math.min(d, 24 - d); };

export function feedingEventPotential(input = {}, windArg = 0, rainArg = 0, stormArg = 0, tideRateArg = 0, fishArg = 1, birdArg = 1) {
  const object = input && typeof input === 'object';
  const hour = object ? input.hour ?? 12 : input, wind = object ? input.wind ?? 0 : windArg, rain = object ? input.rain ?? 0 : rainArg;
  const storm = object ? input.storm ?? 0 : stormArg, tideRate = object ? input.tideRate ?? 0 : tideRateArg, fish = object ? input.fish ?? 1 : fishArg, bird = object ? input.bird ?? 1 : birdArg;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const daylight = smooth(5.35, 6.35, h) * (1 - smooth(19.05, 20.15, h));
  const twilight = Math.max(Math.exp(-Math.pow(hourDistance(h, 6.75) / 1.45, 2)), Math.exp(-Math.pow(hourDistance(h, 19.2) / 1.45, 2)));
  const movingWater = 0.45 + smooth(0.025, 0.22, Math.abs(Number(tideRate) || 0)) * 0.55;
  const weather = (1 - smooth(8, 17, wind)) * (1 - smooth(0.3, 0.82, storm)) * (1 - clamp(rain) * 0.42);
  const foodWeb = Math.sqrt(clamp(fish, 0, 1.5) * clamp(bird, 0, 1.7));
  return clamp(daylight * (0.24 + twilight * 0.76) * movingWater * weather * foodWeb);
}

export function feedingDisturbance(input = {}, speedArg = 0, wakeArg = 0) {
  const object = input && typeof input === 'object';
  const distance = object ? input.distance ?? Infinity : input, speed = object ? input.speed ?? 0 : speedArg, wake = object ? input.wake ?? 0 : wakeArg;
  const d = Math.max(0, Number(distance) || 0), s = Math.max(0, Number(speed) || 0), w = Math.abs(Number(wake) || 0);
  if (d < 23 && s > 5.2) return 'prop-wash';
  if (d < 42 && w > 0.052) return 'wake';
  return '';
}

export function bioluminescenceContrast(moonlight = 0) {
  return 1 - smooth(0.04, 0.9, clamp(Number(moonlight) || 0)) * 0.44;
}

// One director turns the clock and weather into behaviour budgets. Individual systems still own their movement;
// this only answers the ecological questions: who is out, who has gone home, and what is willing to surface.
export class Ecology {
  constructor(o) {
    Object.assign(this, o); // environment, birds, waders, manatees, gators, life, world, regions, water, plume, spray, game, audio
    this.human = 1; this.traffic = 1; this.fish = 1; this.bird = 1; this.gator = 1; this.surface = 1;
    this.visibilityT = 0; this.frogT = 8 + Math.random() * 10;
    this.residentRoutineInput = { role: 'camp', seed: 0.5, day: 1, hour: 12, storm: 0, rain: 0, wind: 0, distance: Infinity, playerSpeed: 0, attention: 0, pursuit: false };
    this.residentRoutineStats = { groups: 0, actors: 0, inside: 0, outside: 0, watching: 0, bracing: 0, passes: 0 };
    this.bio = 0; this.bioPotential = 0; this.bioContrast = 1; this.bioOverride = null; this.radio = null;
    this.nature = this.game ? (this.game.save.nature ||= {}) : {};
    this.feeding = { active: false, state: 'idle', x: 0, z: 0, age: 0, duration: 0, boilT: 0, safetyT: 0, seen: false, observed: false, quietT: 0, scatterT: 0, reason: '', potential: 0, intensity: 1, scatter: 0 };
    this.feedingCooldown = 48 + Math.random() * 58; this._feedingFlow = new THREE.Vector2();
    this.applyBioluminescence();
  }

  applyBioluminescence() {
    if (this.water?.uniforms?.bioluminescence) this.water.uniforms.bioluminescence.value = this.bio;
    if (this.plume?.mat?.uniforms?.bioluminescence) this.plume.mat.uniforms.bioluminescence.value = this.bio;
    if (this.spray?.mat?.uniforms?.bioluminescence) this.spray.mat.uniforms.bioluminescence.value = this.bio;
  }

  setBioluminescence(value = null, instant = false) {
    const numeric = Number(value);
    this.bioOverride = value == null || !Number.isFinite(numeric) ? null : clamp(numeric);
    if (instant) this.bio = this.bioOverride == null ? 0 : this.bioOverride;
    this.applyBioluminescence();
  }

  updateBioluminescence(dt, daylight) {
    const E = this.environment, V = E.values;
    // A bloom holds for several nights, then disappears for the rest of the week. This keeps the sight uncommon
    // without generating or retaining any event objects.
    const cycle = ((E.day - 1) % 7 + 7) % 7, bloomNight = cycle < 3;
    const calm = (1 - smooth(5, 13, V.wind)) * (1 - V.storm * 0.94) * (1 - V.rain * 0.72);
    this.bioPotential = bloomNight ? clamp((1 - daylight) * calm) : 0;
    this.bioContrast = bioluminescenceContrast(E.moonlight);
    const inReach = this.regions?.current?.id === 'mangrove';
    const target = this.bioOverride == null ? (inReach ? this.bioPotential * 0.62 * this.bioContrast : 0) : this.bioOverride;
    this.bio += (target - this.bio) * (1 - Math.exp(-dt * 0.55));
    if (this.bio < 0.0005 && target === 0) this.bio = 0;
    this.applyBioluminescence();

    let saveDirty = false;
    if (this.bioPotential > 0.62 && this.radio && this.nature.bioAdvisoryDay !== E.day) {
      this.nature.bioAdvisoryDay = E.day; saveDirty = true;
      this.radio.transmit({ channel: 'CH 68', speaker: 'JUNE BELL · SPLIT PINE', text: 'Blue fire is showing in Mangrove Reach. Pretty water, but nobody eats shellfish out of that cut tonight.', priority: 1, key: `nature:bio:${E.day}`, cooldown: 99999 });
    }
    if (this.bio > 0.34 && this.nature.bioSeenDay !== E.day) {
      this.nature.bioSeenDay = E.day; saveDirty = true;
      this.game.toast('Blue fire in the wake', 'Mangrove Reach · the plankton flashes only where the water moves', 4.2);
    }
    if (saveDirty) this.game.persist();
  }

  bioluminescenceSnapshot() {
    return { intensity: this.bio, potential: this.bioPotential, contrast: this.bioContrast, moonlight: clamp(this.environment.moonlight), override: this.bioOverride, region: this.regions?.current?.id || '', day: this.environment.day, hour: this.environment.hour };
  }

  feedingSpot(nearby = false) {
    const P = this.phys || this.game?.phys; if (!P) return null;
    const fx = -Math.sin(P.heading), fz = -Math.cos(P.heading), rx = -Math.cos(P.heading), rz = Math.sin(P.heading);
    for (let attempt = 0; attempt < 36; attempt++) {
      const along = (nearby ? 62 : 125) + Math.random() * (nearby ? 48 : 125), side = (Math.random() - 0.5) * (nearby ? 75 : 190);
      const x = P.pos.x + fx * along + rx * side, z = P.pos.y + fz * along + rz * side;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 260) continue;
      const depth = this.water.level - this.terrain.heightAt(x, z);
      if (depth < 0.9 || depth > 5.8 || this.world?.blockedAt(x, z)) continue;
      let clear = true;
      // Feeding birds need an open patch to circle and plunge. Reject a point whose school would sit against a bank,
      // even when its centre happens to be deep enough.
      for (let k = 0; k < 8 && clear; k++) {
        const angle = k * Math.PI / 4, sx = x + Math.cos(angle) * 24, sz = z + Math.sin(angle) * 24;
        if (this.water.level - this.terrain.heightAt(sx, sz) < 0.48 || this.world?.blockedAt(sx, sz)) clear = false;
      }
      for (let q = 0.2; q < 1; q += 0.2) {
        const sx = P.pos.x + (x - P.pos.x) * q, sz = P.pos.y + (z - P.pos.y) * q;
        if (this.water.level - this.terrain.heightAt(sx, sz) < 0.42 || this.world?.blockedAt(sx, sz)) { clear = false; break; }
      }
      if (clear) return { x, z };
    }
    return null;
  }

  startFeeding(nearby = false) {
    if (this.feeding.active) return false;
    const at = this.feedingSpot(nearby); if (!at) { this.feedingCooldown = Math.max(this.feedingCooldown, 18); return false; }
    const F = this.feeding;
    F.active = true; F.state = 'feeding'; F.x = at.x; F.z = at.z; F.age = 0; F.duration = 42 + Math.random() * 34;
    F.boilT = 0; F.safetyT = 0; F.seen = false; F.observed = false; F.quietT = 0; F.scatterT = 0; F.reason = ''; F.intensity = 1; F.scatter = 0;
    this.birds?.setFeedingActivity(F);
    return true;
  }

  scatterFeeding(reason = '') {
    const F = this.feeding; if (!F.active || F.state === 'scatter') return;
    F.state = 'scatter'; F.scatterT = 0; F.reason = reason;
    if (reason === 'prop-wash') this.game.toast('Bait blown out', 'Prop wash sent the mullet down.', 2.7);
    else if (reason === 'wake') this.game.toast('Wake reached the school', 'The birds lifted and the bait went deep.', 2.7);
  }

  endFeeding() {
    const F = this.feeding; F.active = false; F.state = 'idle';
    this.feedingCooldown = 145 + Math.random() * 155;
    this.birds?.setFeedingActivity(null);
  }

  updateFeeding(dt, t, potential) {
    const F = this.feeding; F.potential = potential;
    if (!F.active) {
      this.feedingCooldown -= dt * (0.18 + potential);
      if (this.feedingCooldown <= 0 && potential > 0.16) this.startFeeding(false);
      return;
    }
    const P = this.phys || this.game.phys; F.age += dt;
    if (this.currents) {
      const flow = this.currents.flowAt(F.x, F.z, this._feedingFlow);
      F.x += flow.x * dt * 0.42; F.z += flow.y * dt * 0.42;
    }
    F.safetyT -= dt;
    if (F.safetyT <= 0) {
      F.safetyT = 0.45;
      if (this.water.level - this.terrain.heightAt(F.x, F.z) < 0.68 || this.world?.blockedAt(F.x, F.z)) this.scatterFeeding();
    }
    const distance = Math.hypot(F.x - P.pos.x, F.z - P.pos.y);
    if (F.state === 'feeding') {
      const wake = this.life.traffic.playerWakeAt(F.x, F.z, t), reason = feedingDisturbance(distance, P.speed, wake);
      if (reason) this.scatterFeeding(reason);
      else if (this.environment.values.storm > 0.68 || this.environment.values.wind > 16) this.scatterFeeding();
      else if (F.age >= F.duration) this.scatterFeeding();
    }
    if (!F.seen && distance < 145) {
      F.seen = true; this.nature.feedingSeen = Math.min(9999, (this.nature.feedingSeen || 0) + 1); this.game.persist();
      this.game.toast('Birds working bait', 'Pelicans are holding over a mullet school.', 3.4);
    }
    if (F.state === 'feeding') {
      const holding = distance >= 24 && distance <= 64 && P.speed < 2.65;
      F.quietT = holding ? F.quietT + dt : Math.max(0, F.quietT - dt * 0.7);
      if (!F.observed && F.quietT >= 6) {
        F.observed = true; this.nature.feedingObserved = Math.min(9999, (this.nature.feedingObserved || 0) + 1); this.game.persist();
        this.game.bounties?.event('baitwatch', 1); this.game.toast('Bait held in the current', 'Six seconds at idle. The birds stayed on it.', 3.2);
      }
      F.boilT -= dt;
      if (F.boilT <= 0) {
        F.boilT = 0.18 + Math.random() * 0.34;
        const count = Math.random() < 0.28 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * 16;
          const x = F.x + Math.cos(angle) * radius, z = F.z + Math.sin(angle) * radius;
          if (this.water.level - this.terrain.heightAt(x, z) < 0.65) continue;
          const flee = angle + (Math.random() - 0.5) * 1.4, speed = 0.7 + Math.random() * 1.4;
          this.life.fish.launch(x, z, 1.7 + Math.random() * 1.5, Math.cos(flee) * speed, Math.sin(flee) * speed, 0.42 + Math.random() * 0.28, Math.random() < 0.22 ? 1 : 0);
        }
      }
      F.scatter = 0; this.birds?.setFeedingActivity(F);
    } else {
      F.scatterT += dt; F.scatter = clamp(F.scatterT / 5.5); this.birds?.setFeedingActivity(F);
      if (F.scatterT >= 7.5) this.endFeeding();
    }
  }

  feedingSnapshot() {
    const F = this.feeding;
    return { active: F.active, state: F.state, x: F.x, z: F.z, age: F.age, duration: F.duration, distance: F.active ? Math.hypot(F.x - (this.phys || this.game.phys).pos.x, F.z - (this.phys || this.game.phys).pos.y) : null, quiet: F.quietT, seen: F.seen, observed: F.observed, reason: F.reason, potential: F.potential, cooldown: this.feedingCooldown, pools: { fish: this.life.fish.n, birdInstances: this.birds.count } };
  }

  applyResidentGroup(group, site, role) {
    if (!site) return;
    const input = this.residentRoutineInput, phys = this.phys || this.game?.phys;
    input.role = role; input.distance = phys ? Math.hypot(site.x - phys.pos.x, site.z - phys.pos.y) : Infinity;
    applyResidentRoutines(group, input, this.residentRoutineStats);
  }

  updateVisibility() {
    const input = this.residentRoutineInput, stats = this.residentRoutineStats;
    const environment = this.environment, values = environment.values, phys = this.phys || this.game?.phys;
    const law = this.game?.law;
    input.day = environment.day; input.hour = environment.hour;
    input.storm = values.storm; input.rain = values.rain; input.wind = values.wind * environment.gust;
    input.playerSpeed = phys?.speed || 0; input.attention = law?.attention || 0; input.pursuit = Boolean(law?.pursuit);
    stats.groups = 0; stats.actors = 0; stats.inside = 0; stats.outside = 0; stats.watching = 0; stats.bracing = 0; stats.passes++;
    for (const group of this.world.liveCamps.values()) this.applyResidentGroup(group, group.userData.site, 'camp');
    for (const { site, g } of this.world.liveSites.values()) this.applyResidentGroup(g, site, site.kind);
    for (const { f, g } of this.life.folk.live.values()) this.applyResidentGroup(g, f, 'angler');
  }

  residentRoutineSnapshot() { return { ...this.residentRoutineStats }; }

  update(dt, t, enabled = true) {
    if (!enabled) return;
    const E = this.environment, V = E.values, h = E.hour;
    const day = smooth(5.6, 7.1, h) * (1 - smooth(18.5, 20.2, h));
    this.updateBioluminescence(dt, day);
    const twilight = Math.max(Math.exp(-Math.pow(hourDistance(h, 6.9) / 1.35, 2)), Math.exp(-Math.pow(hourDistance(h, 19.1) / 1.35, 2)));
    const R = this.regions && this.regions.current ? this.regions.current.ecology : {};
    const humanT = clamp((0.035 + day * 0.965) * (1 - V.storm * 0.96) * (1 - V.rain * 0.36) * (R.human ?? 1), 0, 1.2);
    const trafficT = clamp((0.14 + day * 0.86) * (1 - V.storm * 0.86) * (R.traffic ?? 1), 0, 1.4);
    const fishT = clamp((0.38 + twilight * 0.58 + V.rain * 0.12 - V.storm * 0.24) * (R.fish ?? 1), 0.08, 1.35);
    const birdT = clamp((0.035 + day * 0.965) * (1 - V.storm * 0.92) * (R.bird ?? 1), 0, 1.65);
    const gatorT = clamp((0.68 + (1 - day) * 0.34 + twilight * 0.26 + V.rain * 0.08) * (R.gator ?? 1), 0.35, 1.65);
    const surfaceT = clamp((1 - V.storm * 0.72 - V.rain * 0.14) * (R.surface ?? 1), 0.06, 1.1);
    const k = 1 - Math.exp(-dt * 0.65);
    this.human += (humanT - this.human) * k; this.traffic += (trafficT - this.traffic) * k;
    this.fish += (fishT - this.fish) * k; this.bird += (birdT - this.bird) * k;
    this.gator += (gatorT - this.gator) * k; this.surface += (surfaceT - this.surface) * k;

    this.life.fish.activity = this.fish;
    this.life.traffic.activity = this.traffic;
    this.life.traffic.anglerActivity = this.human;
    this.life.folk.activity = this.human;
    this.world.humanActivity = this.human;
    this.birds.activity = this.bird;
    this.waders.activity = clamp(this.bird * 0.9 + 0.05);
    this.manatees.surfaceActivity = this.surface;
    this.gators.activity = this.gator;
    const feedingPotential = feedingEventPotential(h, V.wind * this.environment.gust, V.rain, V.storm, this.environment.tideRate, this.fish, this.bird);
    this.updateFeeding(dt, t, feedingPotential);

    this.visibilityT -= dt;
    if (this.visibilityT <= 0) { this.visibilityT = 0.5; this.updateVisibility(); }

    const night = 1 - day;
    if (night > 0.45 && V.storm < 0.88) {
      this.frogT -= dt;
      if (this.frogT <= 0) { this.frogT = 7 + Math.random() * 18; this.audio.frog((0.05 + night * 0.09) * (0.8 + V.rain * 0.35)); }
    } else this.frogT = Math.min(this.frogT, 8 + Math.random() * 5);
  }
}
