import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { regionAt } from './regions.js';
import { emitWakeStamp } from './wakestamps.js';
import { emitMapMarker } from './mapmarkers.js';
import { sampleVesselWake } from './wakefield.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = v => Number.isFinite(v) ? v : NaN;

function recolor(group, color) {
  let done = false;
  group.traverse(o => {
    if (done || !o.isMesh || !o.material?.color || o.material.metalness < 0.45) return;
    o.material = o.material.clone(); o.material.color.setHex(color); done = true;
  });
}

function signal(parent, color) {
  const mast = new THREE.Group(); mast.position.set(0, 1.2, -0.12); parent.add(mast);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.035, 1.25, 7),
    new THREE.MeshStandardMaterial({ color: 0x555b57, roughness: 0.5, metalness: 0.72 }),
  );
  pole.position.y = 0.55; mast.add(pole);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), mat); bulb.position.y = 1.2; mast.add(bulb);
  const light = new THREE.PointLight(color, 0, 78, 2); light.position.y = 1.2; mast.add(light);
  return { mast, bulb, light, mat };
}

function emergencyPlant() {
  const g = new THREE.Group(); g.name = 'storm generator and fuel';
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x282d2b, roughness: 0.46, metalness: 0.68 });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xc5a43f, roughness: 0.68, metalness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151a18, roughness: 0.8, metalness: 0.24 });
  const red = new THREE.MeshStandardMaterial({ color: 0x9c2f25, roughness: 0.65, metalness: 0.12 });
  const frame = new THREE.Group(); frame.position.y = 0.34; g.add(frame);
  for (const y of [-0.26, 0.26]) for (const z of [-0.31, 0.31]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 1.04, 7), frameMat);
    rail.rotation.z = Math.PI / 2; rail.position.set(0, y, z); frame.add(rail);
  }
  for (const x of [-0.49, 0.49]) for (const z of [-0.31, 0.31]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.58, 7), frameMat);
    rail.position.set(x, 0, z); frame.add(rail);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.46, 0.52), caseMat); body.position.y = 0.34; g.add(body);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.025), dark); panel.position.set(0, 0.38, -0.273); g.add(panel);
  for (const x of [-0.17, 0, 0.17]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.02, 0.03), frameMat); vent.position.set(x, 0.42, -0.292); g.add(vent);
  }
  for (const x of [-0.7, 0.7]) {
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.52, 0.34), red); can.position.set(x, 0.28, 0.02); g.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), dark); cap.position.set(x, 0.57, 0.02); g.add(cap);
  }
  const cable = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 20, Math.PI * 1.65), dark);
  cable.rotation.x = Math.PI / 2; cable.position.set(0.49, 0.15, 0.34); g.add(cable);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return g;
}

function makeAgent(mesh, role) {
  return {
    mesh, role, x: 0, z: 0, heading: 0, navHeading: 0, speed: 0, turn: 0, choice: 0, decisionT: 0,
    targetX: 0, targetZ: 0, safeX: 0, safeZ: 0, active: false, backing: false, shx: 0, shz: 0,
    groundT: 0, safe: true,
  };
}

export class StormLine {
  constructor(parent) {
    this.P = parent;
    const saved = parent.state.stormLine || {};
    this.state = parent.state.stormLine = {
      stage: saved.stage || 'dormant', branch: saved.branch || '', ending: saved.ending || '',
      offerAt: Number(saved.offerAt) || 0, retryAt: Number(saved.retryAt) || 0,
      completedAt: Number(saved.completedAt) || 0, consequenceAt: Number(saved.consequenceAt) || 0,
      consequence: Boolean(saved.consequence), routeBand: Math.max(0, Math.min(3, Number(saved.routeBand) || 0)),
      weatherEscalated: Boolean(saved.weatherEscalated), chaseStarted: Boolean(saved.chaseStarted),
      chaseCleared: Boolean(saved.chaseCleared), chaseLife: Math.max(0, Number(saved.chaseLife) || 0),
      convoyX: finite(saved.convoyX), convoyZ: finite(saved.convoyZ), convoyHeading: finite(saved.convoyHeading),
      chaserX: finite(saved.chaserX), chaserZ: finite(saved.chaserZ), chaserHeading: finite(saved.chaserHeading),
      attempts: Math.max(0, Number(saved.attempts) || 0),
    };
    this.enabled = false; this.persistT = 4; this.chaseDelay = 0; this.chaseActive = false;
    this.captureT = 0; this.separationT = 0; this.lostT = 0; this.hitCd = 0; this.warnBand = 0;
    this._f = new THREE.Vector2(); this._r = new THREE.Vector2();
    this.convoy = makeAgent(this.convoyMesh(), 'convoy');
    this.chaser = makeAgent(this.chaserMesh(), 'chaser');
    this.agents = [this.convoy, this.chaser];
    this.rigs = this.makeRigs(); this.P.scene.add(this.rigs.result, this.rigs.generator);
    this.obs = []; this.P.phys.addObs('story-high-water', this.obs);
    this.convoyObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: 'storm convoy', onHit: (into, nx, nz) => this.convoyHit(into, nx, nz) };
    this.chaserObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: 'pursuing skiff', onHit: (into, nx, nz) => this.chaserHit(into, nx, nz) };
    this.resultObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: 'storm power skiff' };
    this.obLevel = 0; this.obPitch = 0.9;
    if (this.eligible() && !this.state.offerAt && this.state.stage === 'dormant') this.arm(90000);
    this.restore(); this.persist();
  }

  makeRigs() {
    const result = buildSkiff({ crew: false }); recolor(result, 0x536762); result.visible = false;
    const lamp = signal(result, 0xf4d989); const generator = emergencyPlant();
    return { result, lamp, generator };
  }

  persist() { this.P.persist(); }
  eligible() { return this.P.passage.state.stage === 'complete' && this.P.passage.state.consequence; }
  busy() { return this.state.stage === 'rendezvous' || this.state.stage === 'escort'; }
  owns(mesh) { return Boolean(mesh) && mesh === this.convoyMesh() && (this.busy() || (this.state.stage === 'complete' && !this.state.consequence)); }
  convoyMesh() { return this.state.branch === 'runner' ? this.P.rigs.lostKey : this.P.passage.rigs.aid; }
  chaserMesh() { return this.state.branch === 'runner' ? this.P.passage.rigs.patrol : this.P.passage.rigs.runner; }
  startPoint() { return this.state.branch === 'runner' ? this.P.state.coords.runner : this.P.passage.state.coords.aid; }
  destination() { return this.state.branch === 'runner' ? this.P.passage.state.coords.cache : this.P.state.coords.local; }

  resultPoint() {
    const d = this.destination(), side = 14;
    return { x: d.x - Math.cos(d.heading) * side, z: d.z + Math.sin(d.heading) * side, heading: d.heading };
  }

  arm(delay = 90000) {
    if (this.state.stage !== 'dormant' || this.state.offerAt) return;
    this.state.offerAt = Date.now() + delay; this.persist();
  }

  configure() {
    const runner = this.state.branch === 'runner', color = runner ? 0x4f8fff : 0xf4d989;
    this.rigs.lamp.mat.color.setHex(color); this.rigs.lamp.light.color.setHex(color);
    this.convoy.mesh = this.convoyMesh(); this.chaser.mesh = this.chaserMesh();
    this.convoyObs.tag = runner ? 'Cal Rook storm convoy' : 'Split Pine evacuation skiff';
    this.chaserObs.tag = runner ? 'FWC patrol' : 'runner skiff';
  }

  attachConvoyCargo(includeGenerator = true) {
    const runner = this.state.branch === 'runner', mesh = this.convoyMesh(), Q = this.P.passage;
    if (runner) {
      if (this.P.state.ending === 'runner') {
        mesh.add(this.P.rigs.case); this.P.rigs.case.position.set(0.54, 0.68, -0.9); this.P.rigs.case.rotation.set(0, 0.2, 0); this.P.rigs.case.visible = true;
      }
      mesh.add(Q.rigs.cooler); Q.rigs.cooler.position.set(-0.48, 0.7, -1.02); Q.rigs.cooler.rotation.set(0, -0.15, 0); Q.rigs.cooler.visible = true;
      Q.rigs.survivor.visible = false;
    } else {
      mesh.add(Q.rigs.cooler); Q.rigs.cooler.position.set(0.48, 0.7, -1); Q.rigs.cooler.rotation.set(0, -0.18, 0); Q.rigs.cooler.visible = true;
      mesh.add(Q.rigs.survivor); Q.rigs.survivor.position.set(-0.42, 0.56, -0.3); Q.rigs.survivor.rotation.set(0, 0.2, 0); Q.rigs.survivor.visible = true;
    }
    if (includeGenerator) {
      mesh.add(this.rigs.generator); this.rigs.generator.position.set(0, 0.68, 0.84); this.rigs.generator.rotation.set(0, runner ? -0.08 : 0.08, 0); this.rigs.generator.visible = true;
    }
  }

  dockGenerator() {
    this.rigs.result.add(this.rigs.generator); this.rigs.generator.position.set(0, 0.67, -0.72);
    this.rigs.generator.rotation.set(0, 0.12, 0); this.rigs.generator.visible = true;
  }

  hide() {
    this.rigs.result.visible = false; this.rigs.generator.visible = false;
    this.convoy.active = false; this.stopChaser(false, false); this.rigs.lamp.light.intensity = 0;
  }

  restore() {
    this.hide(); this.configure();
    const s = this.state.stage;
    if (s === 'rendezvous') {
      this.attachConvoyCargo(true); this.convoyMesh().visible = true;
      const p = this.startPoint(); this.P.placeBoat(this.convoyMesh(), p, 0);
    } else if (s === 'escort') {
      this.attachConvoyCargo(true); this.convoyMesh().visible = true;
      const p = this.startPoint(), x = Number.isFinite(this.state.convoyX) ? this.state.convoyX : p.x;
      const z = Number.isFinite(this.state.convoyZ) ? this.state.convoyZ : p.z;
      const h = Number.isFinite(this.state.convoyHeading) ? this.state.convoyHeading : p.heading;
      this.P.incidents.setAgent(this.convoy, x, z, h, 0);
      if (this.state.weatherEscalated) this.P.environment.setWeather('hurricane', true, false);
      else this.P.environment.setWeather('tropical', true, false);
      if (this.state.chaseStarted && !this.state.chaseCleared) this.chaseDelay = 2.5;
    } else if (s === 'complete') {
      this.dockGenerator(); this.rigs.result.visible = true;
      if (!this.state.consequence) {
        this.attachConvoyCargo(false); this.convoyMesh().visible = true;
        this.P.placeBoat(this.convoyMesh(), this.destination(), 0);
      }
    }
    if (s === 'rendezvous' || s === 'escort') this.rigs.result.visible = true;
  }

  offer(force = false) {
    if (!this.eligible() || !['dormant', 'failed'].includes(this.state.stage)) return false;
    if (!force && (Date.now() < this.state.offerAt || this.P.game.state || this.P.encounters.active || this.P.incidents.active)) return false;
    const branch = this.P.passage.state.ending === 'runner' ? 'runner' : 'rescue', start = branch === 'runner' ? this.P.state.coords.runner : this.P.passage.state.coords.aid;
    Object.assign(this.state, {
      stage: 'rendezvous', branch, ending: '', offerAt: 0, retryAt: 0, completedAt: 0, consequenceAt: 0,
      consequence: false, routeBand: 0, weatherEscalated: false, chaseStarted: false, chaseCleared: false,
      chaseLife: 0, convoyX: start.x, convoyZ: start.z, convoyHeading: start.heading,
      chaserX: NaN, chaserZ: NaN, chaserHeading: NaN, attempts: this.state.attempts + 1,
    });
    this.captureT = this.separationT = this.lostT = 0; this.warnBand = 0; this.configure(); this.restore();
    if (this.P.environment.key !== 'hurricane' && this.P.environment.key !== 'tropical') this.P.environment.setWeather('tropical', false, true);
    if (branch === 'runner') {
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Lost Key shed is taking water. The cold box and generator are on my work skiff. Meet me here and lead us to the mangrove cache before Soto closes the cut.', 4, 'high-water-offer-runner');
      this.P.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower Boat, stay clear of Lost Key traffic. Emergency orders do not make stolen clinic cargo lawful.', 3, 'high-water-soto-warning');
    } else {
      this.P.call('CH 68', 'JUNE BELL · SPLIT PINE', 'Split Pine dock is under. Nolan, the cold box and our generator are moving to Old Mill. The intake is full of grass. Meet the aid skiff and lead us through.', 4, 'high-water-offer-rescue');
      this.P.call('CH 16', 'MARA KEENE · TOWER', 'Hurricane bands are crossing the backcountry. Old Mill has the nearest high-water berth.', 3, 'high-water-mara-warning');
    }
    this.P.game.toast('High Water', branch === 'runner' ? 'Cal needs a lead boat out of Lost Key.' : 'June and Nolan are evacuating Split Pine.', 3.5);
    this.persist(); return true;
  }

  startEscort() {
    if (this.state.stage !== 'rendezvous') return;
    const p = this.startPoint(); this.state.stage = 'escort'; this.state.routeBand = 0;
    this.P.incidents.setAgent(this.convoy, p.x, p.z, p.heading, 0); this.attachConvoyCargo(true);
    Object.assign(this.state, { convoyX: p.x, convoyZ: p.z, convoyHeading: p.heading });
    this.P.clearPrompt();
    if (this.state.branch === 'runner') {
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'I will hold thirty yards off your stern. Keep speed through the bends. If you stop, that patrol will put a line on us.', 4, 'high-water-start-runner');
      this.P.game.toast('Cal is following', 'Keep his skiff moving and inside the lead line.', 3);
    } else {
      this.P.call('CH 68', 'JUNE BELL · SPLIT PINE', 'We are off the berth. Keep us in your wake and do not outrun the blue lamp.', 4, 'high-water-start-rescue');
      this.P.game.toast('Aid skiff underway', 'Lead June and Nolan to Old Mill.', 3);
    }
    this.persist();
  }

  escalateStorm() {
    if (this.state.weatherEscalated) return;
    this.state.weatherEscalated = true; this.P.environment.setWeather('hurricane', false, true);
    this.P.call('WX-3', 'MARINE WEATHER · KEY WEST', 'Hurricane core band entering the backcountry. Surge is over the low docks. Floating debris is crossing marked water.', 4, 'high-water-core-band');
    this.persist();
  }

  chaserStart() {
    const A = this.convoy, fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), rx = -Math.cos(A.heading), rz = Math.sin(A.heading);
    for (const behind of [78, 104, 132]) for (const side of [-32, 32, 0]) {
      const x = A.x - fx * behind + rx * side, z = A.z - fz * behind + rz * side;
      const depth = this.P.water.level - this.P.terrain.heightAt(x, z);
      if (depth > 0.72 && depth < 6.5 && !this.P.world.blockedAt(x, z)) return { x, z, heading: A.heading };
    }
    return null;
  }

  spawnChaser(restoring = false) {
    if (this.chaseActive || this.state.stage !== 'escort') return false;
    let at = null;
    if (restoring && Number.isFinite(this.state.chaserX) && Number.isFinite(this.state.chaserZ)) {
      at = { x: this.state.chaserX, z: this.state.chaserZ, heading: Number.isFinite(this.state.chaserHeading) ? this.state.chaserHeading : this.convoy.heading };
    } else at = this.chaserStart();
    if (!at) { this.chaseDelay = 2; return false; }
    this.chaser.mesh = this.chaserMesh(); this.P.incidents.setAgent(this.chaser, at.x, at.z, at.heading, 3.5);
    this.chaseActive = true; this.captureT = this.lostT = 0;
    if (restoring && this.state.branch === 'runner') {
      this.P.law.attention = Math.max(this.P.law.attention, 1.25);
      this.P.law.lastReason = 'aiding an evasive vessel'; this.P.law.setPursuit(true);
    }
    if (!restoring) {
      this.state.chaseStarted = true; this.state.chaseCleared = false; this.state.chaseLife = this.state.branch === 'runner' ? 44 : 40;
      if (this.state.branch === 'runner') { this.P.law.add(1.25, 'aiding an evasive vessel', true); this.P.law.setPursuit(true); }
      if (this.P.hazards && !this.P.hazards.spout.active) this.P.hazards.spawnSpout(false, false);
      if (this.state.branch === 'runner') this.P.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Cal Rook, Tower Boat: reduce speed and hold your line. Both vessels are directed to stop.', 4, 'high-water-patrol');
      else this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'June, put the generator in the water and turn north. Tower Boat, move away from her stern.', 4, 'high-water-runner');
    }
    this.persist(); return true;
  }

  stopChaser(markCleared = true, save = true) {
    this.chaseActive = false; this.chaser.active = false;
    const runner = this.P.passage.rigs.runner, patrol = this.P.passage.rigs.patrol;
    runner.visible = false; patrol.visible = false;
    this.P.passage.rigs.runnerLamp.light.intensity = 0;
    this.P.passage.rigs.blue.light.intensity = this.P.passage.rigs.red.light.intensity = 0;
    this.P.law.setPursuit(false); this.captureT = 0;
    if (markCleared) this.state.chaseCleared = true;
    if (save) this.persist();
  }

  chaserHit(into, nx, nz) {
    if (!this.chaseActive) return;
    this.chaser.shx += -nx * into * 0.52; this.chaser.shz += -nz * into * 0.52; this.chaser.speed *= 0.42;
    if (this.hitCd > 0 || into < 2.6) return;
    this.hitCd = 4; this.captureT = Math.max(0, this.captureT - 1.4);
    if (this.state.branch === 'runner') {
      this.P.game.toast('FWC hull struck', 'Soto is adding the collision to the stop.', 2.6);
      this.P.law.violation(0.75, 'FWC vessel struck', true);
    } else this.P.game.toast('Runner knocked off line', 'June has room to keep moving.', 2.5);
  }

  convoyHit(into, nx, nz) {
    if (!this.convoy.active) return;
    this.convoy.shx += -nx * into * 0.34; this.convoy.shz += -nz * into * 0.34; this.convoy.speed *= 0.68;
    if (this.hitCd <= 0 && into > 2.5) {
      this.hitCd = 3.5; this.P.game.toast('Convoy struck', this.state.branch === 'runner' ? 'Cal lost speed in the turn.' : 'Nolan is still aboard. Give June room.', 2.5);
    }
  }

  clearChase(reason = 'weather') {
    if (!this.chaseActive) return;
    const patrol = this.state.branch === 'runner'; this.stopChaser(true, false);
    if (patrol) {
      this.P.law.cool(0.45);
      this.P.call('FWC TAC', 'WARDEN SOTO · FWC 27', reason === 'berth' ? 'Twenty-seven cannot enter that pocket on this surge. Tower Boat remains on the call sheet.' : 'Twenty-seven lost both stern lights in the rain. Units hold the outer cuts.', 3, 'high-water-patrol-lost');
    } else this.P.call('CH 72', 'CAL ROOK · LOST KEY', reason === 'berth' ? 'Old Mill has too many hands on that dock. Keep the generator.' : 'I lost the blue lamp in the rain. This is not settled.', 3, 'high-water-runner-lost');
    this.persist();
  }

  updateChaser(dt, t) {
    if (!this.chaseActive) return;
    const A = this.chaser, C = this.convoy, patrol = this.state.branch === 'runner';
    this.P.incidents.updateAgent(A, dt, t, C.x + C.speed * -Math.sin(C.heading) * 0.35, C.z + C.speed * -Math.cos(C.heading) * 0.35, patrol ? 12.1 : 12.7, 7, C);
    const d = Math.hypot(A.x - C.x, A.z - C.z), playerGap = Math.hypot(C.x - this.P.phys.pos.x, C.z - this.P.phys.pos.y);
    if (d < 14 && C.speed * MPH < 13) this.captureT += dt; else this.captureT = Math.max(0, this.captureT - dt * 0.55);
    if (d > 335) this.lostT += dt; else this.lostT = Math.max(0, this.lostT - dt * 0.45);
    if (playerGap < 440) this.state.chaseLife = Math.max(0, this.state.chaseLife - dt);
    if (this.captureT > 4.4) {
      this.fail(patrol ? 'Soto boxed Cal against the mangroves and seized the storm load.' : 'Cal’s crew got a line on June’s generator.'); return;
    }
    if (this.state.chaseLife <= 0 || this.lostT > 7.5) { this.clearChase('weather'); return; }
    this.state.chaserX = A.x; this.state.chaserZ = A.z; this.state.chaserHeading = A.heading;
    emitMapMarker(this.P.game, A.x, A.z, 'hazard', patrol ? '#5b8fff' : '#e0523e', 0, d > 155);
  }

  updateRendezvous(t) {
    const p = this.startPoint(); this.P.placeBoat(this.convoyMesh(), p, t); this.placeResult(t);
    const d = Math.hypot(p.x - this.P.phys.pos.x, p.z - this.P.phys.pos.y);
    this.P.game.wpTarget = { x: p.x, z: p.z, label: this.state.branch === 'runner' ? 'Cal’s loaded skiff' : 'Split Pine aid skiff', color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', story: true };
    if (d < 13 && this.P.phys.speed * MPH < 6 && this.P.canInteract()) {
      this.P.setPrompt(`<b>E</b> lead ${this.state.branch === 'runner' ? 'Cal to the mangrove cache' : 'June and Nolan to Old Mill'}`);
      if (this.P.interact) this.startEscort();
    } else this.P.clearPrompt();
  }

  updateEscort(dt, t) {
    if (!this.convoy.active) {
      const p = this.startPoint(), x = Number.isFinite(this.state.convoyX) ? this.state.convoyX : p.x;
      const z = Number.isFinite(this.state.convoyZ) ? this.state.convoyZ : p.z;
      this.P.incidents.setAgent(this.convoy, x, z, Number.isFinite(this.state.convoyHeading) ? this.state.convoyHeading : p.heading, 0);
    }
    this.placeResult(t);
    const C = this.convoy, D = this.destination(), p = this.P.phys, playerDest = Math.hypot(D.x - p.pos.x, D.z - p.pos.y);
    let gap = Math.hypot(C.x - p.pos.x, C.z - p.pos.y), tx, tz;
    if (playerDest < 80 || Math.hypot(D.x - C.x, D.z - C.z) < 85) { tx = D.x; tz = D.z; }
    else if (gap > 225) { tx = p.pos.x; tz = p.pos.y; }
    else {
      const f = p.forward(this._f); tx = p.pos.x - f.x * 30; tz = p.pos.y - f.y * 30;
    }
    const max = this.state.branch === 'runner' ? 10.4 : 9.4;
    this.P.incidents.updateAgent(C, dt, t, tx, tz, max, playerDest < 80 ? 42 : 7, this.chaseActive ? this.chaser : null);
    gap = Math.hypot(C.x - p.pos.x, C.z - p.pos.y);
    const destD = Math.hypot(D.x - C.x, D.z - C.z), routeStart = Math.max(1, Math.hypot(D.x - this.startPoint().x, D.z - this.startPoint().z));
    const ratio = destD / routeStart;
    if (this.state.routeBand === 0 && ratio < 0.88) { this.state.routeBand = 1; this.escalateStorm(); }
    else if (this.state.routeBand === 1 && ratio < 0.68) { this.state.routeBand = 2; this.spawnChaser(false); this.persist(); }
    else if (this.state.routeBand === 2 && ratio < 0.3) {
      this.state.routeBand = 3; this.persist();
      this.P.call(this.state.branch === 'runner' ? 'CH 72' : 'CH 68', this.state.branch === 'runner' ? 'CAL ROOK · LOST KEY' : 'LEON DOSS · OLD MILL', this.state.branch === 'runner' ? 'Blue floodlight ahead. Put me against the dark side of the power skiff.' : 'Old Mill has the gold floodlight up. Bring June inside it and hold there.', 3, 'high-water-final-leg');
    }
    if (!this.chaseActive && this.state.routeBand >= 2 && !this.state.chaseCleared) {
      this.chaseDelay -= dt;
      if (this.chaseDelay <= 0 && gap < 440) this.spawnChaser(this.state.chaseStarted);
    }
    this.updateChaser(dt, t); if (this.state.stage !== 'escort') return;
    if (gap > 220) this.separationT += dt; else this.separationT = Math.max(0, this.separationT - dt * 0.7);
    if (this.separationT > 7 && this.warnBand < 1) {
      this.warnBand = 1; this.P.call(this.state.branch === 'runner' ? 'CH 72' : 'CH 68', this.state.branch === 'runner' ? 'CAL ROOK · LOST KEY' : 'JUNE BELL · SPLIT PINE', 'Tower Boat, you are out of my light. Ease back and pick us up.', 3, 'high-water-separated');
    }
    if (this.separationT > 28) { this.fail('The convoy lost the tower boat in the hurricane rain.'); return; }
    if (destD < 34 && this.chaseActive) this.clearChase('berth');
    this.P.game.wpTarget = { x: D.x, z: D.z, label: this.state.branch === 'runner' ? 'mangrove storm cache' : 'Old Mill storm berth', color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', story: true };
    if (destD < 22 && gap < 70 && C.speed * MPH < 11 && p.speed * MPH < 7 && this.P.canInteract()) {
      this.P.setPrompt(`<b>E</b> secure ${this.state.branch === 'runner' ? 'Cal’s storm load' : 'the evacuation skiff'}`);
      if (this.P.interact) this.finish();
    } else this.P.clearPrompt();
    Object.assign(this.state, { convoyX: C.x, convoyZ: C.z, convoyHeading: C.heading });
    this.persistT -= dt; if (this.persistT <= 0) { this.persistT = 4; this.persist(); }
  }

  finish() {
    if (this.state.stage !== 'escort') return;
    const branch = this.state.branch, D = this.destination(); this.stopChaser(true, false);
    this.convoy.active = false; this.P.placeBoat(this.convoyMesh(), D, 0); this.dockGenerator(); this.rigs.result.visible = true;
    Object.assign(this.state, {
      stage: 'complete', ending: branch, completedAt: Date.now(), consequenceAt: Date.now() + 55000,
      consequence: false, convoyX: D.x, convoyZ: D.z, convoyHeading: D.heading, chaseCleared: true,
    });
    this.P.clearPrompt(); this.P.game.wpTarget = null; this.P.law.setPursuit(false);
    if (branch === 'runner') {
      this.P.game.addCash(1450);
      this.P.reputation.change('runners', 2, 'high-water-cache', 'You kept Cal’s clinic cargo and generator ahead of the hurricane patrol.', true);
      this.P.reputation.change('locals', -1.2, 'high-water-cache', 'Old Mill heard the generator went into a hidden mangrove cache.', false);
      this.P.reputation.change('fwc', -0.75, 'high-water-cache', 'FWC lost the Lost Key convoy in hurricane traffic.', false);
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Power skiff is dry and the cold box never warmed. Fourteen fifty. Soto can wait for daylight.', 4, 'high-water-finish-runner');
      this.P.game.bountyToast('Storm cache supplied <b>+$1,450</b>');
    } else {
      this.P.game.addCash(900);
      this.P.reputation.change('locals', 2.1, 'high-water-refuge', 'You brought June, Nolan and emergency power into the Old Mill storm berth.', true);
      this.P.reputation.change('fwc', 0.55, 'high-water-refuge', 'The Split Pine evacuation reached a listed storm refuge.', false);
      this.P.reputation.change('runners', -0.9, 'high-water-refuge', 'Cal’s crew lost the generator in the hurricane rain.', false);
      this.P.call('CH 68', 'JUNE BELL · OLD MILL', 'Lines are fast. Nolan is inside and the cold box is on shore power. Nine hundred from the emergency fund.', 4, 'high-water-finish-rescue');
      this.P.game.bountyToast('Evacuation completed <b>+$900</b>');
    }
    this.P.audio.complete(); this.persist();
  }

  fail(reason) {
    if (this.state.stage !== 'escort') return;
    const patrol = this.state.branch === 'runner'; this.stopChaser(false, false); this.convoy.active = false;
    this.P.clearPrompt(); this.P.game.wpTarget = null; this.rigs.result.visible = false; this.rigs.generator.visible = false;
    if (patrol) this.P.law.cited();
    Object.assign(this.state, { stage: 'failed', retryAt: Date.now() + 30000, offerAt: Date.now() + 30000, chaseLife: 0 });
    this.P.call(patrol ? 'FWC TAC' : 'CH 72', patrol ? 'WARDEN SOTO · FWC 27' : 'CAL ROOK · LOST KEY', reason, 4, 'high-water-failed');
    this.P.game.toast('High Water failed', reason, 3.8); this.P.audio.fail(); this.persist();
  }

  departureCargo() {
    const Q = this.P.passage;
    if (this.state.branch !== 'runner') return [Q.rigs.cooler, Q.rigs.survivor];
    return this.P.state.ending === 'runner' ? [this.P.rigs.case, Q.rigs.cooler] : [Q.rigs.cooler];
  }

  triggerConsequence(force = false) {
    if (this.state.stage !== 'complete' || this.state.consequence || (!force && Date.now() < this.state.consequenceAt)) return false;
    this.state.consequence = true;
    this.P.startDeparture(this.convoyMesh(), this.destination(), this.departureCargo(), this.state.branch === 'runner' ? 0.82 : 0.9);
    if (this.P.environment.key === 'hurricane') this.P.environment.setWeather('tropical', false, false);
    if (this.state.branch === 'runner') this.P.call('CH 16', 'MARA KEENE · TOWER', 'Lost Key has power somewhere in the mangroves. Split Pine is running on lanterns. FWC will sort out the rest after the water falls.', 3, 'high-water-aftermath-runner');
    else this.P.call('CH 16', 'MARA KEENE · TOWER', 'Old Mill storm light is on and Split Pine’s people are accounted for. That berth stays on the chart.', 3, 'high-water-aftermath-rescue');
    this.persist(); return true;
  }

  permanentMarker() {
    if (this.state.stage !== 'complete') return null;
    const p = this.resultPoint(), runner = this.state.ending === 'runner';
    return { x: p.x, z: p.z, color: runner ? '#5b8fff' : '#f0d989', label: runner ? 'Lost Key storm cache' : 'Old Mill storm refuge', story: false };
  }

  marker() {
    const s = this.state.stage;
    if (s === 'rendezvous') { const p = this.startPoint(); return { x: p.x, z: p.z, color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', label: this.state.branch === 'runner' ? 'Cal’s loaded skiff' : 'Split Pine evacuation skiff', story: true }; }
    if (s === 'escort') { const d = this.destination(); return { x: d.x, z: d.z, color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', label: this.state.branch === 'runner' ? 'mangrove storm cache' : 'Old Mill storm berth', story: true }; }
    return this.permanentMarker();
  }

  hud() {
    if (!this.busy()) return null;
    if (this.state.stage === 'rendezvous') {
      const p = this.startPoint(); return { title: 'High Water', obj: this.state.branch === 'runner' ? 'Meet Cal’s loaded skiff' : 'Meet the Split Pine evacuation skiff', sub: `${regionAt(p.x, p.z).name} · come alongside under 6 mph` };
    }
    const C = this.convoy, gap = Math.hypot(C.x - this.P.phys.pos.x, C.z - this.P.phys.pos.y);
    const pressure = this.chaseActive ? ` · ${this.captureT > 2 ? 'boarding line close' : 'pursuer in the rain'}` : '';
    return { title: 'High Water', obj: this.state.branch === 'runner' ? 'Lead Cal to the storm cache' : 'Lead June and Nolan to Old Mill', sub: `Convoy ${gap < 55 ? 'in your wake' : gap < 150 ? 'falling back' : 'out of sight'} · ${Math.round(gap * 3.28084)} ft${pressure}` };
  }

  menuLine() {
    const s = this.state;
    if (s.stage === 'dormant') return this.eligible() ? 'High Water · storm call pending' : 'High Water · locked';
    if (s.stage === 'rendezvous') return `High Water · meet ${s.branch === 'runner' ? 'Cal at Lost Key' : 'June at Split Pine'}`;
    if (s.stage === 'escort') return `High Water · ${s.branch === 'runner' ? 'Lost Key convoy' : 'Split Pine evacuation'} underway`;
    if (s.stage === 'failed') return 'High Water · regrouping';
    return `High Water · ${s.ending === 'runner' ? 'storm cache powered' : 'Old Mill refuge powered'}`;
  }

  placeResult(t) {
    const p = this.resultPoint(); this.P.placeBoat(this.rigs.result, p, t); this.rigs.result.visible = true;
  }

  updateLights(t) {
    const visible = this.rigs.result.visible, storm = this.P.environment.values.storm, h = this.P.environment.hour;
    const night = h < 6.3 || h > 18.4, pulse = 0.86 + Math.sin(t * 1.7) * 0.14;
    this.rigs.lamp.light.intensity = visible && (night || storm > 0.55) ? (this.state.branch === 'runner' ? 135 : 165) * pulse : 0;
    this.rigs.lamp.bulb.scale.setScalar(1.15 + pulse * 0.35);
    if (!this.chaseActive) return;
    if (this.state.branch === 'runner') {
      const blink = Math.floor(t * 5.3) % 2;
      this.P.passage.rigs.blue.light.intensity = blink ? 118 : 5; this.P.passage.rigs.red.light.intensity = blink ? 5 : 118;
    } else this.P.passage.rigs.runnerLamp.light.intensity = night || storm > 0.65 ? 92 : 18;
  }

  addBoat(A, obstacle) {
    if (!A.active || Math.hypot(A.x - this.P.phys.pos.x, A.z - this.P.phys.pos.y) > 82) return;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    obstacle.ax = A.x + fx * 2.1; obstacle.az = A.z + fz * 2.1; obstacle.bx = A.x - fx * 2.1; obstacle.bz = A.z - fz * 2.1; this.obs.push(obstacle);
  }

  addStatic(mesh, point, obstacle) {
    if (!mesh.visible || Math.hypot(point.x - this.P.phys.pos.x, point.z - this.P.phys.pos.y) > 82) return;
    const fx = -Math.sin(point.heading), fz = -Math.cos(point.heading);
    obstacle.ax = point.x + fx * 2.1; obstacle.az = point.z + fz * 2.1; obstacle.bx = point.x - fx * 2.1; obstacle.bz = point.z - fz * 2.1; this.obs.push(obstacle);
  }

  refreshObstacles() {
    this.obs.length = 0;
    if (this.state.stage === 'rendezvous') this.addStatic(this.convoyMesh(), this.startPoint(), this.convoyObs);
    else if (this.state.stage === 'escort') this.addBoat(this.convoy, this.convoyObs);
    else if (this.state.stage === 'complete' && !this.state.consequence) this.addStatic(this.convoyMesh(), this.destination(), this.convoyObs);
    if (this.chaseActive) this.addBoat(this.chaser, this.chaserObs);
    if (this.rigs.result.visible) this.addStatic(this.rigs.result, this.resultPoint(), this.resultObs);
  }

  pushMarkers() {
    if (this.state.stage === 'escort' && this.convoy.active) emitMapMarker(this.P.game, this.convoy.x, this.convoy.z, 'boat', this.state.branch === 'runner' ? '#cf7e43' : '#79a9b8', this.convoy.heading);
    const permanent = this.permanentMarker();
    if (permanent && Math.hypot(permanent.x - this.P.phys.pos.x, permanent.z - this.P.phys.pos.y) < 900) emitMapMarker(this.P.game, permanent.x, permanent.z, 'dot', permanent.color);
  }

  updateAudio() {
    this.obLevel = 0; this.obPitch = this.state.branch === 'runner' ? 0.84 : 0.94;
    for (const A of [this.convoy, this.chaser]) {
      if (!A.active) continue;
      const d = Math.hypot(A.x - this.P.phys.pos.x, A.z - this.P.phys.pos.y);
      if (d < 155) this.obLevel = Math.max(this.obLevel, (0.22 + 0.72 * Math.min(1, A.speed / 12)) * (1 - d / 155));
    }
  }

  wakeHeightAt(x, z, t) { return sampleVesselWake(this.agents, x, z, t, 12.7, 0.11); }

  stamps(out) {
    for (const A of this.agents) {
      if (!A.active || A.backing || A.speed < 2 || Math.hypot(A.x - this.P.phys.pos.x, A.z - this.P.phys.pos.y) > 95) continue;
      const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 11);
      emitWakeStamp(out, A.x - fx * 1.8, A.z - fz * 1.8, 1.1, 0.54 * sp, 1.7 * sp, 1);
      emitWakeStamp(out, A.x + fx * 1.8, A.z + fz * 1.8, 1, -0.68 * sp, 0.1 * sp, 0.7);
    }
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.hitCd = Math.max(0, this.hitCd - dt); this.updateLights(t);
    if (!enabled) { this.P.clearPrompt(); this.obs.length = 0; this.updateAudio(); return; }
    const s = this.state.stage;
    if (s === 'dormant') { if (this.eligible() && !this.state.offerAt) this.arm(); if (this.eligible() && Date.now() >= this.state.offerAt) this.offer(); }
    else if (s === 'rendezvous') this.updateRendezvous(t);
    else if (s === 'escort') this.updateEscort(dt, t);
    else if (s === 'failed' && Date.now() >= this.state.retryAt) { this.state.stage = 'dormant'; this.persist(); }
    else if (s === 'complete') {
      this.placeResult(t); this.P.clearPrompt(); this.P.game.wpTarget = null;
      if (!this.state.consequence && this.P.departT <= 0) this.P.placeBoat(this.convoyMesh(), this.destination(), t);
      this.triggerConsequence(false);
    }
    this.refreshObstacles(); this.pushMarkers(); this.updateAudio();
  }

  resetDebug() {
    this.stopChaser(false, false); this.P.clearPrompt(); this.obs.length = 0; this.rigs.result.visible = this.rigs.generator.visible = false;
    this.convoy.active = false;
    Object.assign(this.state, {
      stage: 'dormant', branch: '', ending: '', offerAt: 0, retryAt: 0, completedAt: 0, consequenceAt: 0,
      consequence: false, routeBand: 0, weatherEscalated: false, chaseStarted: false, chaseCleared: false,
      chaseLife: 0, convoyX: NaN, convoyZ: NaN, convoyHeading: NaN, chaserX: NaN, chaserZ: NaN, chaserHeading: NaN, attempts: 0,
    });
    this.captureT = this.separationT = this.lostT = 0; this.warnBand = 0; this.updateAudio(); this.persist();
  }
}
