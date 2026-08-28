import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { regionAt } from './regions.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const PASSAGE_COORDS = {
  wreck: { x: -4120.231362133571, z: -1225.1721411512312, heading: 1.9634954084936207, region: 'cypress' },
  aid: { x: -5955.010777408952, z: -1666.495293931879, heading: 1.1780972450961724, region: 'cypress' },
  cache: { x: 3494.2398245425384, z: -4557.591286691637, heading: 0, region: 'mangrove' },
};

function recolor(group, color) {
  let done = false;
  group.traverse(o => {
    if (done || !o.isMesh || !o.material?.color || o.material.metalness < 0.45) return;
    o.material = o.material.clone(); o.material.color.setHex(color); done = true;
  });
}

function signal(parent, color, x, y, z, range = 48) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 9, 7), mat);
  const light = new THREE.PointLight(color, 0, range, 2); g.add(bulb, light); parent.add(g);
  return { group: g, bulb, light, mat };
}

function medicalCooler() {
  const g = new THREE.Group(); g.name = 'sealed medical cooler';
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x24708d, roughness: 0.62, metalness: 0.05 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0xe5e2d5, roughness: 0.7, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x182320, roughness: 0.78, metalness: 0.18 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.62 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.48, 0.58), bodyMat); body.position.y = 0.02; g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.13, 0.64), lidMat); lid.position.y = 0.325; g.add(lid);
  for (const x of [-0.3, 0.3]) { const latch = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.045), dark); latch.position.set(x, 0.08, 0.31); g.add(latch); }
  for (const z of [-0.296, 0.296]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.085, 0.018), white); a.position.set(0, 0.03, z); g.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.28, 0.018), white); b.position.set(0, 0.03, z); g.add(b);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function injuredCourier() {
  const g = new THREE.Group(); g.name = 'Nolan Pike';
  const skin = new THREE.MeshStandardMaterial({ color: 0xaa7859, roughness: 0.86 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x5a665f, roughness: 0.92 });
  const vest = new THREE.MeshStandardMaterial({ color: 0xe46c25, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x242a29, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.46, 4, 8), shirt); torso.position.y = 0.47; torso.rotation.z = -0.18; g.add(torso);
  const vestFront = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.38, 0.16), vest); vestFront.position.set(0, 0.48, -0.11); vestFront.rotation.z = -0.18; g.add(vestFront);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin); head.position.set(-0.08, 0.86, 0); g.add(head);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.34, 4, 6), pants); leg.position.set(sx * 0.12, 0.16, -0.18); leg.rotation.x = -1.1; g.add(leg);
  }
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.34, 4, 6), skin); arm.position.set(0.27, 0.63, -0.02); arm.rotation.z = -0.9; g.add(arm); g.userData.waveArm = arm;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}

export class FalsePassage {
  constructor(parent) {
    this.P = parent;
    const saved = parent.state.passage || {};
    this.state = parent.state.passage = {
      stage: saved.stage || 'dormant', branch: saved.branch || '', ending: saved.ending || '', approached: Boolean(saved.approached),
      offerAt: Number(saved.offerAt) || 0, retryAt: Number(saved.retryAt) || 0, completedAt: Number(saved.completedAt) || 0,
      consequenceAt: Number(saved.consequenceAt) || 0, consequence: Boolean(saved.consequence), cargoUntil: Number(saved.cargoUntil) || 0,
      routeBand: Math.max(0, Math.min(2, Number(saved.routeBand) || 0)), chaseStarted: Boolean(saved.chaseStarted), chaseCleared: Boolean(saved.chaseCleared),
      coolerX: Number(saved.coolerX), coolerZ: Number(saved.coolerZ), coords: saved.coords || null,
    };
    // These berths were validated against terrain, settlements, jobs, and deep-water
    // clearance. Keep them deterministic so a new game does not search the whole map.
    if (!this.state.coords || this.state.coords.cache?.region !== 'mangrove') this.state.coords = this.makeCoords();
    const C = this.state.coords;
    if (!Number.isFinite(this.state.coolerX)) this.state.coolerX = C.wreck.x + Math.cos(C.wreck.heading + 0.85) * 7;
    if (!Number.isFinite(this.state.coolerZ)) this.state.coolerZ = C.wreck.z + Math.sin(C.wreck.heading + 0.85) * 7;
    this.choiceT = 0; this.routeStart = 0; this.routeBand = this.state.routeBand; this.persistT = 5; this.enabled = false;
    this.chaseActive = false; this.chaseDelay = 0; this.chasePressure = 0; this.lostT = 0; this.hitCd = 0;
    this._flow = new THREE.Vector2(); this._f = new THREE.Vector2(); this._r = new THREE.Vector2();
    this.obs = []; this.P.phys.addObs('story-false-passage', this.obs);
    this.wreckObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: 'courier wreck' };
    this.recipientObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'work skiff' };
    this.coolerObs = { x: 0, z: 0, r: 0.78, tag: 'medical cooler' };
    this.chaserObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: 'pursuing skiff', onHit: (into, nx, nz) => this.chaserHit(into, nx, nz) };
    this.rigs = this.makeRigs();
    this.P.scene.add(this.rigs.wreck, this.rigs.aid, this.rigs.cache, this.rigs.runner, this.rigs.patrol, this.rigs.cooler);
    this.agent = { mesh: this.rigs.runner, active: false };
    this.obLevel = 0; this.obPitch = 0.92;
    if (this.eligible() && !this.state.offerAt && this.state.stage === 'dormant') this.arm(60000);
    this.restore(); this.persist();
  }

  makeCoords() {
    return {
      wreck: { ...PASSAGE_COORDS.wreck },
      aid: { ...PASSAGE_COORDS.aid },
      cache: { ...PASSAGE_COORDS.cache },
    };
  }

  makeRigs() {
    const wreck = buildSkiff({ crew: false }); recolor(wreck, 0x77858b); wreck.visible = false;
    if (wreck.userData.motor) wreck.userData.motor.rotation.x = -0.62;
    const survivor = injuredCourier(); survivor.position.set(-0.12, 0.55, -0.45); survivor.rotation.y = Math.PI; wreck.add(survivor);
    const strobe = signal(wreck, 0xff6a35, -0.32, 1.2, -0.1, 62);
    const aid = buildSkiff({ crew: true }); recolor(aid, 0x416b79); aid.visible = false; const aidLamp = signal(aid, 0xf5df9c, 0, 1.3, -0.2, 56);
    const cache = buildSkiff({ crew: true }); recolor(cache, 0x392d28); cache.visible = false; const cacheLamp = signal(cache, 0x4f8fff, 0, 1.3, -0.2, 58);
    const runner = buildSkiff({ crew: true }); recolor(runner, 0x34251f); runner.visible = false; const runnerLamp = signal(runner, 0xe79735, 0, 1.25, -0.2, 46);
    const patrol = buildSkiff({ crew: true }); recolor(patrol, 0x315e50); patrol.visible = false;
    const blue = signal(patrol, 0x327eff, -0.26, 1.35, -0.2, 54), red = signal(patrol, 0xff372b, 0.26, 1.35, -0.2, 54);
    const cooler = medicalCooler(); cooler.visible = false;
    return { wreck, survivor, strobe, aid, aidLamp, cache, cacheLamp, runner, runnerLamp, patrol, blue, red, cooler };
  }

  persist() { this.P.persist(); }
  eligible() { return this.P.state.stage === 'complete' && this.P.state.consequence; }
  busy() { return ['search', 'choice', 'delivery'].includes(this.state.stage); }
  blocking() { return this.busy(); }

  arm(delay = 75000) {
    if (this.state.stage !== 'dormant' || this.state.offerAt) return;
    this.state.offerAt = Date.now() + delay; this.persist();
  }

  hideRigs() {
    for (const m of [this.rigs.wreck, this.rigs.aid, this.rigs.cache, this.rigs.runner, this.rigs.patrol, this.rigs.cooler]) m.visible = false;
    this.rigs.survivor.visible = false; this.rigs.strobe.light.intensity = this.rigs.aidLamp.light.intensity = this.rigs.cacheLamp.light.intensity = 0;
    this.rigs.runnerLamp.light.intensity = this.rigs.blue.light.intensity = this.rigs.red.light.intensity = 0;
  }

  restore() {
    this.hideRigs(); this.stopChaser(false, false);
    const s = this.state.stage;
    if (['search', 'choice', 'delivery'].includes(s)) {
      this.rigs.wreck.visible = true; this.rigs.survivor.visible = true;
      if (s === 'search' || s === 'choice') {
        this.P.scene.add(this.rigs.cooler); this.rigs.cooler.visible = true;
        this.rigs.wreck.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.12, 0.55, -0.45); this.rigs.survivor.rotation.set(0, Math.PI, 0);
      }
      else {
        this.P.boat.add(this.rigs.cooler); this.rigs.cooler.position.set(0.68, 0.72, -1.25); this.rigs.cooler.rotation.set(0.02, 0.12, -0.02); this.rigs.cooler.visible = true;
        if (this.state.branch === 'rescue') { this.P.boat.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.48, 0.58, -0.28); this.rigs.survivor.rotation.set(0, -0.35, 0); }
        else { this.rigs.wreck.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.12, 0.55, -0.45); this.rigs.survivor.rotation.set(0, Math.PI, 0); }
        this.P.phys.loaded = Math.max(this.P.phys.loaded, this.state.branch === 'rescue' ? 0.34 : 0.22);
        const d = this.destination(); this.routeStart = Math.max(1, Math.hypot(d.x - this.P.phys.pos.x, d.z - this.P.phys.pos.y)); this.routeBand = this.state.routeBand;
        this.rigs.aid.visible = this.state.branch === 'rescue'; this.rigs.cache.visible = this.state.branch === 'runner';
        if (this.state.branch === 'runner') {
          const remaining = Math.max(0, (this.state.cargoUntil - Date.now()) / 1000);
          if (remaining > 0) { this.P.law.hotCargoT = Math.max(this.P.law.hotCargoT, remaining); this.P.law.attention = Math.max(this.P.law.attention, 1.35); this.P.law.lastReason = 'stolen medical cargo reported'; }
        }
        if (this.state.chaseStarted && !this.state.chaseCleared) this.chaseDelay = 2.5;
      }
    } else if (s === 'complete' && this.state.ending === 'rescue') {
      this.rigs.aid.add(this.rigs.cooler); this.rigs.cooler.position.set(0.48, 0.7, -1.0); this.rigs.cooler.rotation.set(0, -0.18, 0);
      this.rigs.aid.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.42, 0.56, -0.3); this.rigs.survivor.rotation.set(0, 0.2, 0);
    } else if (s === 'complete' && this.state.ending === 'runner') {
      this.P.rigs.lostKey.add(this.rigs.cooler); this.rigs.cooler.position.set(-0.48, 0.7, -1.02); this.rigs.cooler.rotation.set(0, -0.15, 0);
      this.rigs.wreck.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.12, 0.55, -0.45); this.rigs.survivor.rotation.set(0, Math.PI, 0);
    }
  }

  offer(force = false) {
    if (!this.eligible() || !['dormant', 'failed'].includes(this.state.stage)) return false;
    if (!force && (Date.now() < this.state.offerAt || this.P.game.state || this.P.encounters.active || this.P.incidents.active || this.P.environment.values.storm > 0.94)) return false;
    const C = this.state.coords.wreck;
    Object.assign(this.state, {
      stage: 'search', branch: '', ending: '', approached: false, retryAt: 0, completedAt: 0, consequenceAt: 0, consequence: false,
      cargoUntil: 0, routeBand: 0, chaseStarted: false, chaseCleared: false,
      coolerX: C.x + Math.cos(C.heading + 0.85) * 7, coolerZ: C.z + Math.sin(C.heading + 0.85) * 7,
    });
    this.routeBand = 0; this.choiceT = 0; this.restore(); this.persist();
    if (this.P.state.ending === 'runner') {
      this.P.call('CH 16', 'MARA KEENE · TOWER', 'That false red at West Cut put a clinic courier into the cypress. Nolan Pike is overdue, and you know why I am calling this hull.', 4, 'passage-offer-runner');
    } else {
      this.P.call('CH 68', 'LEON DOSS · OLD MILL', 'Somebody cut the West Cut cage after I put it back. Clinic courier hit something below the light. Nolan Pike has not answered since.', 4, 'passage-offer-local');
    }
    this.P.call('CH 16', 'MARA KEENE · TOWER', 'Last carrier is west of the marker. White skiff, blue medical cooler, one person aboard.', 3, 'passage-fix');
    this.P.game.toast('False Passage', 'A clinic courier is missing off West Cut.', 3.4); return true;
  }

  destination() { return this.state.branch === 'runner' ? this.state.coords.cache : this.state.coords.aid; }

  marker() {
    const s = this.state.stage, C = this.state.coords;
    if (s === 'search' || s === 'choice') return { ...(this.state.approached ? { x: this.state.coolerX, z: this.state.coolerZ } : { x: C.wreck.x + 55, z: C.wreck.z - 35 }), color: '#e6d07a', label: this.state.approached ? 'Nolan’s medical cooler' : 'courier’s last carrier', story: true };
    if (s === 'delivery') { const d = this.destination(); return { x: d.x, z: d.z, color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', label: this.state.branch === 'runner' ? 'Cal’s cutout' : 'Split Pine aid boat', story: true }; }
    return null;
  }

  hud() {
    if (!this.busy()) return null;
    const s = this.state.stage, m = this.marker();
    if (s === 'search') return { title: 'False Passage', obj: 'Find the clinic courier', sub: `${regionAt(m.x, m.z).name} · last carrier off West Cut` };
    if (s === 'choice') return { title: 'False Passage', obj: 'Nolan is hurt. The cooler is sealed.', sub: 'E · take both aboard  ·  F · take the cooler for Cal' };
    const d = this.destination(); return { title: 'False Passage', obj: this.state.branch === 'runner' ? 'Get the cooler to Cal’s cutout' : 'Get Nolan to the Split Pine aid boat', sub: `${regionAt(d.x, d.z).name} · arrive under 6 mph` };
  }

  menuLine() {
    const s = this.state;
    if (s.stage === 'dormant') return this.eligible() ? 'False Passage · waiting on the radio' : 'False Passage · locked';
    if (s.stage === 'search') return 'False Passage · find the clinic courier';
    if (s.stage === 'choice') return 'False Passage · Nolan found';
    if (s.stage === 'delivery') return `False Passage · bound for ${s.branch === 'runner' ? 'Cal’s cutout' : 'Split Pine'}`;
    if (s.stage === 'failed') return 'False Passage · regrouping';
    return `False Passage · ${s.ending === 'runner' ? 'cooler sold' : 'Nolan rescued'}`;
  }

  updateCooler(dt, t) {
    const C = this.state.coords.wreck, f = this.P.currents.flowAt(this.state.coolerX, this.state.coolerZ, this._flow);
    this.state.coolerX += f.x * dt * 0.72; this.state.coolerZ += f.y * dt * 0.72;
    const dx = C.x - this.state.coolerX, dz = C.z - this.state.coolerZ, d = Math.hypot(dx, dz);
    if (d > 18) { this.state.coolerX += dx / d * (d - 18) * dt * 0.65; this.state.coolerZ += dz / d * (d - 18) * dt * 0.65; }
    const q = this.rigs.cooler; q.position.set(this.state.coolerX, this.P.water.waveHeight(this.state.coolerX, this.state.coolerZ, t) - 0.02, this.state.coolerZ);
    q.rotation.set(Math.sin(t * 0.8) * 0.1, C.heading - 0.35, Math.cos(t * 0.92) * 0.13);
    this.persistT -= dt; if (this.persistT <= 0) { this.persistT = 5; this.persist(); }
  }

  placeWreck(t) {
    this.P.placeBoat(this.rigs.wreck, this.state.coords.wreck, t, 0.11);
    const a = this.rigs.survivor.userData.waveArm; if (a) a.rotation.z = -0.8 - Math.sin(t * 3.1) * 0.5;
  }

  updateSearch(dt, t) {
    this.updateCooler(dt, t); this.placeWreck(t);
    const d = Math.min(Math.hypot(this.state.coolerX - this.P.phys.pos.x, this.state.coolerZ - this.P.phys.pos.y), Math.hypot(this.state.coords.wreck.x - this.P.phys.pos.x, this.state.coords.wreck.z - this.P.phys.pos.y));
    if (!this.state.approached && d < 135) {
      this.state.approached = true; this.state.stage = 'choice'; this.choiceT = 0; this.persist();
      this.P.call('CH 16', 'NOLAN PIKE · CLINIC COURIER', 'Tower Boat, I am still here. Shoulder is bad. Cooler went over when the skiff opened up.', 4, 'passage-nolan');
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Blue cooler stays sealed and comes to me. Leave the courier on sixteen. Nine hundred, plus two if the patrol never sees it.', 3, 'passage-cal-offer');
      this.P.game.toast('Nolan Pike found', 'He is hurt. The medical cooler is in the water.', 3.2);
    }
    const m = this.marker(); this.P.game.wpTarget = m ? { ...m } : null;
  }

  updateChoice(dt, t) {
    this.choiceT += dt; this.updateCooler(dt, t); this.placeWreck(t);
    const d = Math.hypot(this.state.coolerX - this.P.phys.pos.x, this.state.coolerZ - this.P.phys.pos.y), m = this.marker(); this.P.game.wpTarget = m ? { ...m } : null;
    if (this.choiceT > 1.15 && d < 12 && this.P.phys.speed * MPH < 6 && this.P.canInteract()) {
      this.P.setPrompt('<b>E</b> take Nolan and the cooler aboard <i>· F take the cooler for Cal</i>');
      if (this.P.interact) this.choose('rescue'); else if (this.P.alternate) this.choose('runner');
    } else this.P.clearPrompt();
  }

  choose(branch) {
    if (this.state.stage !== 'choice') return;
    this.state.stage = 'delivery'; this.state.branch = branch; this.state.routeBand = this.routeBand = 0; this.state.chaseStarted = false; this.state.chaseCleared = false;
    this.P.boat.add(this.rigs.cooler); this.rigs.cooler.position.set(0.68, 0.72, -1.25); this.rigs.cooler.rotation.set(0.02, 0.12, -0.02); this.rigs.cooler.visible = true;
    if (branch === 'rescue') {
      this.P.boat.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.48, 0.58, -0.28); this.rigs.survivor.rotation.set(0, -0.35, 0); this.state.cargoUntil = 0; this.P.phys.loaded = Math.max(this.P.phys.loaded, 0.34);
      this.rigs.aid.visible = true; this.rigs.cache.visible = false;
      this.P.call('CH 68', 'JUNE BELL · SPLIT PINE', 'Bring Nolan to the blue aid skiff. I have a medic and a dry berth waiting. Do not stop for Cal.', 4, 'passage-rescue-start');
      this.P.game.toast('Nolan aboard', 'Split Pine has a medic waiting.', 3);
    } else {
      this.rigs.wreck.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.12, 0.55, -0.45); this.rigs.survivor.rotation.set(0, Math.PI, 0); this.state.cargoUntil = Date.now() + 220000; this.P.phys.loaded = Math.max(this.P.phys.loaded, 0.22);
      this.rigs.aid.visible = false; this.rigs.cache.visible = true; this.P.law.addContraband();
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Cutout has one blue light and no dock. Keep the cooler shut. Soto is already asking about the courier.', 4, 'passage-runner-start');
      this.P.game.toast('Cooler aboard', 'Nolan is still on the wreck. FWC heard the call.', 3);
    }
    const d = this.destination(); this.routeStart = Math.max(1, Math.hypot(d.x - this.P.phys.pos.x, d.z - this.P.phys.pos.y)); this.P.clearPrompt(); this.persist();
  }

  chaserSpawn() {
    const p = this.P.phys, f = p.forward(this._f), r = p.right(this._r);
    for (const behind of [78, 96, 116]) for (const side of [-34, 34, 0]) {
      const x = p.pos.x - f.x * behind + r.x * side, z = p.pos.y - f.y * behind + r.y * side;
      const depth = this.P.water.level - this.P.terrain.heightAt(x, z);
      if (depth > 0.72 && depth < 6.3 && !this.P.world.blockedAt(x, z)) return { x, z, heading: Math.atan2(-(p.pos.x - x), -(p.pos.y - z)) };
    }
    return this.P.encounters.spot(75, 110, 35);
  }

  spawnChaser() {
    if (this.chaseActive || this.state.stage !== 'delivery') return false;
    const at = this.chaserSpawn(); if (!at) { this.chaseDelay = 2; return false; }
    const patrol = this.state.branch === 'runner', mesh = patrol ? this.rigs.patrol : this.rigs.runner;
    this.rigs.runner.visible = !patrol; this.rigs.patrol.visible = patrol; this.agent.mesh = mesh;
    this.P.incidents.setAgent(this.agent, at.x, at.z, at.heading, 3.2); this.chaseActive = true; this.chasePressure = 0; this.lostT = 0;
    this.state.chaseStarted = true; this.state.chaseCleared = false; this.persist();
    if (patrol) {
      this.P.law.setPursuit(true); this.P.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower Boat, clinic cargo is reported stolen. Reduce speed and hold your line. This is a directed stop.', 4, 'passage-patrol-chase');
    } else this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Last chance. My skiff is in your wake. Put the blue cooler in the water and turn off.', 4, 'passage-runner-chase');
    return true;
  }

  chaserHit(into, nx, nz) {
    if (!this.chaseActive) return;
    this.agent.shx += -nx * into * 0.46; this.agent.shz += -nz * into * 0.46; this.agent.speed *= 0.58;
    if (this.hitCd > 0 || into < 2.8) return; this.hitCd = 4;
    if (this.state.branch === 'runner') { this.P.game.toast('FWC hull struck', 'Soto is adding the collision to the stop.', 2.4); this.P.law.violation(0.7, 'FWC vessel struck', true); }
    else this.P.game.toast('Runner alongside', 'They are trying to take the cooler off the deck.', 2.4);
  }

  stopChaser(markCleared = true, save = true) {
    this.chaseActive = false; this.agent.active = false; this.rigs.runner.visible = false; this.rigs.patrol.visible = false;
    this.rigs.runnerLamp.light.intensity = this.rigs.blue.light.intensity = this.rigs.red.light.intensity = 0; this.P.law.setPursuit(false);
    if (markCleared) this.state.chaseCleared = true; if (save) this.persist(); this.obLevel = 0;
  }

  updateChaser(dt, t) {
    if (!this.chaseActive) return;
    const p = this.P.phys, A = this.agent, patrol = this.state.branch === 'runner';
    this.P.incidents.updateAgent(A, dt, t, p.pos.x + p.vel.x * 0.7, p.pos.y + p.vel.y * 0.7, patrol ? 11.4 : 13.4, 0);
    const d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y);
    if (d < 14 && p.speed * MPH < 12) this.chasePressure += dt; else this.chasePressure = Math.max(0, this.chasePressure - dt * 0.28);
    if (d > 340) this.lostT += dt; else this.lostT = Math.max(0, this.lostT - dt * 0.5);
    if (this.chasePressure > 3.8) { this.fail(patrol ? 'Soto got a line aboard and seized the cooler.' : 'Cal’s crew pulled the cooler off the deck.'); return; }
    if (this.lostT > 8) {
      this.stopChaser(true); this.P.call(patrol ? 'FWC TAC' : 'CH 72', patrol ? 'WARDEN SOTO · FWC 27' : 'CAL ROOK · LOST KEY', patrol ? 'Tower Boat is out of sight in the back cuts. Units keep the call open.' : 'You bought some water. It does not make the debt disappear.', 2, 'passage-chase-lost');
      return;
    }
    this.P.game.mapMarkers.push({ x: A.x, z: A.z, kind: 'hazard', color: patrol ? '#5b8fff' : '#e0523e', clamp: d > 155 });
  }

  updateDelivery(dt, t) {
    const dpt = this.destination(), recipient = this.state.branch === 'runner' ? this.rigs.cache : this.rigs.aid;
    this.P.placeBoat(recipient, dpt, t); this.P.game.wpTarget = { x: dpt.x, z: dpt.z, label: this.state.branch === 'runner' ? 'Cal’s cutout' : 'Split Pine aid boat', color: this.state.branch === 'runner' ? '#5b8fff' : '#f0d989', story: true };
    if (this.state.branch === 'runner' && this.state.cargoUntil) {
      const remaining = Math.max(0, (this.state.cargoUntil - Date.now()) / 1000); this.P.law.hotCargoT = remaining > 0 ? remaining : Math.min(this.P.law.hotCargoT, dt);
    }
    const d = Math.hypot(dpt.x - this.P.phys.pos.x, dpt.z - this.P.phys.pos.y), ratio = this.routeStart > 0 ? d / this.routeStart : 0;
    if (this.routeBand === 0 && ratio < 0.72) {
      this.state.routeBand = this.routeBand = 1; this.persist(); this.spawnChaser();
    } else if (this.routeBand === 1 && ratio < 0.34) {
      this.state.routeBand = this.routeBand = 2; this.persist();
      this.P.call(this.state.branch === 'runner' ? 'CH 72' : 'CH 68', this.state.branch === 'runner' ? 'CAL ROOK · LOST KEY' : 'JUNE BELL · SPLIT PINE', this.state.branch === 'runner' ? 'Blue lamp under the mangroves. Come straight in and do not circle.' : 'I see Nolan’s orange vest. Bring him port side and keep the fan down.', 3, 'passage-route-two');
    }
    if (!this.chaseActive && this.state.chaseStarted && !this.state.chaseCleared) { this.chaseDelay -= dt; if (this.chaseDelay <= 0) this.spawnChaser(); }
    this.updateChaser(dt, t); if (this.state.stage !== 'delivery') return;
    if (d < 12 && this.P.phys.speed * MPH < 6 && this.P.canInteract()) {
      this.P.setPrompt(`<b>E</b> ${this.state.branch === 'runner' ? 'hand the cooler to Cal Rook' : 'put Nolan alongside the aid boat'}`); if (this.P.interact) this.finish();
    } else this.P.clearPrompt();
  }

  finish() {
    if (this.state.stage !== 'delivery') return;
    const branch = this.state.branch, recipient = branch === 'runner' ? this.rigs.cache : this.rigs.aid, berth = this.destination();
    this.stopChaser(true, false); recipient.add(this.rigs.cooler); this.rigs.cooler.position.set(0.48, 0.7, -1.0); this.rigs.cooler.rotation.set(0, -0.18, 0); this.rigs.cooler.visible = true;
    const cargo = [this.rigs.cooler];
    if (branch === 'rescue') { recipient.add(this.rigs.survivor); this.rigs.survivor.position.set(-0.42, 0.56, -0.3); this.rigs.survivor.rotation.set(0, 0.2, 0); this.rigs.survivor.visible = true; cargo.push(this.rigs.survivor); }
    else this.rigs.survivor.visible = false;
    Object.assign(this.state, { stage: 'complete', ending: branch, completedAt: Date.now(), consequenceAt: Date.now() + 75000, consequence: false, cargoUntil: 0, chaseCleared: true });
    this.rigs.wreck.visible = false; this.P.phys.loaded = 0; this.P.clearPrompt(); this.P.game.wpTarget = null; this.P.law.hotCargoT = 0; this.P.law.cool(0.3);
    this.P.startDeparture(recipient, berth, cargo, branch === 'runner' ? 0.82 : 0.9);
    if (branch === 'runner') {
      this.P.game.addCash(1100); this.P.reputation.change('runners', 1.8, 'false-passage-sale', 'You sold Cal Rook a clinic cooler taken from a wreck.', true);
      this.P.reputation.change('locals', -1.15, 'false-passage-sale', 'The camps heard Nolan was left on the wreck while the cooler went south.', false);
      this.P.reputation.change('fwc', -0.4, 'false-passage-sale', 'FWC tied the missing clinic cooler to the tower hull.', false);
      this.P.call('CH 72', 'CAL ROOK · LOST KEY', 'Seal is clean. Eleven hundred. Nolan was breathing when you left him; let sixteen solve the rest.', 4, 'passage-runner-finish');
      this.P.game.bountyToast('Clinic cooler sold <b>+$1,100</b>');
    } else {
      this.P.game.addCash(650); this.P.reputation.change('locals', 1.6, 'false-passage-rescue', 'You brought Nolan and the clinic cooler to Split Pine.', true);
      this.P.reputation.change('fwc', 0.75, 'false-passage-rescue', 'The missing courier and medical cargo reached the aid boat.', false);
      this.P.reputation.change('runners', -0.8, 'false-passage-rescue', 'Cal’s crew lost the clinic cooler after showing their hand.', false);
      this.P.call('CH 68', 'JUNE BELL · SPLIT PINE', 'We have Nolan. Cooler is cold and sealed. Leon can argue about the light after the medic gets his shoulder set.', 4, 'passage-rescue-finish');
      this.P.game.bountyToast('Courier rescued <b>+$650</b>');
    }
    this.P.audio.complete(); this.persist();
  }

  fail(reason) {
    if (this.state.stage !== 'delivery') return;
    const patrol = this.state.branch === 'runner'; this.stopChaser(false, false); this.P.clearPrompt(); this.P.game.wpTarget = null; this.P.phys.loaded = 0;
    this.P.scene.add(this.rigs.cooler); this.rigs.cooler.visible = false; this.rigs.survivor.visible = false; this.rigs.wreck.visible = false; this.rigs.aid.visible = false; this.rigs.cache.visible = false;
    if (patrol) { const seized = this.P.law.confiscate(); if (!seized) this.P.law.cited(); } else this.P.law.hotCargoT = 0;
    Object.assign(this.state, { stage: 'failed', retryAt: Date.now() + 30000, offerAt: Date.now() + 30000, cargoUntil: 0 });
    this.P.call(patrol ? 'FWC TAC' : 'CH 72', patrol ? 'WARDEN SOTO · FWC 27' : 'CAL ROOK · LOST KEY', reason, 4, 'passage-failed');
    this.P.game.toast('False Passage failed', reason, 3.6); this.P.audio.fail(); this.persist();
  }

  triggerConsequence() {
    if (this.state.stage !== 'complete' || this.state.consequence || Date.now() < this.state.consequenceAt) return false;
    this.state.consequence = true; this.persist();
    if (this.state.ending === 'runner') this.P.call('CH 16', 'MARA KEENE · TOWER', 'FWC found Nolan alive on the wreck. The clinic cooler is still missing. Nobody at Split Pine is asking which hull took it.', 3, 'passage-runner-aftermath');
    else this.P.call('CH 16', 'NOLAN PIKE · SPLIT PINE', 'Tower Boat, Nolan. Shoulder is set. I owe you a cooler, a skiff, and one ride where nobody is chasing us.', 2, 'passage-rescue-aftermath');
    return true;
  }

  updateLights(t) {
    const night = this.P.environment.hour < 6.3 || this.P.environment.hour > 18.4, pulse = 0.5 + Math.sin(t * 5.7) * 0.5;
    this.rigs.strobe.light.intensity = this.rigs.wreck.visible ? (night ? 115 : 58) * pulse : 0; this.rigs.strobe.bulb.scale.setScalar(0.9 + pulse * 0.75);
    this.rigs.aidLamp.light.intensity = night && this.rigs.aid.visible ? 92 : 0; this.rigs.cacheLamp.light.intensity = night && this.rigs.cache.visible ? 108 : 0;
    this.rigs.runnerLamp.light.intensity = night && this.rigs.runner.visible ? 78 : 0;
    if (this.rigs.patrol.visible) { const blink = Math.floor(t * 5.2) % 2; this.rigs.blue.light.intensity = blink ? 105 : 5; this.rigs.red.light.intensity = blink ? 5 : 105; }
    else this.rigs.blue.light.intensity = this.rigs.red.light.intensity = 0;
  }

  addBoat(mesh, point, obstacle) {
    if (!mesh.visible || Math.hypot(point.x - this.P.phys.pos.x, point.z - this.P.phys.pos.y) > 82) return;
    const fx = -Math.sin(point.heading), fz = -Math.cos(point.heading); obstacle.ax = point.x + fx * 2.1; obstacle.az = point.z + fz * 2.1; obstacle.bx = point.x - fx * 2.1; obstacle.bz = point.z - fz * 2.1; this.obs.push(obstacle);
  }

  refreshObstacles() {
    this.addBoat(this.rigs.wreck, this.state.coords.wreck, this.wreckObs);
    if ((this.state.stage === 'search' || this.state.stage === 'choice') && this.rigs.cooler.visible && Math.hypot(this.state.coolerX - this.P.phys.pos.x, this.state.coolerZ - this.P.phys.pos.y) < 82) { this.coolerObs.x = this.state.coolerX; this.coolerObs.z = this.state.coolerZ; this.obs.push(this.coolerObs); }
    if (this.state.stage === 'delivery') this.addBoat(this.state.branch === 'runner' ? this.rigs.cache : this.rigs.aid, this.destination(), this.recipientObs);
    if (this.chaseActive) { this.chaserObs.tag = this.state.branch === 'runner' ? 'FWC patrol' : 'runner skiff'; this.addBoat(this.agent.mesh, this.agent, this.chaserObs); }
  }

  updateAudio() {
    this.obLevel = 0; this.obPitch = this.state.branch === 'runner' ? 0.84 : 0.94;
    if (this.state.stage === 'delivery') {
      const dpt = this.destination(), d = Math.hypot(dpt.x - this.P.phys.pos.x, dpt.z - this.P.phys.pos.y);
      if (d < 140) this.obLevel = 0.15 * (1 - d / 140);
    }
    if (this.chaseActive) {
      const d = Math.hypot(this.agent.x - this.P.phys.pos.x, this.agent.z - this.P.phys.pos.y);
      if (d < 150) this.obLevel = Math.max(this.obLevel, (0.25 + 0.7 * Math.min(1, this.agent.speed / 13)) * (1 - d / 150));
    }
  }

  stamps(out) {
    if (!this.chaseActive || this.agent.speed < 2 || Math.hypot(this.agent.x - this.P.phys.pos.x, this.agent.z - this.P.phys.pos.y) > 95) return;
    const A = this.agent, fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 13);
    out.push({ x: A.x - fx * 1.8, z: A.z - fz * 1.8, radius: 1.1, height: 0.52 * sp, foam: 1.7 * sp, foamRadius: 1 });
    out.push({ x: A.x + fx * 1.8, z: A.z + fz * 1.8, radius: 1, height: -0.67 * sp, foam: 0.1 * sp, foamRadius: 0.7 });
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.obs.length = 0; this.hitCd = Math.max(0, this.hitCd - dt); this.updateLights(t);
    if (!enabled) { this.P.clearPrompt(); this.updateAudio(); return; }
    const s = this.state.stage;
    if (s === 'dormant') { if (this.eligible() && !this.state.offerAt) this.arm(); if (this.eligible() && Date.now() >= this.state.offerAt) this.offer(); }
    else if (s === 'search') this.updateSearch(dt, t);
    else if (s === 'choice') this.updateChoice(dt, t);
    else if (s === 'delivery') this.updateDelivery(dt, t);
    else if (s === 'failed' && Date.now() >= this.state.retryAt) { this.state.stage = 'dormant'; this.persist(); }
    else if (s === 'complete') { this.P.clearPrompt(); this.triggerConsequence(); }
    this.refreshObstacles(); this.updateAudio();
  }

  resetDebug() {
    const carrying = this.state.stage === 'delivery' && this.state.branch === 'runner'; this.stopChaser(false, false); this.P.clearPrompt(); this.obs.length = 0; this.hideRigs();
    const C = this.state.coords.wreck;
    Object.assign(this.state, { stage: 'dormant', branch: '', ending: '', approached: false, offerAt: 0, retryAt: 0, completedAt: 0, consequenceAt: 0, consequence: false, cargoUntil: 0, routeBand: 0, chaseStarted: false, chaseCleared: false, coolerX: C.x + Math.cos(C.heading + 0.85) * 7, coolerZ: C.z + Math.sin(C.heading + 0.85) * 7 });
    if (carrying) { this.P.law.hotCargoT = 0; this.P.law.cool(Math.min(1.65, this.P.law.attention)); }
    this.routeBand = 0; this.P.phys.loaded = 0; this.updateAudio(); this.persist();
  }
}
