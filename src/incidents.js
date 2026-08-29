import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { kayak } from './markers.js';
import { WORLD_HALF } from './heightfield.js';
import { regionAt } from './regions.js';
import { emitWakeStamp } from './wakestamps.js';
import { emitMapMarker } from './mapmarkers.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const PROBES = [-1.28, -0.84, -0.42, 0, 0.42, 0.84, 1.28];
const RECOVERY_PROBES = [-Math.PI, -2.36, -1.57, -0.78, 0, 0.78, 1.57, 2.36];

function recolor(group, color) {
  let done = false;
  group.traverse(o => {
    if (done || !o.isMesh || !o.material || !o.material.color || o.material.metalness < 0.45) return;
    o.material = o.material.clone(); o.material.color.setHex(color); done = true;
  });
}

function signalLight(parent, color, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const light = new THREE.PointLight(color, 0, 28, 2); g.add(bulb, light); parent.add(g);
  return { group: g, bulb, light };
}

function makeAgent(mesh, role) {
  return {
    mesh, role, x: 0, z: 0, heading: 0, navHeading: 0, speed: 0, turn: 0, choice: 0, decisionT: 0,
    targetX: 0, targetZ: 0, safeX: 0, safeZ: 0, active: false, backing: false, shx: 0, shz: 0, groundT: 0,
  };
}

export class WorldIncidents {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, game, audio, environment, currents, regions, radio, law, reputation, condition, encounters
    this.next = 95 + Math.random() * 75; this.active = null; this.enabled = false;
    this.interact = false; this.alternate = false; this.prompting = false; this.hitCd = 0;
    this.obs = []; this.phys.addObs('world-incidents', this.obs);
    this.rigs = this.makeRigs(); this.agents = [this.rigs.patrol.agent, this.rigs.runner.agent, this.rigs.victim.agent];
    this.patrolObs = this.makeBoatObstacle(this.rigs.patrol.agent, 'FWC patrol');
    this.runnerObs = this.makeBoatObstacle(this.rigs.runner.agent, 'runner');
    this.victimObs = this.makeBoatObstacle(this.rigs.victim.agent, 'work skiff');
    this.kayakObs = { x: 0, z: 0, r: 0.75, tag: 'kayak', onHit: (into, nx, nz) => {
      const e = this.active; if (!e || e.type !== 'search') return;
      e.kickX += -nx * into * 0.36; e.kickZ += -nz * into * 0.36;
      if (this.hitCd <= 0 && into > 2.2) { this.hitCd = 4; this.game.toast('Easy!', 'The injured paddler is still in that kayak.', 2.3); }
    } };
    this._f = new THREE.Vector2(); this._flow = new THREE.Vector2();
    this.obLevel = 0; this.obPitch = 1.12;
    this.stats = this.game.save.incidents || { heard: 0, resolved: 0, fwc: 0, runners: 0, searches: 0, missed: 0 };
    this.game.save.incidents = this.stats;
    this.keyHandler = e => {
      if (e.repeat || !this.enabled || this.game.paused) return;
      if (e.code === 'KeyE') this.interact = true;
      if (e.code === 'KeyF') this.alternate = true;
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  makeRigs() {
    const patrolBoat = buildSkiff({ crew: true }); recolor(patrolBoat, 0x2d5c4b); patrolBoat.visible = false; this.scene.add(patrolBoat);
    const blue = signalLight(patrolBoat, 0x267cff, -0.27, 1.35, -0.18), red = signalLight(patrolBoat, 0xff2f25, 0.27, 1.35, -0.18);
    const search = new THREE.SpotLight(0xe8f2df, 0, 105, 0.29, 0.65, 1.5); search.position.set(0, 1.45, -0.65);
    const searchTarget = new THREE.Object3D(); searchTarget.position.set(0, 0.1, -34); search.target = searchTarget; patrolBoat.add(search, searchTarget);

    const runnerBoat = buildSkiff({ crew: true }); recolor(runnerBoat, 0x4b3527); runnerBoat.visible = false; this.scene.add(runnerBoat);
    const victimBoat = buildSkiff({ crew: true, driverModel: false }); recolor(victimBoat, 0x587080); victimBoat.visible = false; this.scene.add(victimBoat);
    const paddler = kayak(); paddler.visible = false; this.scene.add(paddler);
    const kayakStrobe = signalLight(paddler, 0xff6b28, 0, 1.22, 0.25);

    const patrol = { boat: patrolBoat, blue, red, search, agent: makeAgent(patrolBoat, 'patrol') };
    const runner = { boat: runnerBoat, agent: makeAgent(runnerBoat, 'runner') };
    const victim = { boat: victimBoat, agent: makeAgent(victimBoat, 'victim') };
    return { patrol, runner, victim, paddler, kayakStrobe };
  }

  spot(nearby = false) {
    const p = this.phys, min = nearby ? 80 : 290, max = nearby ? 125 : 520;
    for (let k = 0; k < 100; k++) {
      const a = p.heading + (Math.random() - 0.5) * Math.PI * 1.75;
      const r = min + Math.random() * (max - min), x = p.pos.x - Math.sin(a) * r, z = p.pos.y - Math.cos(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 650 || this.world.blockedAt(x, z)) continue;
      if (this.game.jobs?.some(j => Math.hypot(j.x - x, j.z - z) < 110)) continue;
      if (!nearby && Math.hypot(this.game.startX - x, this.game.startZ - z) < 220) continue;
      const base = this.terrain.hf.computeBase(x, z); if (base.h > -1.15 || base.h < -5.2 || base.s < 0.42) continue;
      if (-this.terrain.heightAt(x, z) < 0.65) continue;
      let heading = 0, best = -1e9;
      for (let i = 0; i < 16; i++) {
        const h = i / 16 * Math.PI * 2;
        const sh = Math.sin(h), ch = Math.cos(h);
        const d1 = -this.terrain.heightAt(x - sh * 34, z - ch * 34), d2 = -this.terrain.heightAt(x - sh * 72, z - ch * 72);
        const b1x = x + sh * 38, b1z = z + ch * 38, b2x = x + sh * 115, b2z = z + ch * 115;
        const b1 = -this.terrain.heightAt(b1x, b1z), b2 = -this.terrain.heightAt(b2x, b2z);
        if (Math.min(d1, d2, b1, b2) < 0.55 || this.world.blockedAt(b1x, b1z) || this.world.blockedAt(b2x, b2z)) continue;
        const score = Math.min(4.5, d1) + Math.min(4.5, d2) * 0.72 + Math.min(3, b1) * 0.18 + Math.min(3, b2) * 0.12;
        if (score > best) { best = score; heading = h; }
      }
      if (best < 2.5) continue;
      return { x, z, heading };
    }
    return null;
  }

  setAgent(A, x, z, heading, speed = 0) {
    Object.assign(A, { x, z, heading, navHeading: heading, speed, turn: 0, choice: 0, decisionT: 0, active: true, backing: false, safeX: x, safeZ: z, shx: 0, shz: 0, groundT: 0 });
    A.mesh.position.set(x, this.water.waveHeight(x, z, 0) - 0.05, z); A.mesh.rotation.y = heading; A.mesh.visible = true;
  }

  pickType() {
    const storm = this.environment.values.storm, night = this.environment.hour < 5.5 || this.environment.hour > 20.5;
    const local = this.regions.current ? this.regions.current.encounters : {};
    const search = 0.32 + storm * 0.35 + (night ? 0.18 : 0);
    const pursuit = 0.52 * (local.law || 1) * (local.runners || 1) * (1 - storm * 0.72);
    const shakedown = 0.34 * (local.runners || 1) * (night ? 1.15 : 1) * (1 - storm * 0.35);
    const roll = Math.random() * (search + pursuit + shakedown);
    return roll < search ? 'search' : roll < search + pursuit ? 'pursuit' : 'shakedown';
  }

  start(type = this.pickType(), nearby = false) {
    if (this.active || this.game.state || this.encounters.active || this.environment.values.storm > 0.94) return false;
    const at = this.spot(nearby); if (!at) { this.next = 25; return false; }
    if (type === 'pursuit') this.startPursuit(at); else if (type === 'search') this.startSearch(at); else this.startShakedown(at);
    this.stats.heard = (this.stats.heard || 0) + 1; this.game.persist();
    return true;
  }

  startPursuit(at) {
    const fx = -Math.sin(at.heading), fz = -Math.cos(at.heading);
    const runner = this.rigs.runner.agent, patrol = this.rigs.patrol.agent;
    this.rigs.victim.boat.visible = false; this.rigs.victim.agent.active = false;
    if (this.rigs.runner.boat.userData.fuel) this.rigs.runner.boat.userData.fuel.visible = true;
    this.setAgent(runner, at.x, at.z, at.heading, 8.8);
    this.setAgent(patrol, at.x - fx * 38, at.z - fz * 38, at.heading, 9.2);
    this.rigs.paddler.visible = false; this.rigs.patrol.search.intensity = 0;
    const region = regionAt(at.x, at.z);
    this.active = {
      type: 'pursuit', state: 'running', x: at.x, z: at.z, region, t: 0, life: 62 + Math.random() * 26,
      originX: at.x, originZ: at.z,
      choice: '', choiceT: 0, misdirectT: 0, falseX: 0, falseZ: 0, catchT: 0, seen: false, resolved: '', resolveT: 0,
    };
    this.radio.transmit({ channel: 'FWC TAC', speaker: 'FWC DISPATCH', text: `Twenty-seven is chasing a dark johnboat through ${region.name}. Small craft hold the bends.`, priority: 2, key: `incident:pursuit:${Math.floor(this.radio.clock)}`, cooldown: 0 });
  }

  startSearch(at) {
    const patrol = this.rigs.patrol.agent, fx = -Math.sin(at.heading), fz = -Math.cos(at.heading);
    this.rigs.victim.boat.visible = false; this.rigs.victim.agent.active = false;
    this.rigs.runner.boat.visible = false; this.rigs.runner.agent.active = false;
    if (this.rigs.runner.boat.userData.fuel) this.rigs.runner.boat.userData.fuel.visible = true;
    this.setAgent(patrol, at.x - fx * 115, at.z - fz * 115, at.heading, 5.8);
    const k = this.rigs.paddler; k.visible = true; k.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.04, at.z); k.rotation.y = at.heading + 0.35;
    const region = regionAt(at.x, at.z);
    this.active = {
      type: 'search', state: 'searching', x: at.x, z: at.z, originX: at.x, originZ: at.z, heading: at.heading, region,
      t: 0, life: 105 + Math.random() * 35, ph: Math.random() * 6.28, seen: false, reported: false, reportT: 0,
      resolved: '', resolveT: 0, kickX: 0, kickZ: 0,
    };
    this.radio.transmit({ channel: 'CH 16', speaker: 'MARA KEENE · TOWER', text: `Injured paddler overdue in ${region.name}. FWC has the last position. Orange kayak, one person aboard.`, priority: 3, key: `incident:search:${Math.floor(this.radio.clock)}`, cooldown: 0 });
  }

  startShakedown(at) {
    const fx = -Math.sin(at.heading), fz = -Math.cos(at.heading), victim = this.rigs.victim.agent, runner = this.rigs.runner.agent;
    this.setAgent(victim, at.x, at.z, at.heading, 0.8);
    this.setAgent(runner, at.x - fx * 26, at.z - fz * 26, at.heading, 4.6);
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false; this.rigs.patrol.search.intensity = 0;
    this.rigs.paddler.visible = false;
    if (this.rigs.victim.boat.userData.fuel) this.rigs.victim.boat.userData.fuel.visible = true;
    if (this.rigs.runner.boat.userData.fuel) this.rigs.runner.boat.userData.fuel.visible = false;
    const region = regionAt(at.x, at.z);
    this.active = {
      type: 'shakedown', state: 'threat', x: at.x, z: at.z, heading: at.heading, region, t: 0, life: 72 + Math.random() * 14,
      originX: at.x, originZ: at.z, patrolX: at.x - fx * 115, patrolZ: at.z - fz * 115,
      escapeX: at.x + fx * 1500, escapeZ: at.z + fz * 1500, victimX: at.x + fx * 130, victimZ: at.z + fz * 130,
      choice: '', choiceT: 0, seen: false, cargoTaken: false, pressure: 0, bumpCd: 1.5, contactCd: 0,
      hostileT: 0, reportT: 0, escapeT: 0, captureT: 0, victimHit: false, resolved: '', resolveT: 0,
    };
    this.radio.transmit({ channel: 'CH 16', speaker: 'WORK SKIFF', text: `Mayday. Black johnboat has us pinned in ${region.name}. They are taking the fuel cans. Any boat close, answer now.`, priority: 4, key: `incident:shakedown:${Math.floor(this.radio.clock)}`, cooldown: 0 });
  }

  updateAgent(A, dt, t, tx, tz, maxSpeed, holdRadius = 0, avoid = null, avoidPlayer = true) {
    if (!A.active) return;
    const depthHere = this.water.level - this.terrain.heightAt(A.x, A.z);
    if (!A.backing && depthHere > 0.58) { A.safeX = A.x; A.safeZ = A.z; }
    if (depthHere < 0.38) A.backing = true;
    else if (A.backing && depthHere > 0.52) { A.backing = false; A.safeX = A.x; A.safeZ = A.z; }
    A.decisionT -= dt;
    if (A.decisionT <= 0) {
      A.decisionT = 0.11; A.targetX = tx; A.targetZ = tz;
      const direct = Math.atan2(-(tx - A.x), -(tz - A.z)), probes = depthHere < 0.36 ? RECOVERY_PROBES : PROBES;
      let best = 0, bestScore = -1e9, bestSafe = false;
      for (const da of probes) {
        const h = A.heading + da, sh = Math.sin(h), ch = Math.cos(h);
        const x0 = A.x - sh * 12, z0 = A.z - ch * 12, x1 = A.x - sh * 28, z1 = A.z - ch * 28, x2 = A.x - sh * 58, z2 = A.z - ch * 58;
        const d0 = this.water.level - this.terrain.heightAt(x0, z0), d1 = this.water.level - this.terrain.heightAt(x1, z1), d2 = this.water.level - this.terrain.heightAt(x2, z2);
        const align = Math.cos(Math.atan2(Math.sin(h - direct), Math.cos(h - direct)));
        const blocked = this.world.blockedAt(x1, z1) || this.world.blockedAt(x2, z2);
        let score = Math.min(2.5, d0) * 1.45 + Math.min(4, d1) + Math.min(4, d2) * 0.58 + align * 1.35 - Math.abs(da) * 0.08;
        if (avoidPlayer) { const pd = Math.hypot(x1 - this.phys.pos.x, z1 - this.phys.pos.y); if (pd < 18) score -= (18 - pd) * 0.42; }
        if (avoid && avoid.active) { const ad = Math.hypot(x1 - avoid.x, z1 - avoid.z); if (ad < 13) score -= (13 - ad) * 0.55; }
        if (d0 < 0.38) score -= 28; if (d1 < 0.42) score -= 18; if (d2 < 0.35) score -= 7; if (blocked) score -= 32;
        if (score > bestScore) { bestScore = score; best = da; bestSafe = !blocked && d0 > 0.38 && d1 > 0.42; }
      }
      A.choice = best; A.navHeading = A.heading + best; A.safe = bestSafe;
    }
    const dh = Math.atan2(Math.sin(A.navHeading - A.heading), Math.cos(A.navHeading - A.heading));
    const turn = clamp(dh * 2.15, -1.4, 1.4), d = Math.hypot(A.targetX - A.x, A.targetZ - A.z);
    let want = maxSpeed * (holdRadius && d < holdRadius ? clamp(d / holdRadius, 0.05, 1) : 1) * (1 - Math.min(0.38, Math.abs(dh) * 0.2));
    if (!A.safe) want *= 0.22;
    if (depthHere < 0.45) want = Math.min(want, depthHere < 0.18 ? 0.2 : 1.25);
    if (A.backing) want = Math.min(want, 0.35);
    A.turn += (turn - A.turn) * (1 - Math.exp(-dt * 4)); A.heading += A.turn * dt;
    A.speed += (want - A.speed) * (1 - Math.exp(-dt * (want > A.speed ? 0.72 : 2.5)));
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), flow = this.currents ? this.currents.flowAt(A.x, A.z, this._flow) : null;
    let vx = fx * A.speed, vz = fz * A.speed;
    if (A.backing) { const sd = Math.hypot(A.safeX - A.x, A.safeZ - A.z); if (sd > 0.05) { const reverse = Math.min(1.8, 0.55 + sd * 0.2); vx = (A.safeX - A.x) / sd * reverse; vz = (A.safeZ - A.z) / sd * reverse; } }
    A.x += (vx + (flow ? flow.x : 0) + A.shx) * dt; A.z += (vz + (flow ? flow.y : 0) + A.shz) * dt;
    const decay = Math.exp(-dt * 2.4); A.shx *= decay; A.shz *= decay;
    A.x = clamp(A.x, -WORLD_HALF + 80, WORLD_HALF - 80); A.z = clamp(A.z, -WORLD_HALF + 80, WORLD_HALF - 80);
    const clearance = this.water.level - this.terrain.heightAt(A.x, A.z); A.groundT = clearance < 0.28 ? A.groundT + dt : 0;
    if (A.groundT > 0) A.speed *= Math.exp(-dt * 1.8);
    const y = this.water.waveHeight(A.x, A.z, t);
    A.mesh.position.set(A.x, y - 0.05, A.z); A.mesh.rotation.set(A.speed * 0.005, A.heading, -A.turn * A.speed * 0.018, 'YXZ');
    if (A.mesh.userData.motor) { A.mesh.userData.motor.rotation.y = -A.turn * 0.35; A.mesh.userData.motor.userData.prop.rotation.z += dt * (6 + A.speed * 5); }
  }

  updateLights(t, search = false) {
    const blink = Math.floor(t * (search ? 2.4 : 5.4)) % 2;
    this.rigs.patrol.blue.light.intensity = blink ? 90 : 4; this.rigs.patrol.red.light.intensity = blink ? 4 : (search ? 18 : 90);
    const h = this.environment.hour, night = h < 6.2 || h > 19.2;
    this.rigs.patrol.search.intensity = search && night ? 620 : 0;
  }

  setPrompt(html) { this.game.el.prompt.innerHTML = html; this.game.el.prompt.classList.add('on'); this.prompting = true; }
  clearPrompt() { if (this.prompting) this.game.el.prompt.classList.remove('on'); this.prompting = false; }
  canInteract() {
    return !this.game.state && !this.game.paused && !this.encounters.active && !this.game.dockCamp && !this.game.dockJob && !this.game.atBoard && !this.condition.serviceHere;
  }

  choosePursuit(side) {
    const e = this.active; if (!e || e.type !== 'pursuit' || e.choice) return;
    e.choice = side; e.choiceT = e.t; this.clearPrompt();
    if (side === 'fwc') {
      e.life = Math.min(e.life, 34); this.reputation.change('fwc', 0.75, 'runner-heading', 'You relayed a fleeing boat’s heading to FWC.', true);
      this.reputation.change('runners', -0.75, 'runner-heading', 'The backchannel heard who called the runner’s turn.', false);
      this.radio.transmit({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: 'Tower Boat, copy the heading. Stay out of the wake and let us come through.', priority: 3, key: `incident:heading:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      this.game.toast('Heading relayed', 'Twenty-seven is cutting the next bend.', 2.8);
    } else {
      e.life = Math.min(e.life, 30); e.misdirectT = 14;
      const h = this.rigs.patrol.agent.heading + Math.PI * (Math.random() < 0.5 ? 0.6 : -0.6);
      e.falseX = this.rigs.patrol.agent.x - Math.sin(h) * 260; e.falseZ = this.rigs.patrol.agent.z - Math.cos(h) * 260;
      this.reputation.change('runners', 0.9, 'false-cut', 'You sent an FWC boat into the wrong cut.', true);
      this.reputation.change('fwc', -0.9, 'false-cut', 'FWC logged the false traffic from your radio.', false);
      this.law.add(0.7, 'false position relayed to patrol', false);
      this.radio.transmit({ channel: 'CH 72', speaker: 'CAL ROOK · LOST KEY', text: 'Wrong cut received. Keep moving and do not answer that channel again.', priority: 3, key: `incident:false-cut:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      this.game.toast('False cut sent', 'Twenty-seven turned off the runner’s wake.', 2.8);
    }
  }

  resolvePursuit(outcome) {
    const e = this.active; if (!e || e.resolved) return;
    e.resolved = outcome; e.resolveT = 4.5; e.state = 'resolved'; this.clearPrompt();
    this.stats.resolved = (this.stats.resolved || 0) + 1;
    if (e.choice === 'fwc') this.stats.fwc = (this.stats.fwc || 0) + 1;
    if (e.choice === 'runners') this.stats.runners = (this.stats.runners || 0) + 1;
    this.game.persist();
    if (outcome === 'caught') {
      this.rigs.runner.agent.speed *= 0.15;
      this.radio.transmit({ channel: 'FWC TAC', speaker: 'FWC DISPATCH', text: e.choice === 'fwc' ? 'Twenty-seven has the johnboat stopped. Tower Boat’s heading was good.' : 'Twenty-seven has one stopped in the backcountry. Resume normal traffic.', priority: 2, key: `incident:caught:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      if (e.choice) this.game.bountyToast(`FWC pursuit resolved <b>${e.choice === 'fwc' ? 'heading confirmed' : 'runner stopped'}</b>`);
    } else {
      this.radio.transmit({ channel: e.choice === 'runners' ? 'CH 72' : 'FWC TAC', speaker: e.choice === 'runners' ? 'CAL ROOK · LOST KEY' : 'FWC DISPATCH', text: e.choice === 'runners' ? 'That wrong turn bought enough water. The runner is clear.' : 'Twenty-seven lost visual in the cuts. Units return to patrol.', priority: 2, key: `incident:escaped:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      if (e.choice) this.game.bountyToast(`Backcountry pursuit <b>${e.choice === 'runners' ? 'runner clear' : 'visual lost'}</b>`);
    }
  }

  updatePursuit(e, dt, t) {
    const runner = this.rigs.runner.agent, patrol = this.rigs.patrol.agent;
    if (e.resolved) {
      e.resolveT -= dt;
      this.updateAgent(runner, dt, t, runner.x - Math.sin(runner.heading) * 100, runner.z - Math.cos(runner.heading) * 100, e.resolved === 'escaped' ? 10 : 0.2, 0, patrol);
      this.updateAgent(patrol, dt, t, runner.x, runner.z, e.resolved === 'caught' ? 1.4 : 6, e.resolved === 'caught' ? 12 : 0, runner);
      if (e.resolveT <= 0) this.finish(); return;
    }
    e.life -= dt; e.misdirectT = Math.max(0, e.misdirectT - dt);
    const runMax = e.choice === 'runners' ? 13.4 : 11.7;
    this.updateAgent(runner, dt, t, runner.x - Math.sin(runner.heading) * 320, runner.z - Math.cos(runner.heading) * 320, runMax, 0, patrol);
    const tx = e.misdirectT > 0 ? e.falseX : runner.x, tz = e.misdirectT > 0 ? e.falseZ : runner.z;
    const patrolMax = e.choice === 'fwc' ? 14.1 : e.misdirectT > 0 ? 6.2 : 12.6;
    this.updateAgent(patrol, dt, t, tx, tz, patrolMax, e.misdirectT > 0 ? 0 : 8, runner);
    this.updateLights(t, false);
    e.x = runner.x; e.z = runner.z;
    const chaseGap = Math.hypot(runner.x - patrol.x, runner.z - patrol.z), d = Math.min(Math.hypot(runner.x - this.phys.pos.x, runner.z - this.phys.pos.y), Math.hypot(patrol.x - this.phys.pos.x, patrol.z - this.phys.pos.y));
    if (d < 210 && !e.seen) e.seen = true;
    if (!e.choice && d < 135 && this.canInteract()) {
      this.setPrompt('<b>E</b> report the runner’s heading <i>· F send FWC into the wrong cut</i>');
      if (this.interact) this.choosePursuit('fwc'); else if (this.alternate) this.choosePursuit('runners');
    } else this.clearPrompt();
    if (chaseGap < 10) e.catchT += dt; else e.catchT = Math.max(0, e.catchT - dt * 0.5);
    if (e.choice === 'fwc' && e.t - e.choiceT > 15) this.resolvePursuit('caught');
    else if (e.choice === 'runners' && e.t - e.choiceT > 13) this.resolvePursuit('escaped');
    else if (e.catchT > 3.5) this.resolvePursuit('caught');
    else if (e.life <= 0 || Math.hypot(runner.x - e.originX, runner.z - e.originZ) > 1400) this.resolvePursuit(chaseGap < 28 ? 'caught' : 'escaped');
  }

  transferShakedownCargo(e) {
    if (!e || e.cargoTaken) return false;
    e.cargoTaken = true;
    if (this.rigs.victim.boat.userData.fuel) this.rigs.victim.boat.userData.fuel.visible = false;
    if (this.rigs.runner.boat.userData.fuel) this.rigs.runner.boat.userData.fuel.visible = true;
    return true;
  }

  chooseShakedown(side) {
    const e = this.active; if (!e || e.type !== 'shakedown' || e.choice || e.resolved) return false;
    e.choice = side; e.choiceT = e.t; this.clearPrompt();
    if (side === 'fwc') {
      e.state = 'reported'; e.reportT = 0; e.hostileT = 5.5;
      this.setAgent(this.rigs.patrol.agent, e.patrolX, e.patrolZ, e.heading, 5.8);
      this.radio.transmit({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: 'Position copied. Keep the work skiff clear. Twenty-seven is coming in from behind the black hull.', priority: 4, key: `incident:shakedown-report:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      this.game.toast('Position sent', 'The black johnboat heard the call and is turning on you.', 3);
    } else {
      this.transferShakedownCargo(e); e.state = 'escaping'; e.escapeT = 0;
      this.law.add(1.45, 'aided theft from a work skiff', true);
      this.radio.transmit({ channel: 'CH 72', speaker: 'BLACK JOHNBOAT', text: 'Tower hull is with us. Put both cans across and back away from the motor.', priority: 4, key: `incident:shakedown-aid:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      this.game.toast('Backed the johnboat', 'The work skiff is putting your hull description on sixteen.', 3);
    }
    return true;
  }

  driveOffShakedown(e, into = 0) {
    if (!e || e.type !== 'shakedown' || e.choice || e.resolved) return false;
    e.choice = 'locals'; e.choiceT = e.t; e.state = 'fleeing'; e.escapeT = 0; this.clearPrompt();
    this.rigs.runner.agent.speed *= clamp(1 - into * 0.025, 0.62, 0.86);
    this.audio.horn(0.24);
    this.radio.transmit({ channel: 'CH 16', speaker: 'WORK SKIFF', text: 'Black hull is breaking off. Tower Boat, keep them moving and leave us room to restart.', priority: 3, key: `incident:shakedown-driven:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    this.game.toast('Johnboat driven off', 'They lost the fuel cans and are running for open water.', 2.8);
    return true;
  }

  resolveShakedown(outcome) {
    const e = this.active; if (!e || e.type !== 'shakedown' || e.resolved) return false;
    e.resolved = outcome; e.state = 'resolved'; e.resolveT = 5; this.clearPrompt();
    if (outcome !== 'missed') this.stats.resolved = (this.stats.resolved || 0) + 1;
    if (outcome === 'captured') {
      this.stats.fwc = (this.stats.fwc || 0) + 1;
      this.reputation.change('fwc', 0.95, 'fuel-theft-report', 'Your moving position put FWC onto a fuel theft in progress.', true);
      this.reputation.change('locals', 0.7, 'work-skiff-help', 'You kept a work skiff’s fuel aboard and brought the patrol in.', false);
      this.reputation.change('runners', -0.75, 'fuel-theft-report', 'The backchannel heard who held the black johnboat for twenty-seven.', false);
      this.game.addCash(150); this.game.bountyToast('FWC theft assist <b>+$150</b>');
      this.radio.transmit({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: 'Twenty-seven alongside the black johnboat. Fuel cans are still on the work skiff. Tower Boat can clear.', priority: 3, key: `incident:shakedown-captured:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    } else if (outcome === 'driven-off') {
      this.stats.locals = (this.stats.locals || 0) + 1;
      this.reputation.change('locals', 0.85, 'work-skiff-defended', 'You put your hull between a work skiff and the crew taking its fuel.', true);
      this.reputation.change('fwc', 0.2, 'fuel-theft-broken-up', 'A work skiff reported that the tower boat broke up a fuel theft.', false);
      this.reputation.change('runners', -0.65, 'johnboat-driven-off', 'The black johnboat crew remembers who hit their hull.', false);
      this.game.bountyToast('Work skiff clear');
      this.radio.transmit({ channel: 'CH 68', speaker: 'WORK SKIFF', text: 'Motor caught. Both cans are aboard. Tower Boat, we are clear of the cut.', priority: 2, key: `incident:shakedown-clear:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    } else if (outcome === 'aided') {
      this.stats.runners = (this.stats.runners || 0) + 1;
      this.reputation.change('runners', 1.05, 'fuel-theft-aided', 'The black johnboat paid the hull that made the work skiff stand down.', true);
      this.reputation.change('locals', -1.1, 'fuel-theft-aided', 'A work crew named your hull after its fuel was taken.', false);
      this.reputation.change('fwc', -0.65, 'fuel-theft-aided', 'The victim put the tower airboat on the theft report.', false);
      this.game.addCash(175); this.game.bountyToast('Backchannel cut <b>+$175</b>');
      this.radio.transmit({ channel: 'CH 16', speaker: 'WORK SKIFF', text: 'FWC, copy tower airboat aiding the black johnboat. They took both cans and are outbound.', priority: 4, key: `incident:shakedown-witness:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    } else {
      this.stats.missed = (this.stats.missed || 0) + 1; this.transferShakedownCargo(e);
      this.radio.transmit({ channel: 'CH 16', speaker: 'WORK SKIFF', text: 'Black johnboat is gone with both cans. We are disabled and drifting. Any tow near the call, answer sixteen.', priority: 3, key: `incident:shakedown-missed:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    }
    const memory = outcome === 'captured' ? 'fuel-theft-stopped' : outcome === 'driven-off' ? 'fuel-theft-driven-off' : outcome === 'aided' ? 'fuel-theft-aided' : 'fuel-theft-missed';
    this.encounters.remember(memory, e.region?.name || '', 'incident'); this.game.persist(); return true;
  }

  attemptShakedownRam(e, A, distance) {
    if (!e || e.state !== 'reported' || e.hostileT <= 0 || e.contactCd > 0 || distance >= 6.2 || A.speed <= 5) return false;
    const p = this.phys, dx = p.pos.x - A.x, dz = p.pos.y - A.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), closing = fx * nx + fz * nz; if (closing <= 0.28) return false;
    const cross = fx * nz - fz * nx, side = cross < 0 ? -1 : 1;
    e.contactCd = 3.2; A.speed *= 0.68; p.vel.x += nx * 1.65 + fx * 0.7; p.vel.y += nz * 1.65 + fz * 0.7;
    p.hit = Math.max(p.hit, 4.6); p.hitNormal.set(nx, nz); p.hitTag = 'boat'; p.angVel += side * 1.25; p.rollVel += side * 1.35;
    this.game.shake = Math.max(this.game.shake, 0.3); if (this.condition) this.condition.damage(0.34, 0.05); this.audio.thud(0.78);
    this.game.toast('Johnboat ram', 'They are trying to knock the tower hull off the radio call.', 2.5); return true;
  }

  updateShakedown(e, dt, t) {
    const runner = this.rigs.runner.agent, victim = this.rigs.victim.agent, patrol = this.rigs.patrol.agent;
    e.bumpCd = Math.max(0, e.bumpCd - dt); e.contactCd = Math.max(0, e.contactCd - dt);
    const victimSpeed = e.cargoTaken ? 0.18 : e.resolved ? 0.55 : 0.9;
    this.updateAgent(victim, dt, t, e.victimX, e.victimZ, victimSpeed, 10, runner);
    if (e.resolved) {
      const caught = e.resolved === 'captured';
      this.updateAgent(runner, dt, t, caught ? patrol.x : e.escapeX, caught ? patrol.z : e.escapeZ, caught ? 0.25 : 10.8, caught ? 7 : 0, patrol);
      if (patrol.active) { this.updateAgent(patrol, dt, t, runner.x, runner.z, caught ? 1.2 : 10.5, caught ? 8 : 0, runner); this.updateLights(t, false); }
      e.resolveT -= dt; e.x = victim.x; e.z = victim.z; if (e.resolveT <= 0) this.finish(); return;
    }

    e.life -= dt; const playerD = Math.min(Math.hypot(victim.x - this.phys.pos.x, victim.z - this.phys.pos.y), Math.hypot(runner.x - this.phys.pos.x, runner.z - this.phys.pos.y));
    if (playerD < 145) e.seen = true;
    if (e.state === 'threat') {
      const rightX = Math.cos(victim.heading), rightZ = -Math.sin(victim.heading), fx = -Math.sin(victim.heading), fz = -Math.cos(victim.heading), side = Math.sin(e.t * 0.46) * 4.2;
      this.updateAgent(runner, dt, t, victim.x + fx * 2.5 + rightX * side, victim.z + fz * 2.5 + rightZ * side, 7.4, 4.6, victim);
      const gap = Math.hypot(runner.x - victim.x, runner.z - victim.z);
      if (gap < 7.1 && e.bumpCd <= 0) {
        const dx = victim.x - runner.x, dz = victim.z - runner.z, d = Math.hypot(dx, dz) || 1;
        e.bumpCd = 5.4; e.pressure++; victim.shx += dx / d * 1.25; victim.shz += dz / d * 1.25; victim.speed *= 0.45;
        if (playerD < 115) { this.audio.thud(0.3); this.game.toast('Black hull on the work skiff', 'They are pushing it toward the bank.', 2.1); }
      }
      if (playerD < 34 && this.phys.speed * MPH < 30 && this.canInteract()) {
        this.setPrompt('<b>E</b> report the black johnboat <i>· F back its crew · ram it to drive them off</i>');
        if (this.interact) this.chooseShakedown('fwc'); else if (this.alternate) this.chooseShakedown('runners');
      } else this.clearPrompt();
      if (e.life <= 0 && !e.choice) {
        this.transferShakedownCargo(e); e.state = 'escaping'; e.escapeT = 0;
        this.radio.transmit({ channel: 'CH 16', speaker: 'WORK SKIFF', text: 'They have both cans. Black johnboat is breaking north; we are dead in the water.', priority: 4, key: `incident:shakedown-taken:${Math.floor(this.radio.clock)}`, cooldown: 0 });
      }
    } else if (e.state === 'reported') {
      e.reportT += dt; e.hostileT = Math.max(0, e.hostileT - dt);
      const hostile = e.hostileT > 0, tx = hostile ? this.phys.pos.x + this.phys.vel.x * 0.55 : e.escapeX, tz = hostile ? this.phys.pos.y + this.phys.vel.y * 0.55 : e.escapeZ;
      this.updateAgent(runner, dt, t, tx, tz, hostile ? 12.6 : 12.1, 0, patrol, !hostile);
      this.updateAgent(patrol, dt, t, runner.x, runner.z, 14.4, 7.5, runner); this.updateLights(t, false);
      const gap = Math.hypot(runner.x - patrol.x, runner.z - patrol.z), d = Math.hypot(runner.x - this.phys.pos.x, runner.z - this.phys.pos.y);
      this.attemptShakedownRam(e, runner, d); e.captureT = gap < 9 ? e.captureT + dt : Math.max(0, e.captureT - dt * 0.5);
      if ((e.reportT > 4 && e.captureT > 2.2) || e.reportT > 19) this.resolveShakedown('captured');
    } else {
      e.escapeT += dt; this.updateAgent(runner, dt, t, e.escapeX, e.escapeZ, 12.8, 0, victim);
      if (e.escapeT > (e.choice === 'locals' ? 7 : 6)) this.resolveShakedown(e.choice === 'locals' ? 'driven-off' : e.choice === 'runners' ? 'aided' : 'missed');
    }
    e.x = victim.x; e.z = victim.z;
  }

  reportPaddler() {
    const e = this.active; if (!e || e.type !== 'search' || e.reported) return;
    e.reported = true; e.reportT = 0; this.clearPrompt();
    this.radio.transmit({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: `Tower Boat, copy the orange kayak. Hold off the bow; we have your position.`, priority: 3, key: `incident:kayak-report:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    this.game.toast('Position relayed', 'Twenty-seven is coming onto the kayak.', 2.8);
  }

  resolveSearch(found) {
    const e = this.active; if (!e || e.resolved) return;
    e.resolved = found ? 'found' : 'missed'; e.resolveT = 4.5; e.state = 'resolved'; this.clearPrompt();
    if (found) {
      this.stats.resolved = (this.stats.resolved || 0) + 1; this.rigs.paddler.visible = false;
      if (e.reported) {
        this.stats.searches = (this.stats.searches || 0) + 1;
        this.reputation.change('locals', 0.75, 'paddler-found', 'You put FWC onto an injured paddler before the current carried him off.', true);
        this.reputation.change('fwc', 0.7, 'paddler-found', 'Your kayak position closed an FWC search.', false);
        this.game.addCash(125); this.game.bountyToast('FWC search assist <b>+$125</b>');
      }
      this.radio.transmit({ channel: 'CH 16', speaker: 'WARDEN SOTO · FWC 27', text: e.reported ? 'Paddler aboard. Good position, Tower Boat. We are taking him to the river dock.' : 'Paddler located and aboard twenty-seven. Search traffic can stand down.', priority: 2, key: `incident:paddler-found:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    } else {
      this.stats.missed = (this.stats.missed || 0) + 1;
      this.radio.transmit({ channel: 'CH 16', speaker: 'MARA KEENE · TOWER', text: 'Search is moving downcurrent. Orange kayak not located before dark water took the last position.', priority: 2, key: `incident:paddler-missed:${Math.floor(this.radio.clock)}`, cooldown: 0 });
    }
    this.game.persist();
  }

  updateSearch(e, dt, t) {
    const patrol = this.rigs.patrol.agent;
    if (e.resolved) {
      e.resolveT -= dt; this.updateAgent(patrol, dt, t, patrol.x - Math.sin(patrol.heading) * 80, patrol.z - Math.cos(patrol.heading) * 80, 3.5);
      this.updateLights(t, false); if (e.resolveT <= 0) this.finish(); return;
    }
    e.life -= dt;
    if (this.currents) { const f = this.currents.flowAt(e.x, e.z, this._flow); e.x += f.x * dt * 0.76; e.z += f.y * dt * 0.76; }
    e.x += e.kickX * dt; e.z += e.kickZ * dt; const decay = Math.exp(-dt * 1.3); e.kickX *= decay; e.kickZ *= decay;
    const k = this.rigs.paddler; k.position.set(e.x, this.water.waveHeight(e.x, e.z, t) - 0.04, e.z); k.rotation.z = Math.sin(t * 0.8 + e.ph) * 0.045; k.rotation.x = Math.cos(t * 0.55 + e.ph) * 0.025;
    if (k.userData.arm) k.userData.arm.rotation.z = -0.9 + Math.sin(t * 3.1) * 0.28;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5.5); this.rigs.kayakStrobe.light.intensity = 8 + pulse * 52; this.rigs.kayakStrobe.bulb.scale.setScalar(0.7 + pulse * 0.5);
    let tx, tz, max = 7.7;
    if (e.reported) { e.reportT += dt; tx = e.x; tz = e.z; max = 9.1; }
    else { const r = 38 + Math.min(125, e.t * 0.75), a = e.t * 0.17 + e.ph; tx = e.originX + Math.cos(a) * r; tz = e.originZ + Math.sin(a) * r; }
    this.updateAgent(patrol, dt, t, tx, tz, max, e.reported ? 9 : 0);
    this.updateLights(t, true);
    const pd = Math.hypot(e.x - patrol.x, e.z - patrol.z), d = Math.hypot(e.x - this.phys.pos.x, e.z - this.phys.pos.y);
    if (d < 125 && !e.seen) e.seen = true;
    if (!e.reported && d < 24 && this.phys.speed * MPH < 8 && this.canInteract()) {
      this.setPrompt('<b>E</b> radio the kayak’s position to FWC'); if (this.interact) this.reportPaddler();
    } else this.clearPrompt();
    if (pd < 14 && e.t > 10) this.resolveSearch(true);
    else if (e.reported && e.reportT > 24) this.resolveSearch(true);
    else if (e.life <= 0) this.resolveSearch(false);
  }

  makeBoatObstacle(A, tag) {
    return { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag, onHit: (into, nx, nz) => {
      A.shx += -nx * into * 0.48; A.shz += -nz * into * 0.48; A.speed *= 0.55;
      if (this.hitCd > 0 || into < 2.7) return; this.hitCd = 4;
      if (tag === 'FWC patrol') { this.game.toast('FWC vessel struck', 'Twenty-seven is logging the collision.', 2.4); this.law.violation(0.8, 'FWC vessel struck', true); }
      else if (tag === 'work skiff') {
        const e = this.active;
        this.game.toast('Work skiff struck', 'The crew is reporting the tower hull on sixteen.', 2.4);
        this.law.violation(0.45 + Math.min(0.45, into * 0.05), 'work skiff collision witnessed', true);
        if (e?.type === 'shakedown' && !e.victimHit) { e.victimHit = true; this.reputation.change('locals', -0.45, 'work-skiff-struck', 'The stranded crew reported that you hit their skiff during the theft.', false); }
      } else if (this.active?.type === 'shakedown') {
        if (!this.driveOffShakedown(this.active, into)) this.game.toast('Black johnboat hit', 'The crew is still trying to clear the cut.', 2.2);
      } else this.game.toast('Runner hit', 'The johnboat is still trying to clear the cut.', 2.2);
    } };
  }

  addObstacle(A, tag) {
    if (!A.active || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 75) return;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    const o = tag === 'FWC patrol' ? this.patrolObs : tag === 'work skiff' ? this.victimObs : this.runnerObs;
    o.ax = A.x + fx * 2.1; o.az = A.z + fz * 2.1; o.bx = A.x - fx * 2.1; o.bz = A.z - fz * 2.1;
    this.obs.push(o);
  }

  addKayakObstacle(e) {
    if (Math.hypot(e.x - this.phys.pos.x, e.z - this.phys.pos.y) > 65) return;
    this.kayakObs.x = e.x; this.kayakObs.z = e.z; this.obs.push(this.kayakObs);
  }

  pushMarkers() {
    const e = this.active; if (!e || this.game.state || e.resolved) return;
    if (e.type === 'pursuit') {
      const r = this.rigs.runner.agent, p = this.rigs.patrol.agent;
      emitMapMarker(this.game, r.x, r.z, 'hazard', '#e0554a', 0, true);
      emitMapMarker(this.game, p.x, p.z, 'boat', '#5aa7ff', p.heading);
    } else if (e.type === 'search') {
      const p = this.rigs.patrol.agent;
      emitMapMarker(this.game, e.x, e.z, 'hazard', '#f07a2e', 0, true);
      emitMapMarker(this.game, p.x, p.z, 'boat', '#5aa7ff', p.heading);
    } else {
      const v = this.rigs.victim.agent, r = this.rigs.runner.agent, p = this.rigs.patrol.agent;
      emitMapMarker(this.game, v.x, v.z, 'hazard', '#f07a2e', 0, true);
      emitMapMarker(this.game, r.x, r.z, 'boat', '#e0554a', r.heading);
      if (p.active) emitMapMarker(this.game, p.x, p.z, 'boat', '#5aa7ff', p.heading);
    }
  }

  marker() {
    const e = this.active; if (!e || e.resolved) return null;
    const label = e.type === 'pursuit' ? 'live FWC pursuit' : e.type === 'search' ? 'active paddler search' : 'work skiff mayday';
    return { x: e.x, z: e.z, color: e.type === 'pursuit' ? '#e0554a' : '#f07a2e', label };
  }

  updateAudio() {
    this.obLevel = 0; this.obPitch = 1.12;
    for (const A of this.agents) {
      if (!A.active) continue; const d = Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y);
      if (d < 150) this.obLevel = Math.max(this.obLevel, (0.25 + 0.75 * Math.min(1, A.speed / 12)) * (1 - d / 150));
    }
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.hitCd = Math.max(0, this.hitCd - dt); this.obs.length = 0;
    if (!enabled) { this.interact = false; this.alternate = false; this.clearPrompt(); this.updateAudio(); return; }
    if (!this.active) {
      if (!this.game.state && !this.encounters.active && this.environment.values.storm < 0.94) { this.next -= dt; if (this.next <= 0) this.start(); }
      this.interact = false; this.alternate = false; this.updateAudio(); return;
    }
    this.encounters.next = Math.max(this.encounters.next, 4);
    const e = this.active; e.t += dt;
    if (e.type === 'pursuit') {
      if (this.environment.values.storm > 0.96 && !e.resolved) this.resolvePursuit('escaped');
      this.updatePursuit(e, dt, t); this.addObstacle(this.rigs.runner.agent, 'runner'); this.addObstacle(this.rigs.patrol.agent, 'FWC patrol');
    } else if (e.type === 'search') {
      if (this.environment.values.storm > 0.98 && !e.resolved) this.resolveSearch(false);
      this.updateSearch(e, dt, t); this.addObstacle(this.rigs.patrol.agent, 'FWC patrol'); if (!e.resolved) this.addKayakObstacle(e);
    } else {
      if (this.environment.values.storm > 0.97 && !e.resolved) this.resolveShakedown('missed');
      this.updateShakedown(e, dt, t); this.addObstacle(this.rigs.runner.agent, 'runner'); this.addObstacle(this.rigs.victim.agent, 'work skiff'); if (this.rigs.patrol.agent.active) this.addObstacle(this.rigs.patrol.agent, 'FWC patrol');
    }
    this.pushMarkers(); this.updateAudio(); this.interact = false; this.alternate = false;
  }

  stamps(out) {
    for (const A of this.agents) {
      if (!A.active || A.backing || A.speed < 2 || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 90) continue;
      const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 11);
      emitWakeStamp(out, A.x - fx * 1.8, A.z - fz * 1.8, 1.1, 0.55 * sp, 1.7 * sp, 1);
      emitWakeStamp(out, A.x + fx * 1.8, A.z + fz * 1.8, 1, -0.68 * sp, 0.1 * sp, 0.7);
    }
  }

  finish() {
    this.clearPrompt(); this.obs.length = 0;
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false; this.rigs.patrol.blue.light.intensity = 0; this.rigs.patrol.red.light.intensity = 0; this.rigs.patrol.search.intensity = 0;
    this.rigs.runner.boat.visible = false; this.rigs.runner.agent.active = false; this.rigs.paddler.visible = false; this.rigs.kayakStrobe.light.intensity = 0;
    this.rigs.victim.boat.visible = false; this.rigs.victim.agent.active = false;
    if (this.rigs.victim.boat.userData.fuel) this.rigs.victim.boat.userData.fuel.visible = true;
    if (this.rigs.runner.boat.userData.fuel) this.rigs.runner.boat.userData.fuel.visible = true;
    this.active = null; this.next = 210 + Math.random() * 210; this.updateAudio();
  }
}
