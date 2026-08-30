import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { mulberry32 } from './noise.js';
import { WORLD_HALF } from './heightfield.js';
import { regionAt } from './regions.js';
import { FalsePassage } from './passage.js';
import { StormLine } from './stormline.js';
import { StoryResidents } from './residents.js';
import { ResidentContracts } from './contracts.js';
import { emitWakeStamp } from './wakestamps.js';
import { emitMapMarker } from './mapmarkers.js';
import { clampWakeHeight, wakeSampleAt } from './wakefield.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function recolor(group, color) {
  let done = false;
  group.traverse(o => {
    if (done || !o.isMesh || !o.material?.color || o.material.metalness < 0.45) return;
    o.material = o.material.clone(); o.material.color.setHex(color); done = true;
  });
}

function lamp(parent, color, x, y, z, range = 34) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), mat);
  const light = new THREE.PointLight(color, 0, range, 2); g.add(bulb, light); parent.add(g);
  return { group: g, bulb, light, mat };
}

function controllerCase() {
  const g = new THREE.Group(); g.name = 'red channel-controller case';
  const shell = new THREE.MeshStandardMaterial({ color: 0x9f2e22, roughness: 0.62, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x181b19, roughness: 0.72, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b7ae, roughness: 0.35, metalness: 0.75 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.31, 0.54), shell); box.castShadow = true; box.receiveShadow = true; g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.075, 0.56), shell); lid.position.y = 0.185; lid.castShadow = true; g.add(lid);
  const seal = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.025, 0.515), dark); seal.position.y = 0.135; g.add(seal);
  for (const x of [-0.25, 0.25]) { const latch = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.17, 0.055), metal); latch.position.set(x, 0.02, 0.295); g.add(latch); }
  const handle = new THREE.Group(); handle.position.set(0, 0.03, -0.33); g.add(handle);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.42, 8), dark); bar.rotation.z = Math.PI / 2; handle.add(bar);
  for (const x of [-0.21, 0.21]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.19, 8), dark); arm.position.set(x, -0.08, 0); handle.add(arm); }
  return g;
}

function channelLight() {
  const g = new THREE.Group(); g.name = 'channel light';
  const steel = new THREE.MeshStandardMaterial({ color: 0x777b75, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202522, roughness: 0.7, metalness: 0.35 });
  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 0.42, 14), new THREE.MeshStandardMaterial({ color: 0xd9d0b7, roughness: 0.7 })); float.position.y = 0.05; g.add(float);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.515, 0.535, 0.12, 14), dark); stripe.position.y = 0.08; g.add(stripe);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.2, 8), steel); pole.position.y = 1.25; g.add(pole);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: 0x172f38, roughness: 0.35, metalness: 0.5 })); panel.position.set(0, 1.65, 0); panel.rotation.x = -0.35; g.add(panel);
  const beacon = lamp(g, 0x6dff8b, 0, 2.38, 0, 85); beacon.bulb.scale.setScalar(1.3);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return { group: g, beacon };
}

export class StoryDirector {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, boat, game, audio, environment, currents, regions, radio, law, reputation, condition, encounters, incidents
    const saved = this.game.save.story || {};
    this.state = this.game.save.story = {
      id: 'running-dark', stage: saved.stage || 'dormant', branch: saved.branch || '', ending: saved.ending || '',
      approached: Boolean(saved.approached), consequence: Boolean(saved.consequence), completedAt: Number(saved.completedAt) || 0,
      consequenceAt: Number(saved.consequenceAt) || 0, cargoUntil: Number(saved.cargoUntil) || 0,
      routeBand: Math.max(0, Math.min(2, Number(saved.routeBand) || 0)), caseX: Number(saved.caseX), caseZ: Number(saved.caseZ),
      coords: saved.coords || null, passage: saved.passage || null, stormLine: saved.stormLine || null,
    };
    if (!this.state.coords) { this.state.coords = this.makeCoords(); this.game.persist(); }
    const S = this.state, C = S.coords;
    if (!Number.isFinite(S.caseX)) S.caseX = C.search.x + Math.cos(C.search.heading + 1.2) * 6;
    if (!Number.isFinite(S.caseZ)) S.caseZ = C.search.z + Math.sin(C.search.heading + 1.2) * 6;
    this.clock = 0; this.offerT = 34; this.choiceT = 0; this.persistT = 6; this.departT = 0; this.departSpeed = 0; this.enabled = false;
    this.departPoint = { x: 0, z: 0, heading: 0 }; this.departMesh = null; this.departCargo = []; this.departPitch = 0.86; this.obLevel = 0; this.obPitch = 0.86;
    this.interact = false; this.alternate = false; this.prompting = false; this.wantInput = false; this.approachHold = 0; this.routeStart = 0; this.routeBand = this.state.routeBand;
    this.obs = [];
    this.wreckObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'maintenance skiff' };
    this.recipientObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'work skiff' };
    this.caseObs = { x: 0, z: 0, r: 0.72, tag: 'controller case' };
    this.phys.addObs('story-running-dark', this.obs);
    this._flow = new THREE.Vector2();
    this.rigs = this.makeRigs(); this.scene.add(this.rigs.wreck, this.rigs.oldMill, this.rigs.lostKey, this.rigs.case, this.rigs.nav.group);
    this.passage = new FalsePassage(this);
    this.stormLine = new StormLine(this);
    this.residents = new StoryResidents(this);
    this.keyHandler = e => {
      if (e.repeat || !this.enabled || this.game.paused || this.game.state) return;
      if (e.code === 'KeyE') this.interact = true;
      if (e.code === 'KeyF') this.alternate = true;
    };
    window.addEventListener('keydown', this.keyHandler);
    this.restore();
    this.contracts = new ResidentContracts(this, this.residents);
  }

  makeCoords() {
    return {
      search: this.findWater(-3000, -1500, 0x71d4),
      local: this.findWater(-6150, -250, 0x0dd5),
      runner: this.findWater(5050, -4650, 0xca17),
    };
  }

  findWater(ax, az, seed) {
    const rr = mulberry32(seed), level = this.water.level;
    let fallback = null;
    for (let k = 0; k < 3600; k++) {
      const a = rr() * Math.PI * 2, r = Math.sqrt(rr()) * 1050;
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 750) continue;
      const base = this.terrain.hf.computeBase(x, z), clear = level - this.terrain.heightAt(x, z);
      if (base.s < 0.48 || base.h < -5.4 || clear < 1.05 || this.world.blockedAt(x, z)) continue;
      if (this.world.campsNear(x, z, 170).length || this.world.sitesNear(x, z, 150).length) continue;
      if (this.game.jobs?.some(j => Math.hypot(j.x - x, j.z - z) < 150)) continue;
      let heading = 0, best = -1e9;
      for (let i = 0; i < 16; i++) {
        const h = i / 16 * Math.PI * 2, sh = Math.sin(h), ch = Math.cos(h);
        const f = level - this.terrain.heightAt(x - sh * 55, z - ch * 55), b = level - this.terrain.heightAt(x + sh * 35, z + ch * 35);
        const score = Math.min(4, f) + Math.min(3, b) * 0.45;
        if (score > best) { best = score; heading = h; }
      }
      if (best < 2.2) continue;
      const p = { x, z, heading, region: regionAt(x, z).id }; fallback ||= p;
      if (Math.hypot(x - ax, z - az) < 760) return p;
    }
    return fallback || { x: ax, z: az, heading: 0, region: regionAt(ax, az).id };
  }

  makeRigs() {
    const wreck = buildSkiff({ crew: false }); recolor(wreck, 0xb18a2f); wreck.visible = false;
    if (wreck.userData.motor) wreck.userData.motor.rotation.x = -0.48;
    const wreckLamp = lamp(wreck, 0xffd56b, -0.28, 1.18, -0.25, 52);
    const oldMill = buildSkiff({ crew: true }); recolor(oldMill, 0x42677a); oldMill.visible = false;
    const oldLamp = lamp(oldMill, 0xf5dc91, 0, 1.25, -0.2, 54);
    const lostKey = buildSkiff({ crew: true }); recolor(lostKey, 0x3e2d27); lostKey.visible = false;
    const lostLamp = lamp(lostKey, 0x4e8fff, 0, 1.25, -0.2, 58);
    const box = controllerCase(); box.visible = false;
    return { wreck, wreckLamp, oldMill, oldLamp, lostKey, lostLamp, case: box, nav: channelLight() };
  }

  restore() {
    const stage = this.state.stage;
    this.rigs.wreck.visible = stage === 'search' || stage === 'choice' || stage === 'delivery';
    this.rigs.oldMill.visible = stage === 'delivery' && this.state.branch === 'local';
    this.rigs.lostKey.visible = stage === 'delivery' && this.state.branch === 'runner';
    this.rigs.nav.group.visible = stage === 'complete' && this.state.consequence;
    if (stage === 'search') { this.scene.add(this.rigs.case); this.rigs.case.visible = true; }
    else if (stage === 'choice' || stage === 'delivery') { this.boat.add(this.rigs.case); this.rigs.case.position.set(-0.72, 0.72, -1.35); this.rigs.case.rotation.set(0.03, -0.18, 0.02); this.rigs.case.visible = true; this.phys.loaded = Math.max(this.phys.loaded, 0.18); }
    else if (stage === 'complete' && this.state.ending) {
      const owner = this.state.ending === 'runner' ? this.rigs.lostKey : this.rigs.oldMill;
      owner.add(this.rigs.case); this.rigs.case.position.set(0.55, 0.68, -0.9); this.rigs.case.rotation.set(0, 0.2, 0); this.rigs.case.visible = false;
    } else this.rigs.case.visible = false;
    if (stage === 'delivery') {
      const d = this.destination(); this.routeStart = Math.max(1, Math.hypot(d.x - this.phys.pos.x, d.z - this.phys.pos.y));
      if (this.state.branch === 'runner') {
        const remaining = Math.max(0, (this.state.cargoUntil - Date.now()) / 1000);
        if (remaining > 0) {
          this.law.hotCargoT = Math.max(this.law.hotCargoT, remaining);
          this.law.attention = Math.max(this.law.attention, 1.2); this.law.lastReason = 'unmarked cargo reported in the channel';
        }
      }
    }
    this.configureNav();
    this.passage?.restore();
    this.stormLine?.restore();
  }

  configureNav() {
    const runner = this.state.ending === 'runner', color = runner ? 0xff493d : 0x65ff89;
    this.rigs.nav.beacon.mat.color.setHex(color); this.rigs.nav.beacon.light.color.setHex(color);
    const p = this.state.coords.search; this.rigs.nav.group.position.set(p.x, this.water.waveHeight(p.x, p.z, 0) - 0.08, p.z);
  }

  persist() { this.game.save.story = this.state; this.game.persist(); }
  busy() { return ['search', 'choice', 'delivery'].includes(this.state.stage) || Boolean(this.passage?.busy()) || Boolean(this.stormLine?.busy()) || Boolean(this.contracts?.blocking()); }
  blocking() { return this.busy(); }
  capturesInput(code) { return this.wantInput && (code === 'KeyE' || code === 'KeyF'); }

  canInteract() {
    return !this.game.state && !this.game.paused && !this.game.dockCamp && !this.game.dockJob && !this.game.atBoard && !this.condition.serviceHere && !this.encounters.active && !this.incidents.active;
  }

  setPrompt(html) {
    this.game.el.prompt.innerHTML = html; this.game.el.prompt.classList.add('on'); this.prompting = true; this.wantInput = true;
  }

  clearPrompt() {
    if (this.prompting) this.game.el.prompt.classList.remove('on'); this.prompting = false; this.wantInput = false;
  }

  call(channel, speaker, text, priority, key) {
    this.radio.transmit({ channel, speaker, text, priority, key: `story:${key}`, cooldown: 0 });
  }

  offer(force = false) {
    if (this.state.stage !== 'dormant' || (!force && (this.game.state || this.encounters.active || this.incidents.active))) return false;
    this.state.stage = 'search'; this.state.approached = false; this.restore(); this.persist();
    const cold = this.reputation.score('locals') <= -3;
    this.call('CH 68', 'LEON DOSS · OLD MILL', cold ? 'Tower Boat, this is work, not forgiveness. My yellow maintenance skiff came loose west of tower water. Red controller case should still be aboard.' : 'Tower Boat, Leon at Old Mill. My yellow maintenance skiff came loose west of tower water. Red controller case should still be aboard.', 2, 'offer-leon');
    this.call('CH 16', 'MARA KEENE · TOWER', 'I have Leon’s last radio fix. Putting the circle on your chart now.', 1, 'offer-mara');
    this.game.toast('Running Dark', 'Leon Doss put a last position on the chart.', 3.2); return true;
  }

  pickup() {
    if (this.state.stage !== 'search') return;
    this.state.stage = 'choice'; this.choiceT = 0; this.clearPrompt();
    this.boat.add(this.rigs.case); this.rigs.case.position.set(-0.72, 0.72, -1.35); this.rigs.case.rotation.set(0.03, -0.18, 0.02); this.rigs.case.visible = true;
    this.phys.loaded = Math.max(this.phys.loaded, 0.18); this.audio.pickup(); this.persist();
    this.call('CH 72', 'CAL ROOK · LOST KEY', 'Tower Boat, leave that red case alone. It belongs on Lost Key. Eight hundred for a quiet delivery.', 3, 'choice-cal');
    this.call('CH 68', 'LEON DOSS · OLD MILL', 'That controller belongs in the West Cut light. Bring it to Old Mill and I can mark that channel before dark.', 3, 'choice-leon');
    this.game.toast('Controller case aboard', 'Leon wants it back. Cal Rook is offering cash.', 3.2);
  }

  choose(branch) {
    if (this.state.stage !== 'choice') return;
    this.state.stage = 'delivery'; this.state.branch = branch; this.state.routeBand = this.routeBand = 0;
    const dest = this.destination(); this.routeStart = Math.hypot(dest.x - this.phys.pos.x, dest.z - this.phys.pos.y);
    this.rigs.oldMill.visible = branch === 'local'; this.rigs.lostKey.visible = branch === 'runner';
    if (branch === 'runner') {
      this.state.cargoUntil = Date.now() + 190000; this.law.addContraband();
      this.call('CH 72', 'CAL ROOK · LOST KEY', 'Stay off sixteen. Lost Key has a blue work light off the east dock.', 3, 'runner-start');
      this.game.toast('Lost Key', 'The controller is now unmarked cargo.', 2.8);
    } else {
      this.state.cargoUntil = 0;
      this.call('CH 68', 'LEON DOSS · OLD MILL', 'Copy Old Mill. Keep the latches up. Salt water gets inside, the west cut stays black another month.', 2, 'local-start');
      this.game.toast('Old Mill', 'Leon is waiting in a blue work skiff.', 2.8);
    }
    this.clearPrompt(); this.persist();
  }

  destination() { return this.state.branch === 'runner' ? this.state.coords.runner : this.state.coords.local; }

  finish() {
    if (this.state.stage !== 'delivery') return;
    const branch = this.state.branch, recipient = branch === 'runner' ? this.rigs.lostKey : this.rigs.oldMill;
    recipient.add(this.rigs.case); this.rigs.case.position.set(0.55, 0.68, -0.9); this.rigs.case.rotation.set(0, 0.2, 0); this.rigs.case.visible = true;
    const berth = this.destination(); this.startDeparture(recipient, berth, [this.rigs.case], branch === 'runner' ? 0.82 : 0.9);
    this.state.stage = 'complete'; this.state.ending = branch; this.state.completedAt = Date.now(); this.state.consequenceAt = Date.now() + 60000; this.state.consequence = false; this.state.cargoUntil = 0;
    this.rigs.wreck.visible = false; this.phys.loaded = 0; this.clearPrompt(); this.game.wpTarget = null;
    if (branch === 'runner') {
      this.game.addCash(800); this.reputation.change('runners', 1.4, 'running-dark-lost-key', 'You brought Cal Rook the missing channel controller.', true);
      this.reputation.change('locals', -0.55, 'running-dark-lost-key', 'Old Mill heard where the missing controller went.', false);
      this.law.hotCargoT = 0; this.law.cool(0.35);
      this.call('CH 72', 'CAL ROOK · LOST KEY', 'Case is dry. Eight hundred, as promised. Do not ask which marker is getting it.', 3, 'runner-finish');
      this.game.bountyToast('Lost Key delivery <b>+$800</b>');
    } else {
      this.game.addCash(425); this.reputation.change('locals', 1.3, 'running-dark-old-mill', 'You returned the controller that keeps West Cut marked.', true);
      this.reputation.change('fwc', 0.35, 'running-dark-old-mill', 'A navigation-safety controller was returned to service.', false);
      this.reputation.change('runners', -0.75, 'running-dark-old-mill', 'Cal Rook heard you took the controller to Old Mill.', false);
      this.call('CH 68', 'LEON DOSS · OLD MILL', 'I have it. Give me one tide and the West Cut light will work again.', 3, 'local-finish');
      this.game.bountyToast('Old Mill delivery <b>+$425</b>');
    }
    this.audio.complete(); this.persist();
  }

  triggerConsequence(force = false) {
    if (this.state.stage !== 'complete' || this.state.consequence || (!force && Date.now() < this.state.consequenceAt)) return false;
    this.state.consequence = true; this.configureNav(); this.rigs.nav.group.visible = true; this.passage?.arm(); this.persist();
    if (this.state.ending === 'runner') this.call('CH 16', 'MARA KEENE · TOWER', 'West Cut red is flashing out of sequence. Treat it as false until somebody can pull it.', 2, 'runner-aftermath');
    else this.call('CH 68', 'JUNE BELL · SPLIT PINE', 'West Cut green is flashing again. Leon says the tower boat gets the credit.', 2, 'local-aftermath');
    return true;
  }

  baseMarker() {
    const stage = this.state.stage, C = this.state.coords;
    if (stage === 'search') return { ...(this.state.approached ? { x: this.state.caseX, z: this.state.caseZ } : { x: C.search.x + 64, z: C.search.z - 42 }), color: '#e5c063', label: this.state.approached ? 'Leon’s controller case' : 'Leon’s last radio fix', story: true };
    if (stage === 'delivery') { const d = this.destination(); return { x: d.x, z: d.z, color: this.state.branch === 'runner' ? '#5b8fff' : '#e5c063', label: this.state.branch === 'runner' ? 'Lost Key handoff' : 'Old Mill handoff', story: true }; }
    if (stage === 'complete' && this.state.consequence) { const p = C.search; return { x: p.x, z: p.z, color: this.state.ending === 'runner' ? '#ff493d' : '#65ff89', label: this.state.ending === 'runner' ? 'unreliable West Cut light' : 'restored West Cut light', story: false }; }
    return null;
  }

  marker() {
    const storm = this.stormLine?.marker(); if (storm && (storm.story || this.stormLine.busy())) return storm;
    const passage = this.passage?.marker(); if (passage) return passage;
    return storm || this.baseMarker();
  }

  markers() {
    const out = [], add = m => {
      if (!m || out.some(q => Math.hypot(q.x - m.x, q.z - m.z) < 2 && q.label === m.label)) return;
      out.push(m);
    };
    add(this.marker());
    add(this.baseMarker());
    add(this.stormLine?.permanentMarker());
    for (const m of this.contracts?.markers() || []) add(m);
    return out;
  }

  menuLine() {
    const s = this.state;
    if (this.stormLine && (this.stormLine.state.stage !== 'dormant' || this.stormLine.eligible())) return this.stormLine.menuLine();
    if (this.passage && (this.passage.state.stage !== 'dormant' || (s.stage === 'complete' && s.consequence))) return this.passage.menuLine();
    if (s.stage === 'dormant') return 'Running Dark · not started';
    if (s.stage === 'search') return 'Running Dark · find Leon’s skiff';
    if (s.stage === 'choice') return 'Running Dark · controller case aboard';
    if (s.stage === 'delivery') return `Running Dark · bound for ${s.branch === 'runner' ? 'Lost Key' : 'Old Mill'}`;
    return `Running Dark · ${s.ending === 'runner' ? 'Lost Key paid' : 'West Cut marked'}`;
  }

  hud() {
    const storm = this.stormLine?.hud(); if (storm) return storm;
    const passage = this.passage?.hud(); if (passage) return passage;
    const contract = this.contracts?.hud(); if (contract) return contract;
    const s = this.state, mark = this.marker();
    if (!this.busy()) return null;
    if (s.stage === 'search') return { title: 'Running Dark', obj: s.approached ? 'Recover the red controller case' : 'Find Leon’s maintenance skiff', sub: `${regionAt((mark || s.coords.search).x, (mark || s.coords.search).z).name} · ${this.game.dist((mark || s.coords.search).x, (mark || s.coords.search).z) < 300 ? 'slow down and look for the yellow hull' : 'last radio fix on the chart'}` };
    if (s.stage === 'choice') return { title: 'Running Dark', obj: 'Who gets the controller?', sub: 'E · Old Mill restores the light  ·  F · Lost Key pays $800' };
    const d = this.destination(); return { title: 'Running Dark', obj: `Take the case to ${s.branch === 'runner' ? 'Lost Key' : 'Old Mill'}`, sub: `${regionAt(d.x, d.z).name} · arrive under 6 mph` };
  }

  updateCase(dt, t) {
    const C = this.state.coords.search, f = this.currents.flowAt(this.state.caseX, this.state.caseZ, this._flow);
    this.state.caseX += f.x * dt * 0.7; this.state.caseZ += f.y * dt * 0.7;
    const dx = C.x - this.state.caseX, dz = C.z - this.state.caseZ, d = Math.hypot(dx, dz);
    if (d > 19) { this.state.caseX += dx / d * (d - 19) * dt * 0.6; this.state.caseZ += dz / d * (d - 19) * dt * 0.6; }
    const q = this.rigs.case; q.position.set(this.state.caseX, this.water.waveHeight(this.state.caseX, this.state.caseZ, t) - 0.03, this.state.caseZ);
    q.rotation.set(Math.sin(t * 0.7) * 0.08, C.heading + 0.5, Math.cos(t * 0.9) * 0.12);
    this.persistT -= dt; if (this.persistT <= 0) { this.persistT = 6; this.persist(); }
  }

  placeBoat(mesh, point, t, lean = 0) {
    mesh.position.set(point.x, this.water.waveHeight(point.x, point.z, t) - 0.06, point.z);
    mesh.rotation.set(Math.sin(t * 0.55 + point.x) * 0.012, point.heading, lean + Math.cos(t * 0.48 + point.z) * 0.018, 'YXZ');
  }

  updateLights(t) {
    const h = this.environment.hour, night = h < 6.3 || h > 18.4;
    const wreckPulse = Math.floor(t * 1.45) % 3 === 0;
    this.rigs.wreckLamp.light.intensity = night && wreckPulse && this.rigs.wreck.visible ? 135 : 0;
    this.rigs.oldLamp.light.intensity = night && this.rigs.oldMill.visible ? 90 : 0; this.rigs.lostLamp.light.intensity = night && this.rigs.lostKey.visible ? 105 : 0;
    if (this.rigs.nav.group.visible) {
      const runner = this.state.ending === 'runner', phase = t % (runner ? 2.15 : 3.25);
      const on = runner ? (phase < 0.12 || (phase > 0.38 && phase < 0.48)) : phase < 0.18;
      this.rigs.nav.beacon.light.intensity = night && on ? 185 : 0; this.rigs.nav.beacon.bulb.scale.setScalar(on ? 1.9 : 1.35);
      const p = this.state.coords.search; this.rigs.nav.group.position.y = this.water.waveHeight(p.x, p.z, t) - 0.08; this.rigs.nav.group.rotation.z = Math.sin(t * 0.7) * 0.018;
    } else this.rigs.nav.beacon.light.intensity = 0;
  }

  obstacleAt(mesh, point, obstacle) {
    if (!mesh.visible || Math.hypot(point.x - this.phys.pos.x, point.z - this.phys.pos.y) > 82) return;
    const fx = -Math.sin(point.heading), fz = -Math.cos(point.heading);
    obstacle.ax = point.x + fx * 2.1; obstacle.az = point.z + fz * 2.1;
    obstacle.bx = point.x - fx * 2.1; obstacle.bz = point.z - fz * 2.1;
    this.obs.push(obstacle);
  }

  obstacleCase() {
    if (!this.rigs.case.visible || this.state.stage !== 'search' || Math.hypot(this.state.caseX - this.phys.pos.x, this.state.caseZ - this.phys.pos.y) > 82) return;
    this.caseObs.x = this.state.caseX; this.caseObs.z = this.state.caseZ; this.obs.push(this.caseObs);
  }

  updateSearch(dt, t) {
    const S = this.state, C = S.coords.search; this.updateCase(dt, t);
    this.placeBoat(this.rigs.wreck, C, t, 0.075);
    const d = Math.hypot(S.caseX - this.phys.pos.x, S.caseZ - this.phys.pos.y);
    if (!S.approached && d < 175) {
      S.approached = true; this.persist();
      this.call('CH 68', 'LEON DOSS · OLD MILL', 'That is her. Nobody aboard. The red case went over the stern.', 3, 'approach');
    }
    const m = this.marker(); this.game.wpTarget = m ? { x: m.x, z: m.z, label: m.label, color: m.color, story: true } : null;
    if (d < 11 && this.phys.speed * MPH < 6 && this.canInteract()) {
      this.setPrompt('<b>E</b> recover Leon’s red controller case'); if (this.interact) this.pickup();
    } else this.clearPrompt();
  }

  updateChoice(dt) {
    this.choiceT += dt; this.game.wpTarget = null;
    if (this.choiceT > 1.1 && this.canInteract()) {
      this.setPrompt('<b>E</b> take it to Old Mill <i>· F answer Cal Rook at Lost Key</i>');
      if (this.interact) this.choose('local'); else if (this.alternate) this.choose('runner');
    } else this.clearPrompt();
  }

  updateDelivery(dt, t) {
    const dest = this.destination(), mesh = this.state.branch === 'runner' ? this.rigs.lostKey : this.rigs.oldMill;
    this.placeBoat(mesh, dest, t); this.game.wpTarget = { x: dest.x, z: dest.z, label: this.state.branch === 'runner' ? 'Lost Key handoff' : 'Old Mill handoff', color: this.state.branch === 'runner' ? '#5b8fff' : '#e5c063', story: true };
    if (this.state.branch === 'runner' && this.state.cargoUntil) {
      const remaining = Math.max(0, (this.state.cargoUntil - Date.now()) / 1000);
      this.law.hotCargoT = remaining > 0 ? remaining : Math.min(this.law.hotCargoT, dt);
    }
    const d = Math.hypot(dest.x - this.phys.pos.x, dest.z - this.phys.pos.y), ratio = this.routeStart > 0 ? d / this.routeStart : 0;
    if (this.routeBand === 0 && ratio < 0.66) {
      this.state.routeBand = this.routeBand = 1; this.persist();
      if (this.state.branch === 'runner') this.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower Boat, keep your radio open. We have traffic about a missing navigation controller.', 3, 'runner-route-one');
      else this.call('CH 72', 'CAL ROOK · LOST KEY', 'Old Mill is the long way to make no money. Last offer.', 2, 'local-route-one');
    } else if (this.routeBand === 1 && ratio < 0.3) {
      this.state.routeBand = this.routeBand = 2; this.persist();
      this.call(this.state.branch === 'runner' ? 'CH 72' : 'CH 68', this.state.branch === 'runner' ? 'CAL ROOK · LOST KEY' : 'LEON DOSS · OLD MILL', this.state.branch === 'runner' ? 'Blue work light is mine. Come alongside slow.' : 'Blue skiff at Old Mill. Put the cage to idle before you come alongside.', 2, 'route-two');
    }
    if (d < 12 && this.phys.speed * MPH < 6 && this.canInteract()) {
      this.setPrompt(`<b>E</b> hand the controller to ${this.state.branch === 'runner' ? 'Cal Rook' : 'Leon Doss'}`); if (this.interact) this.finish();
    } else this.clearPrompt();
  }

  pushMarker() {
    for (const m of this.markers()) {
      const complete = !m.story;
      emitMapMarker(this.game, m.x, m.z, complete ? 'dot' : 'objective', m.color, 0, !complete);
    }
  }

  startDeparture(mesh, point, cargo = [], pitch = 0.86) {
    this.residents?.departed(mesh);
    this.departMesh = mesh; this.departCargo = cargo; this.departPitch = pitch; this.departPoint.x = point.x; this.departPoint.z = point.z; this.departPoint.heading = point.heading;
    this.departSpeed = 0; this.departT = 10; mesh.visible = true;
  }

  updateDeparture(dt, t) {
    const mesh = this.departMesh || (this.state.ending === 'runner' ? this.rigs.lostKey : this.rigs.oldMill), p = this.departPoint;
    this.departT -= dt; this.departSpeed += (6.6 - this.departSpeed) * (1 - Math.exp(-dt * 0.58));
    const flow = this.currents.flowAt(p.x, p.z, this._flow), fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    p.x += (fx * this.departSpeed + flow.x) * dt; p.z += (fz * this.departSpeed + flow.y) * dt; this.placeBoat(mesh, p, t, -0.012);
    if (this.departT <= 0) { mesh.visible = false; for (const cargo of this.departCargo) cargo.visible = false; this.departCargo.length = 0; this.departMesh = null; this.departSpeed = 0; }
  }

  updateAudio() {
    this.obLevel = 0; this.obPitch = this.state.branch === 'runner' ? 0.82 : 0.9;
    let x = 0, z = 0, speed = 0;
    if (this.state.stage === 'delivery') { const d = this.destination(); x = d.x; z = d.z; speed = 1.25; }
    else if (this.departT > 0) { x = this.departPoint.x; z = this.departPoint.z; speed = this.departSpeed; this.obPitch = this.departPitch; }
    if (speed > 0) { const d = Math.hypot(x - this.phys.pos.x, z - this.phys.pos.y); if (d < 145) this.obLevel = (0.16 + 0.56 * Math.min(1, speed / 6.6)) * (1 - d / 145); }
    this.passage?.updateAudio();
    if (this.passage && this.passage.obLevel > this.obLevel) { this.obLevel = this.passage.obLevel; this.obPitch = this.passage.obPitch; }
    this.stormLine?.updateAudio();
    if (this.stormLine && this.stormLine.obLevel > this.obLevel) { this.obLevel = this.stormLine.obLevel; this.obPitch = this.stormLine.obPitch; }
    this.contracts?.updateAudio();
    if (this.contracts && this.contracts.obLevel > this.obLevel) { this.obLevel = this.contracts.obLevel; this.obPitch = this.contracts.obPitch; }
  }

  wakeHeightAt(x, z, t) {
    let height = this.passage?.wakeHeightAt(x, z, t) || 0;
    height += this.stormLine?.wakeHeightAt(x, z, t) || 0;
    height += this.contracts?.wakeHeightAt(x, z, t) || 0;
    if (this.departT > 0 && this.departSpeed > 2.2) {
      const p = this.departPoint;
      height += wakeSampleAt(p.x, p.z, p.heading, this.departSpeed, 6.6, 0.09, x, z, t);
    }
    return clampWakeHeight(height, 0.28);
  }

  visitActiveVessels(visitor) {
    const passageAgent = this.passage?.agent;
    if (this.passage?.chaseActive && passageAgent?.active) visitor(passageAgent.x, passageAgent.z, passageAgent.speed, 'skiff');
    const stormAgents = this.stormLine?.agents;
    if (stormAgents) for (let i = 0; i < stormAgents.length; i++) {
      const agent = stormAgents[i]; if (agent.active) visitor(agent.x, agent.z, agent.speed, 'skiff');
    }
    const contractAgents = this.contracts?.agents;
    if (contractAgents) for (let i = 0; i < contractAgents.length; i++) {
      const agent = contractAgents[i]; if (agent.active) visitor(agent.x, agent.z, agent.speed, 'skiff');
    }
    if (this.departT > 0) visitor(this.departPoint.x, this.departPoint.z, this.departSpeed, 'skiff');
  }

  stamps(out) {
    this.passage?.stamps(out);
    this.stormLine?.stamps(out);
    this.contracts?.stamps(out);
    if (this.departT <= 0 || this.departSpeed < 1.8 || Math.hypot(this.departPoint.x - this.phys.pos.x, this.departPoint.z - this.phys.pos.y) > 95) return;
    const p = this.departPoint, fx = -Math.sin(p.heading), fz = -Math.cos(p.heading), sp = Math.min(1, this.departSpeed / 6.6);
    emitWakeStamp(out, p.x - fx * 1.8, p.z - fz * 1.8, 1.1, 0.5 * sp, 1.65 * sp, 1);
    emitWakeStamp(out, p.x + fx * 1.8, p.z + fz * 1.8, 1, -0.66 * sp, 0.1 * sp, 0.7);
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.obs.length = 0; this.wantInput = false; this.clock += enabled ? dt : 0;
    this.updateLights(t);
    if (!enabled) { this.interact = false; this.alternate = false; this.clearPrompt(); this.passage.update(dt, t, false); this.stormLine.update(dt, t, false); this.residents.update(dt, t, false); this.contracts.update(dt, t, false); this.updateAudio(); return; }
    const stage = this.state.stage;
    if (stage === 'dormant') {
      if (!this.game.state && !this.game.paused && !this.encounters.active && !this.incidents.active && this.environment.values.storm < 0.9) { this.offerT -= dt; if (this.offerT <= 0) this.offer(); }
    } else if (stage === 'search') this.updateSearch(dt, t);
    else if (stage === 'choice') this.updateChoice(dt);
    else if (stage === 'delivery') this.updateDelivery(dt, t);
    else if (stage === 'complete') {
      this.clearPrompt(); this.game.wpTarget = null;
      if (this.departT > 0) this.updateDeparture(dt, t);
      this.triggerConsequence(false);
      this.passage.update(dt, t, true);
      this.stormLine.update(dt, t, true);
    }
    this.residents.update(dt, t, true);
    this.contracts.update(dt, t, true);
    this.obstacleAt(this.rigs.wreck, this.state.coords.search, this.wreckObs); this.obstacleCase();
    if (this.state.branch) {
      const recipient = this.state.branch === 'runner' ? this.rigs.lostKey : this.rigs.oldMill;
      if (!this.stormLine.owns(recipient)) this.obstacleAt(recipient, this.state.stage === 'complete' && this.departT > 0 ? this.departPoint : this.destination(), this.recipientObs);
    }
    this.pushMarker(); this.updateAudio(); this.interact = false; this.alternate = false;
  }

  resetDebug() {
    const carryingRunnerCargo = this.state.stage === 'delivery' && this.state.branch === 'runner';
    this.clearPrompt(); this.obs.length = 0; this.rigs.wreck.visible = this.rigs.oldMill.visible = this.rigs.lostKey.visible = this.rigs.case.visible = this.rigs.nav.group.visible = false;
    this.state.stage = 'dormant'; this.state.branch = ''; this.state.ending = ''; this.state.approached = false; this.state.consequence = false; this.state.completedAt = 0; this.state.consequenceAt = 0; this.state.cargoUntil = 0; this.state.routeBand = 0;
    const C = this.state.coords.search; this.state.caseX = C.x + Math.cos(C.heading + 1.2) * 6; this.state.caseZ = C.z + Math.sin(C.heading + 1.2) * 6;
    this.phys.loaded = 0; this.offerT = 34; this.routeBand = 0; this.departT = 0; this.departSpeed = 0; this.departMesh = null; this.departCargo.length = 0; this.contracts?.resetDebug(); this.stormLine.resetDebug(); this.passage.resetDebug(); this.updateAudio();
    if (carryingRunnerCargo) { this.law.hotCargoT = 0; this.law.cool(Math.min(1.65, this.law.attention)); }
    this.persist();
  }
}
