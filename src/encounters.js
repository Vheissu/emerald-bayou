import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { person, animatePerson, wave } from './folk.js';
import { fuelDrum, wreck } from './markers.js';
import { mulberry32 } from './noise.js';
import { fmtDist } from './game.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const STEER_PROBES = [-0.65, -0.3, 0, 0.3, 0.65];
const DEBUG_ORDER = ['distress', 'patrol', 'smuggler', 'salvage', 'netline'];

function recolor(group, color) {
  let first = true;
  group.traverse(o => {
    if (!first || !o.isMesh || !o.material || !o.material.color || o.material.metalness < 0.5) return;
    o.material = o.material.clone(); o.material.color.setHex(color); first = false;
  });
}

function signalLight(parent, color, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const light = new THREE.PointLight(color, 0, 30, 2); g.add(bulb, light); parent.add(g);
  return { group: g, bulb, light };
}

function makePackage() {
  const g = new THREE.Group();
  const wrap = new THREE.MeshStandardMaterial({ color: 0x30423a, roughness: 0.9 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xc2a168, roughness: 1 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.65), wrap); b.castShadow = true; g.add(b);
  for (const x of [-0.27, 0.27]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.018, 5, 16), rope); r.rotation.y = Math.PI / 2; r.position.x = x; g.add(r); }
  return g;
}

function makeGillNet() {
  const root = new THREE.Group(); root.name = 'illegal monofilament net';
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4d5650, roughness: 0.92 });
  const netMat = new THREE.LineBasicMaterial({ color: 0xaab4aa, transparent: true, opacity: 0.46, depthWrite: false });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 22, 6), ropeMat);
  top.rotation.z = Math.PI / 2; top.position.y = 0.04; root.add(top);
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 22, 5), ropeMat);
  lead.rotation.z = Math.PI / 2; lead.position.y = -1.3; root.add(lead);

  const points = [];
  for (let i = 0; i <= 22; i++) {
    const x = -11 + i;
    points.push(x, 0.02, 0, x, -1.3, 0);
  }
  for (let i = 1; i < 7; i++) {
    const y = -i * 0.185;
    points.push(-11, y, 0, 11, y, 0);
  }
  const netGeo = new THREE.BufferGeometry(); netGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const net = new THREE.LineSegments(netGeo, netMat); net.renderOrder = 3; root.add(net);

  const floatGeo = new THREE.SphereGeometry(0.17, 9, 7);
  const floatMat = new THREE.MeshStandardMaterial({ color: 0xf0e7cf, roughness: 0.72, emissive: 0x21180b, emissiveIntensity: 0.16 });
  const floats = new THREE.InstancedMesh(floatGeo, floatMat, 12), matrix = new THREE.Matrix4(), color = new THREE.Color();
  for (let i = 0; i < 12; i++) {
    matrix.makeScale(i % 4 === 0 ? 1.18 : 0.9, 0.72, i % 4 === 0 ? 1.18 : 0.9); matrix.setPosition(-10.5 + i * 1.91, 0.1, 0); floats.setMatrixAt(i, matrix);
    floats.setColorAt(i, color.setHex(i === 2 || i === 9 ? 0xe9682e : i % 3 === 0 ? 0xd6c34d : 0xe8e4d7));
  }
  floats.instanceMatrix.needsUpdate = true; floats.instanceColor.needsUpdate = true; floats.castShadow = true; root.add(floats);

  const fishBody = new THREE.SphereGeometry(0.32, 8, 6), fishTail = new THREE.ConeGeometry(0.2, 0.38, 3);
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x788b87, roughness: 0.72, metalness: 0.12 });
  for (const [x, y, yaw] of [[-3.2, -0.48, 0.25], [4.4, -0.86, -0.4]]) {
    const fish = new THREE.Group(), body = new THREE.Mesh(fishBody, fishMat), tail = new THREE.Mesh(fishTail, fishMat);
    body.scale.set(1.45, 0.42, 0.68); tail.rotation.z = Math.PI / 2; tail.position.x = 0.55; fish.add(body, tail);
    fish.position.set(x, y, -0.03); fish.rotation.y = yaw; root.add(fish);
  }
  root.visible = false; root.userData.net = net; root.userData.floats = floats;
  return root;
}

function boatAgent(mesh) {
  return { mesh, x: 0, z: 0, heading: 0, speed: 0, want: 0, turn: 0, targetX: 0, targetZ: 0, decisionT: 0, active: false };
}

export class EncounterDirector {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, boat, game, audio, environment, plume, spray, law, reputation
    this.next = 48; this.active = null; this.seenT = 0; this.interact = false; this.alternate = false; this.enabled = false; this.debugIndex = 0;
    this.obs = []; this.boatObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'boat' }; this.fixedObs = { x: 0, z: 0, r: 2.1, tag: 'wreck' };
    this.netObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 0.32, tag: 'monofilament net', onHit: (into) => {
      const e = this.active; if (!e || e.type !== 'netline' || e.state === 'recovering' || e.state === 'secured' || e.hitCd > 0 || into < 1.8) return;
      e.hitCd = 3.5; e.snag = clamp((e.snag || 0) + into * 0.035, 0, 0.65);
      this.game.toast(into > 5 ? 'Monofilament across the hull' : 'Float line struck', into > 5 ? 'Back off. The net is pulling tight under the stern.' : 'There is a net stretched across the cut.', 2.8);
      if (into > 4.5) { this.audio.warn(); this.game.shake = Math.max(this.game.shake, 0.22); }
    } };
    this.phys.addObs('encounters', this.obs);
    this.rigs = this.makeRigs(); this.agents = [this.rigs.patrol.agent, this.rigs.smuggler.agent];
    this.keyHandler = e => {
      if (e.code === 'KeyE' && !e.repeat) this.interact = true;
      if (e.code === 'KeyF' && !e.repeat) this.alternate = true;
      if (import.meta.env.DEV && e.code === 'F9' && !e.repeat && this.enabled && !this.game.state) { e.preventDefault(); this.start(DEBUG_ORDER[this.debugIndex++ % DEBUG_ORDER.length], true); }
      if (import.meta.env.DEV && e.code === 'F10' && !e.repeat && this.enabled && this.active) { e.preventDefault(); this.debugApproach(); }
    };
    window.addEventListener('keydown', this.keyHandler);
    this.game.save.encounters ??= {};
    this.game.save.goodwill ??= 0;
    this._f = new THREE.Vector2(); this._r = new THREE.Vector2(); this._flow = new THREE.Vector2();
  }

  makeRigs() {
    const rr = mulberry32(7117);

    const distressBoat = buildSkiff({ crew: false }); distressBoat.visible = false; this.scene.add(distressBoat);
    const survivor = person(rr, { pose: 'stand', hat: true }); survivor.position.set(0, 0.5, -0.55); survivor.rotation.y = Math.PI; distressBoat.add(survivor);
    const passenger = person(rr, { pose: 'sit', hat: true, vest: true }); passenger.position.set(0.52, 1.08, -0.76); passenger.rotation.y = Math.PI; passenger.visible = false; this.boat.add(passenger);
    const flare = signalLight(distressBoat, 0xff3b20, 0, 3.2, -0.9);

    const patrolBoat = buildSkiff({ crew: true }); recolor(patrolBoat, 0x2d5c4b); patrolBoat.visible = false; this.scene.add(patrolBoat);
    const blue = signalLight(patrolBoat, 0x267cff, -0.25, 1.35, -0.2), red = signalLight(patrolBoat, 0xff2f25, 0.25, 1.35, -0.2);
    const patrol = { boat: patrolBoat, blue, red, agent: boatAgent(patrolBoat) };

    const smugglerBoat = buildSkiff({ crew: true }); recolor(smugglerBoat, 0x4b3527); smugglerBoat.visible = false; this.scene.add(smugglerBoat);
    const smuggler = { boat: smugglerBoat, agent: boatAgent(smugglerBoat), pack: makePackage() }; smuggler.pack.visible = false; this.scene.add(smuggler.pack);

    const salvage = { wreck: wreck(), drums: [fuelDrum(), fuelDrum(), fuelDrum()] };
    salvage.wreck.visible = false; this.scene.add(salvage.wreck);
    for (const d of salvage.drums) { d.visible = false; this.scene.add(d); }

    const netline = makeGillNet(); this.scene.add(netline);

    return { distress: { boat: distressBoat, survivor, passenger, flare }, patrol, smuggler, salvage, netline };
  }

  spot(min = 160, max = 300, sideMax = 170) {
    const p = this.phys, f = p.forward(this._f), r = p.right(this._r);
    for (let i = 0; i < 80; i++) {
      const ahead = min + Math.random() * (max - min), side = (Math.random() - 0.5) * sideMax * 2;
      const x = p.pos.x + f.x * ahead + r.x * side, z = p.pos.y + f.y * ahead + r.y * side;
      const h = this.terrain.heightAt(x, z); if (h > -1.05 || h < -5.5) continue;
      if (this.world && this.world.blockedAt(x, z)) continue;
      return { x, z, heading: Math.atan2(-f.x, -f.y) + (Math.random() - 0.5) * 1.2 };
    }
    return null;
  }

  pickType() {
    const weather = this.environment.key, night = this.environment.hour < 5.5 || this.environment.hour > 20.5;
    const heat = this.law ? this.law.attention : 0;
    const runners = this.reputation ? this.reputation.score('runners') : 0, fwc = this.reputation ? this.reputation.score('fwc') : 0;
    const region = this.regions && this.regions.current ? this.regions.current.encounters : {};
    const weights = { distress: 0.34, patrol: 0.25, salvage: 0.14, smuggler: 0.16, netline: 0.11 };
    weights.patrol *= (region.law ?? 1) * (1 + heat * 1.75) * (1 + Math.max(0, -fwc) * 0.16);
    weights.smuggler *= (region.runners ?? 1) * (night ? 1.9 : 1) * (1 + Math.max(0, -runners) * 0.2);
    weights.netline *= (0.72 + (region.runners ?? 1) * 0.38) * (night ? 1.24 : 1);
    weights.distress *= region.danger ?? 1;
    weights.salvage *= 0.7 + (region.danger ?? 1) * 0.45;
    if (weather === 'hurricane' || weather === 'tropical' || weather === 'thunderstorm') {
      weights.distress *= 1.8; weights.salvage *= 3.4; weights.patrol *= 0.18; weights.smuggler *= 0.12; weights.netline *= 0.28;
    } else if (weather === 'squall' || weather === 'hail') {
      weights.distress *= 1.4; weights.salvage *= 2; weights.patrol *= 0.55; weights.smuggler *= 0.45; weights.netline *= 0.62;
    }
    if (heat >= 3) weights.patrol *= 2.1;
    let roll = Math.random() * Object.values(weights).reduce((a, n) => a + n, 0);
    for (const type of ['distress', 'patrol', 'salvage', 'smuggler', 'netline']) { roll -= weights[type]; if (roll <= 0) return type; }
    return 'distress';
  }

  start(type = this.pickType(), nearby = false) {
    if (this.active) this.finish(false, true);
    const at = nearby ? this.spot(42, 62, 38) : this.spot(); if (!at) { this.next = 20; return false; }
    if (type === 'distress') this.startDistress(at);
    else if (type === 'patrol') this.startPatrol(at);
    else if (type === 'smuggler') this.startSmuggler(at);
    else if (type === 'netline') this.startNetline(at);
    else this.startSalvage(at);
    return true;
  }

  startDistress(at) {
    const R = this.rigs.distress; R.boat.visible = true; R.survivor.visible = true; R.passenger.visible = false;
    R.boat.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.05, at.z); R.boat.rotation.y = at.heading;
    wave(R.survivor);
    this.active = { type: 'distress', x: at.x, z: at.z, heading: at.heading, state: 'waiting', t: 0, hold: 0, known: false, leave: 0, recognized: Boolean(this.reputation && this.reputation.score('locals') >= 3) };
  }

  distressDrop(x, z) {
    const options = [], berth = (baseX, baseZ, name, preferred = 0) => {
      for (let i = 0; i < 16; i++) {
        const a = preferred + (i ? Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 8 : 0), r = 21 + (i % 3) * 3;
        const px = baseX + Math.cos(a) * r, pz = baseZ + Math.sin(a) * r;
        if (this.terrain.heightAt(px, pz) < -0.72 && !this.world.blockedAt(px, pz)) return { x: px, z: pz, name };
      }
      return { x: baseX, z: baseZ, name };
    };
    const nc = this.world.nearestCamp(x, z, 4200);
    if (nc) {
      const c = nc.camp, dx = c.tie.x - c.bank.x, dz = c.tie.z - c.bank.z;
      options.push(berth(c.tie.x, c.tie.z, c.name, Math.atan2(dz, dx)));
    }
    const home = this.game.dockTie;
    options.push(berth(home.x, home.z, 'tower dock', Math.atan2(home.z - z, home.x - x)));
    options.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return options[0];
  }

  boardDistress(e) {
    if (e.state !== 'waiting') return;
    const R = this.rigs.distress; e.state = 'aboard'; e.drop = this.distressDrop(e.x, e.z); e.boardedAt = e.t;
    R.survivor.visible = false; R.passenger.visible = true; this.clearPrompt(); this.audio.checkpoint();
    this.game.toast('Operator aboard', `Run him to ${e.drop.name}. Keep the front bench dry.`, 3.2);
  }

  startPatrol(at) {
    const A = this.rigs.patrol.agent; Object.assign(A, { x: at.x, z: at.z, heading: at.heading, speed: 4, want: 8, active: true });
    A.decisionT = 0; A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.y = A.heading;
    A.mesh.visible = true;
    const goodwill = Number(this.game.save.goodwill) || 0, fwcStanding = this.reputation ? this.reputation.score('fwc') : 0;
    this.active = {
      type: 'patrol', x: at.x, z: at.z, state: 'approach', t: 0, comply: 0, warned: false, pursuit: 0, known: false,
      wanted: Boolean((this.law && this.law.attention >= 1.2) || fwcStanding <= -4), recognized: fwcStanding >= 2 || goodwill >= 4,
    };
  }

  startSmuggler(at) {
    const R = this.rigs.smuggler; R.pack.visible = true; R.pack.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) + 0.05, at.z);
    const a = at.heading + Math.PI * 0.6, A = R.agent;
    Object.assign(A, { x: at.x + Math.cos(a) * 115, z: at.z + Math.sin(a) * 115, heading: at.heading, speed: 4, want: 6, active: true });
    A.decisionT = 0; A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.y = A.heading; A.mesh.visible = true;
    const standing = this.reputation ? this.reputation.score('runners') : 0;
    this.active = { type: 'smuggler', x: at.x, z: at.z, state: 'waiting', t: 0, known: false, chase: 0, originX: at.x, originZ: at.z, trusted: standing >= 3, hostile: standing <= -3 };
  }

  startSalvage(at) {
    const R = this.rigs.salvage; R.wreck.visible = true; R.wreck.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.35, at.z); R.wreck.rotation.y = at.heading;
    const pieces = [];
    for (let i = 0; i < R.drums.length; i++) {
      const a = at.heading + 0.8 + i * 2.1, r = 7 + i * 4, d = R.drums[i], x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      d.visible = true; d.position.set(x, this.water.waveHeight(x, z, 0) - 0.1, z); d.rotation.set(1.2, a, 0.2); pieces.push({ mesh: d, x, z, found: false, ph: i * 2.3 });
    }
    this.active = { type: 'salvage', x: at.x, z: at.z, state: 'waiting', t: 0, known: false, pieces, found: 0, ph: Math.random() * 6 };
  }

  startNetline(at) {
    const R = this.rigs.netline, rx = Math.cos(at.heading), rz = -Math.sin(at.heading), half = 11;
    R.visible = true; R.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) + 0.02, at.z); R.rotation.set(0, at.heading, 0); R.scale.set(1, 1, 1);
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.smuggler.boat.visible = false; this.rigs.smuggler.agent.active = false; this.rigs.smuggler.pack.visible = false;
    this.active = {
      type: 'netline', x: at.x, z: at.z, heading: at.heading, state: 'waiting', t: 0, known: false, choice: '',
      recoveryT: 0, resolveT: 0, hitCd: 0, snag: 0, ax: at.x - rx * half, az: at.z - rz * half, bx: at.x + rx * half, bz: at.z + rz * half,
    };
  }

  debugApproach() {
    const e = this.active, p = this.phys; if (!e) return;
    let target = e;
    if (e.type === 'patrol') target = this.rigs.patrol.agent;
    else if (e.type === 'smuggler' && e.state === 'chase') target = this.rigs.smuggler.agent;
    else if (e.type === 'salvage') target = e.pieces.find(q => !q.found) || e;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.y, d = Math.hypot(dx, dz) || 1;
    const gap = e.type === 'patrol' ? 18 : e.type === 'distress' ? 9 : e.type === 'smuggler' && e.state === 'waiting' ? 5 : e.type === 'netline' ? 15 : 0;
    const x = target.x - dx / d * gap, z = target.z - dz / d * gap;
    p.reset(x, z, p.heading); p.y = this.water.waveHeight(x, z, 0);
  }

  setPrompt(text) {
    if (this.game.dockCamp) return;
    this.game.el.prompt.innerHTML = `<b>E</b> ${text}`; this.game.el.prompt.classList.add('on'); this.prompting = true;
  }
  clearPrompt() { if (this.prompting && !this.game.dockCamp) this.game.el.prompt.classList.remove('on'); this.prompting = false; }

  point(x, z, label, color) {
    this.game.wpTarget = { x, z, label, color, encounter: true };
    this.game.el.wp.innerHTML = `${label} <b>${fmtDist(this.game.dist(x, z))}</b>`;
  }

  known(e, title, line) {
    if (e.known) return; e.known = true; this.audio.horn(0.18); this.game.toast(title, line, 3.2);
  }

  pay(amount, text) {
    this.game.addCash(amount); this.game.bountyToast(`${text} <b>${amount >= 0 ? '+' : '-'}$${Math.abs(amount)}</b>`);
  }
  goodwill(n, deed = 'People around the camps remember what you did.') {
    if (this.reputation) this.reputation.change('locals', n, 'bayou-help', deed, true);
    else { this.game.save.goodwill += n; this.game.persist(); }
  }

  complete(title, line, amount = 0, goodwill = 0, deed = '') {
    if (amount) this.pay(amount, title); else this.game.bountyToast(title);
    if (goodwill) this.goodwill(goodwill, deed || title);
    this.game.toast(title, line, 3.4);
    const type = this.active.type; this.game.save.encounters[type] = (this.game.save.encounters[type] || 0) + 1; this.game.persist();
    this.finish(true);
  }

  finish(success = false, silent = false) {
    const e = this.active; if (!e) return;
    this.clearPrompt(); this.obs.length = 0;
    this.rigs.distress.boat.visible = false;
    this.rigs.distress.survivor.visible = true; this.rigs.distress.passenger.visible = false;
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.smuggler.boat.visible = false; this.rigs.smuggler.agent.active = false; this.rigs.smuggler.pack.visible = false;
    this.rigs.salvage.wreck.visible = false; for (const d of this.rigs.salvage.drums) d.visible = false;
    this.rigs.netline.visible = false; this.rigs.netline.scale.set(1, 1, 1); this.rigs.netline.rotation.z = 0;
    if (this.law) this.law.setPursuit(false);
    if (this.game.wpTarget && this.game.wpTarget.encounter) this.game.wpTarget = null;
    this.active = null; this.next = success ? 100 + Math.random() * 110 : silent ? 60 : 75 + Math.random() * 90;
  }

  updateAgent(A, dt, t, targetX, targetZ, maxSpeed, holdRadius = 0) {
    if (!A.active) return;
    A.decisionT -= dt;
    if (A.decisionT <= 0) {
      A.decisionT = 0.1; A.targetX = targetX; A.targetZ = targetZ;
      // Three cheap probes keep pursuit boats in navigable water. Decisions run at 10 Hz; motion stays smooth at frame rate.
      let best = 0, score = -1e9;
      for (const da of STEER_PROBES) {
        const h = A.heading + da, x = A.x - Math.sin(h) * 24, z = A.z - Math.cos(h) * 24;
        const depth = -this.terrain.heightAt(x, z), toward = Math.hypot(targetX - x, targetZ - z);
        const s = Math.min(4, depth) - Math.abs(da) * 0.7 - toward * 0.006;
        if (depth > 0.55 && s > score) { score = s; best = da; }
      }
      A.choice = best;
    }
    const direct = Math.atan2(-(A.targetX - A.x), -(A.targetZ - A.z));
    let dh = Math.atan2(Math.sin(direct - A.heading), Math.cos(direct - A.heading)); dh += A.choice || 0;
    const turn = clamp(dh * 2.1, -1.35, 1.35), d = Math.hypot(A.targetX - A.x, A.targetZ - A.z);
    const want = maxSpeed * (holdRadius && d < holdRadius ? clamp(d / holdRadius, 0.05, 1) : 1) * (1 - Math.min(0.35, Math.abs(dh) * 0.22));
    A.speed += (want - A.speed) * (1 - Math.exp(-dt * (want > A.speed ? 0.7 : 2.4))); A.heading += turn * dt;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    const flow = this.currents ? this.currents.flowAt(A.x, A.z, this._flow) : null;
    A.x += (fx * A.speed + (flow ? flow.x : 0)) * dt; A.z += (fz * A.speed + (flow ? flow.y : 0)) * dt;
    const y = this.water.waveHeight(A.x, A.z, t); A.mesh.position.set(A.x, y - 0.05, A.z); A.mesh.rotation.set(A.speed * 0.005, A.heading, -turn * A.speed * 0.018, 'YXZ');
    if (A.mesh.userData.motor) { A.mesh.userData.motor.rotation.y = -turn * 0.35; A.mesh.userData.motor.userData.prop.rotation.z += dt * (6 + A.speed * 5); }
  }

  addBoatObstacle(A, tag = 'boat') {
    if (!A.active || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 70) return;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    const o = this.boatObs; o.ax = A.x + fx * 2; o.az = A.z + fz * 2; o.bx = A.x - fx * 2; o.bz = A.z - fz * 2; o.tag = tag; this.obs.push(o);
  }

  updateDistress(e, dt, t) {
    const R = this.rigs.distress;
    if (this.currents && e.state !== 'repair') { const f = this.currents.flowAt(e.x, e.z, this._flow); e.x += f.x * dt * 0.58; e.z += f.y * dt * 0.58; }
    const d = Math.hypot(e.x - this.phys.pos.x, e.z - this.phys.pos.y);
    R.boat.position.x = e.x; R.boat.position.z = e.z;
    R.boat.position.y = this.water.waveHeight(e.x, e.z, t) - 0.05; R.boat.rotation.z = Math.sin(t * 0.8) * 0.025;
    animatePerson(R.survivor, t, dt, { x: this.phys.pos.x, z: this.phys.pos.y });
    if (R.passenger.visible) animatePerson(R.passenger, t, dt);
    if (R.survivor.userData.waveT <= 0 && d < 130) wave(R.survivor);
    const pulse = 0.5 + 0.5 * Math.sin(t * 7); R.flare.light.intensity = 50 + pulse * 95; R.flare.bulb.scale.setScalar(0.7 + pulse * 0.8);
    if (d < 120) this.known(e, 'Distress flare', e.recognized ? 'He knows the hull and is waving you in.' : 'A skiff is dead in the water ahead.');
    if (e.known && e.state !== 'aboard') this.point(e.x, e.z, 'distress flare', '#ff5a36');
    if (d < 70 && R.boat.visible) { const o = this.boatObs; o.ax = e.x - Math.sin(e.heading) * 2; o.az = e.z - Math.cos(e.heading) * 2; o.bx = e.x + Math.sin(e.heading) * 2; o.bz = e.z + Math.cos(e.heading) * 2; o.tag = 'boat'; this.obs.push(o); }
    if (e.state === 'waiting' && d < 13 && this.phys.speed * MPH < 6 && this.canInteract()) {
      this.setPrompt('hold steady for a fuel-line repair <i>· F bring the operator aboard</i>');
      if (this.interact) { e.state = 'repair'; this.clearPrompt(); this.game.toast('Hold her steady', 'He is clearing the fuel line.', 2.4); }
      else if (this.alternate) this.boardDistress(e);
    }
    if (e.state === 'repair') {
      if (d < 15 && this.phys.speed * MPH < 7) e.hold += dt; else e.hold = Math.max(0, e.hold - dt * 1.5);
      if (e.hold >= 6) { this.audio.checkpoint(); if (this.law) this.law.cool(0.2); this.complete('Stranger helped', e.recognized ? 'Motor caught. He says the camps will hear about it.' : 'Motor caught. He owes you one.', 180, 1, 'You pulled a stranded skiff clear.'); }
    } else if (e.state === 'aboard') {
      if (d > 360) R.boat.visible = false;
      const q = e.drop, dd = Math.hypot(q.x - this.phys.pos.x, q.z - this.phys.pos.y);
      this.point(q.x, q.z, q.name, '#7be08a');
      if (dd < 13 && this.phys.speed * MPH < 5 && !this.game.dockJob && !this.game.atBoard) {
        this.setPrompt(`put the operator ashore at ${q.name}`);
        if (this.interact) {
          if (this.law) this.law.cool(0.3);
          this.complete('Safe berth reached', `${q.name} took him in. His skiff can wait for daylight.`, 275, 1.25, 'You carried a stranded operator to a safe berth.');
        }
      }
    }
  }

  updatePatrol(e, dt, t) {
    const A = this.rigs.patrol.agent, p = this.phys, d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y);
    const lead = 1.5, tx = p.pos.x + p.vel.x * lead, tz = p.pos.y + p.vel.y * lead;
    this.updateAgent(A, dt, t, tx, tz, e.state === 'pursuit' ? 11.5 : 8.4, e.state === 'check' ? 24 : 0); this.addBoatObstacle(A, 'patrol');
    const blink = Math.floor(t * 5) % 2; this.rigs.patrol.blue.light.intensity = blink ? 80 : 5; this.rigs.patrol.red.light.intensity = blink ? 5 : 80;
    if (d < 150) this.known(e, e.wanted ? 'FWC intercept' : 'FWC patrol', e.wanted ? 'They matched the hull. Idle and let them come alongside.' : 'Blue lights. They want the prop at idle.');
    if (e.known) this.point(A.x, A.z, 'FWC patrol', '#5aa7ff');
    if (e.state === 'approach' && d < 38) { e.state = 'check'; this.audio.horn(0.28); }
    if (e.state === 'check') {
      if (p.speed * MPH < 6) e.comply += dt; else e.comply = Math.max(0, e.comply - dt * 0.7);
      const goodwill = Number(this.game.save.goodwill) || 0;
      let checkTime = e.recognized ? 2.8 : goodwill <= -2 ? 6 : 4.5;
      if (this.reputation) checkTime = this.reputation.patrolCheckTime(checkTime);
      if (p.speed * MPH > (e.wanted ? 10 : 16) && d < 42) {
        e.state = 'pursuit'; e.pursuit = 24 + (this.law ? this.law.attention * 7 : 0);
        const fine = Math.round((100 + (this.law ? this.law.attention * 35 : 0)) * (this.reputation ? this.reputation.fineFactor() : 1));
        this.pay(-fine, 'FWC citation');
        if (this.law) { this.law.add(0.65, 'failure to stop', false); this.law.cited(); this.law.setPursuit(true); }
        this.game.toast('Failure to idle', 'The patrol is staying on you.', 3);
      } else if (e.comply > checkTime) {
        this.audio.checkpoint();
        if (this.law && this.law.confiscate()) {
          this.pay(-Math.round(200 * (this.reputation ? this.reputation.fineFactor() : 1)), 'Cargo seizure');
          this.complete('Cargo seized', 'FWC took the package and wrote the hull up.');
        } else {
          if (this.law) this.law.cleanCheck();
          this.complete('Patrol cleared you', e.recognized ? 'They know the hull. Keep it clean.' : 'Clean hull. Carry on.');
        }
        return;
      }
    } else if (e.state === 'pursuit') {
      if (this.law) this.law.setPursuit(true);
      e.pursuit -= dt;
      if (e.pursuit <= 0 || d > 360) {
        if (this.law) this.law.escaped();
        this.complete('Patrol broke off', 'The citation still stands. Their radio does not forget the hull.');
        return;
      }
    }
  }

  updateSmuggler(e, dt, t) {
    const R = this.rigs.smuggler, A = R.agent, p = this.phys;
    if (this.currents && e.state === 'waiting') { const f = this.currents.flowAt(e.x, e.z, this._flow); e.x += f.x * dt * 0.82; e.z += f.y * dt * 0.82; }
    const dp = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    if (R.pack.visible) { R.pack.position.set(e.x, this.water.waveHeight(e.x, e.z, t) + 0.08, e.z); R.pack.rotation.y += dt * 0.25; R.pack.rotation.z = Math.sin(t * 1.1) * 0.12; }
    if (e.state === 'waiting') this.updateAgent(A, dt, t, e.x + Math.sin(t * 0.12) * 45, e.z + Math.cos(t * 0.12) * 45, 5.2, 18);
    else this.updateAgent(A, dt, t, p.pos.x + p.vel.x * 0.8, p.pos.y + p.vel.y * 0.8, e.hostile ? 13.8 : 12.2, 0);
    this.addBoatObstacle(A, 'smuggler');
    if (dp < 105) this.known(e, e.hostile ? 'Backchannel bait' : 'Unmarked package', e.trusted ? 'The johnboat crew recognizes you. They are waiting for a signal.' : e.hostile ? 'They left it where this hull would find it.' : 'It was dropped in the channel. Somebody is watching it.');
    if (e.known && R.pack.visible) this.point(e.x, e.z, 'unmarked package', '#e5c063');
    if (e.state === 'waiting' && dp < 8 && p.speed * MPH < 8 && this.canInteract()) {
      this.setPrompt(`take the unmarked package <i>· F flag the johnboat</i>`);
      if (this.alternate) {
        this.clearPrompt(); R.pack.visible = false;
        if (this.reputation) this.reputation.change('runners', e.trusted ? 0.55 : 1, 'package-returned', 'You flagged the johnboat and left their package alone.', true);
        if (this.law) this.law.cool(0.2);
        this.audio.horn(0.16); this.complete('Package returned', e.trusted ? 'They nod once. The line stays open.' : 'The johnboat crew pays a finder’s cut.', e.trusted ? 140 : 90); return;
      }
      if (this.interact) {
        this.clearPrompt(); R.pack.visible = false; e.state = 'chase'; e.chase = e.hostile ? 52 : e.trusted ? 46 : 38; this.pay(260, 'Package taken');
        if (this.reputation) {
          this.reputation.change('runners', e.trusted ? -3 : -2, 'package-stolen', e.trusted ? 'You took a package after the backchannel vouched for the hull.' : 'You took a package the backchannel was watching.', true);
          this.reputation.change('locals', -0.35, 'package-stolen', 'Word of the channel theft reached the camps.', false);
        }
        if (this.law) this.law.addContraband();
        this.audio.warn(); this.game.toast(e.hostile ? 'They were waiting for you' : 'That was not abandoned', e.hostile ? 'The johnboat was already on the throttle.' : 'The johnboat is coming for it.', 3.2);
      }
    }
    if (e.state === 'chase') {
      e.chase -= dt; const d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y), run = Math.hypot(p.pos.x - e.originX, p.pos.y - e.originZ);
      this.point(A.x, A.z, 'johnboat', '#f05a36');
      if (d < 16 && !e.yelled) { e.yelled = true; this.game.toast(e.hostile ? '“Knew you would take it.”' : '“Put it back!”', 'The men in the johnboat', 2.2); }
      if (e.chase <= 0 || run > 340) this.complete('Lost the johnboat', 'The package is yours now. Whatever is in it.', 0, 0);
    }
  }

  updateSalvage(e, dt, t) {
    const R = this.rigs.salvage, p = this.phys, d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    R.wreck.position.y = this.water.waveHeight(e.x, e.z, t) - 0.35; R.wreck.rotation.z = Math.sin(t * 0.7 + e.ph) * 0.05;
    if (d < 130) this.known(e, 'Storm wreckage', 'Fuel drums are washing away from a sunken skiff.');
    if (e.known) this.point(e.x, e.z, 'storm wreckage', '#f3ede0');
    const o = this.fixedObs; o.x = e.x; o.z = e.z; o.r = 2.1; o.tag = 'wreck'; this.obs.push(o);
    for (const q of e.pieces) {
      if (q.found) continue;
      if (this.currents) { const f = this.currents.flowAt(q.x, q.z, this._flow); q.x += f.x * dt * 0.74; q.z += f.y * dt * 0.74; }
      q.mesh.position.y = this.water.waveHeight(q.x, q.z, t) - 0.1; q.mesh.rotation.z = 1.25 + Math.sin(t * 0.9 + q.ph) * 0.1;
      q.mesh.position.x = q.x; q.mesh.position.z = q.z;
      if (Math.hypot(q.x - p.pos.x, q.z - p.pos.y) < 4.5) {
        q.found = true; q.mesh.visible = false; e.found++; this.audio.pickup(); this.pay(45, `Fuel drum ${e.found} of ${e.pieces.length}`);
      }
    }
    if (e.found >= e.pieces.length) { if (this.law) this.law.cool(0.15); this.complete('Wreckage cleared', 'Three drums recovered before they split.', 140, 1, 'You cleared loose fuel drums out of the storm channel.'); }
  }

  beginNetRecovery(e, choice) {
    if (e.choice) return;
    e.choice = choice; e.state = choice === 'fwc' ? 'reported' : 'tipped'; e.recoveryT = 0; this.clearPrompt();
    const A = choice === 'fwc' ? this.rigs.patrol.agent : this.rigs.smuggler.agent;
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), side = choice === 'fwc' ? 1 : -1;
    let distance = 55;
    for (let candidate = 145; candidate >= 55; candidate -= 15) {
      const sx = e.x + fx * side * candidate, sz = e.z + fz * side * candidate;
      if (this.terrain.heightAt(sx, sz) < -0.65 && !this.world.blockedAt(sx, sz)) { distance = candidate; break; }
    }
    const x = e.x + fx * side * distance, z = e.z + fz * side * distance, heading = side > 0 ? e.heading + Math.PI : e.heading;
    Object.assign(A, { x, z, heading, speed: 4.2, want: 7.5, turn: 0, decisionT: 0, active: true });
    A.mesh.position.set(x, this.water.waveHeight(x, z, 0) - 0.05, z); A.mesh.rotation.set(0, heading, 0); A.mesh.visible = true;
    if (choice === 'fwc') {
      this.audio.checkpoint(); this.game.toast('Net position reported', 'FWC says leave the monofilament in place and hold clear.', 3.2);
    } else {
      this.audio.horn(0.16); this.game.toast('Backchannel tipped', 'A dark johnboat is coming to lift the net before FWC sees it.', 3.2);
    }
  }

  resolveNetline(e) {
    if (e.state === 'secured') return;
    e.state = 'secured'; e.resolveT = 5; this.rigs.netline.visible = false;
    if (e.choice === 'fwc') {
      this.pay(240, 'FWC net recovery');
      if (this.reputation) {
        this.reputation.change('fwc', 1.1, 'illegal-net', 'You held the illegal net in place until FWC could seize it.', true);
        this.reputation.change('locals', 0.55, 'illegal-net', 'The camps heard you got a killing net out of the cut.', false);
        this.reputation.change('runners', -0.7, 'illegal-net', 'The backchannel lost a set and knows who held the scene.', false);
      }
      if (this.law) this.law.cool(0.45);
      this.game.toast('Monofilament secured', 'Twenty-seven has the net and the entangled fish aboard.', 3.4);
    } else {
      this.pay(330, 'Backchannel recovery');
      if (this.reputation) {
        this.reputation.change('runners', 1.15, 'net-warning', 'You warned the net crew before FWC reached the cut.', true);
        this.reputation.change('locals', -0.45, 'net-warning', 'The illegal set went back aboard instead of into evidence.', false);
        this.reputation.change('fwc', -0.4, 'net-warning', 'FWC logged radio traffic around a vanished illegal set.', false);
      }
      if (this.law) this.law.add(0.45, 'illegal net crew tipped off', false);
      this.game.toast('Evidence gone', 'The johnboat hauled the line and left no floats behind.', 3.4);
    }
    this.game.save.encounters.netline = (this.game.save.encounters.netline || 0) + 1; this.game.persist();
  }

  updateNetline(e, dt, t) {
    const R = this.rigs.netline, p = this.phys, d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    e.hitCd = Math.max(0, e.hitCd - dt);
    R.position.y = this.water.waveHeight(e.x, e.z, t) + 0.02; R.rotation.z = Math.sin(t * 0.68 + e.heading) * (0.004 + this.environment.values.sea * 0.006);
    R.userData.net.material.opacity = 0.46 - e.snag * 0.18;
    if (d < 125) this.known(e, 'Illegal gill net', 'A monofilament wall is hanging from the float line. Fish are still hitting it.');
    if (e.known && e.state !== 'secured') this.point(e.x, e.z, 'illegal gill net', '#f06c38');

    if (e.state !== 'recovering' && e.state !== 'secured') {
      Object.assign(this.netObs, { ax: e.ax, az: e.az, bx: e.bx, bz: e.bz }); this.obs.push(this.netObs);
    }
    if (e.state === 'waiting') {
      if (d < 17 && p.speed * MPH < 7 && this.canInteract()) {
        this.setPrompt('report the illegal net to FWC <i>· F warn the crew on CH 72</i>');
        if (this.interact) this.beginNetRecovery(e, 'fwc'); else if (this.alternate) this.beginNetRecovery(e, 'runners');
      }
      return;
    }

    const A = e.choice === 'fwc' ? this.rigs.patrol.agent : this.rigs.smuggler.agent;
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), side = e.choice === 'fwc' ? 1 : -1;
    if (e.state === 'reported' || e.state === 'tipped') {
      const tx = e.x + fx * side * 14, tz = e.z + fz * side * 14;
      this.updateAgent(A, dt, t, tx, tz, e.choice === 'fwc' ? 8.7 : 9.6, 5);
      if (Math.hypot(A.x - tx, A.z - tz) < 7.5) { e.state = 'recovering'; e.recoveryT = 0; A.speed *= 0.2; }
    } else if (e.state === 'recovering') {
      e.recoveryT += dt; const tx = e.x + fx * side * 12, tz = e.z + fz * side * 12;
      this.updateAgent(A, dt, t, tx, tz, 1.2, 5);
      const k = clamp(e.recoveryT / 7); R.scale.x = Math.max(0.035, 1 - k * k * (3 - 2 * k));
      if (e.recoveryT >= 7) this.resolveNetline(e);
    } else if (e.state === 'secured') {
      e.resolveT -= dt; this.updateAgent(A, dt, t, e.x - fx * side * 240, e.z - fz * side * 240, e.choice === 'fwc' ? 7.8 : 10.2);
      if (e.resolveT <= 0) { this.finish(true); return; }
    }
    if (e.choice === 'fwc') {
      const blink = Math.floor(t * 5.2) % 2; this.rigs.patrol.blue.light.intensity = blink ? 86 : 4; this.rigs.patrol.red.light.intensity = blink ? 4 : 86;
    }
    this.addBoatObstacle(A, e.choice === 'fwc' ? 'patrol' : 'net crew');
  }

  canInteract() { return !this.game.dockCamp && !this.game.dockJob && !this.game.atBoard; }

  update(dt, t, enabled = true) {
    this.enabled = enabled;
    if (!enabled) { this.interact = false; this.alternate = false; return; }
    if (this.game.state) { if (this.active) this.finish(false, true); this.interact = false; this.alternate = false; return; }
    if (this.game.paused) { this.interact = false; this.alternate = false; return; }
    if (!this.active) { this.next -= dt; if (this.next <= 0) this.start(); this.interact = false; this.alternate = false; return; }
    const e = this.active; e.t += dt; this.obs.length = 0; this.clearPrompt();
    if (e.type === 'distress') this.updateDistress(e, dt, t);
    else if (e.type === 'patrol') this.updatePatrol(e, dt, t);
    else if (e.type === 'smuggler') this.updateSmuggler(e, dt, t);
    else if (e.type === 'netline') this.updateNetline(e, dt, t);
    else this.updateSalvage(e, dt, t);
    const carryingDistress = e.type === 'distress' && e.state === 'aboard';
    const focus = e.type === 'patrol' ? this.rigs.patrol.agent : e.type === 'smuggler' && e.state === 'chase' ? this.rigs.smuggler.agent : e;
    if (this.active && ((!carryingDistress && (e.t > 260 || Math.hypot(focus.x - this.phys.pos.x, focus.z - this.phys.pos.y) > 720)) || (carryingDistress && e.t > 600))) this.finish(false);
    this.interact = false; this.alternate = false;
  }

  stamps(out) {
    for (const A of this.agents) {
      if (!A.active || A.speed < 2 || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 85) continue;
      const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 11);
      out.push({ x: A.x - fx * 1.8, z: A.z - fz * 1.8, radius: 1.1, height: 0.5 * sp, foam: 1.6 * sp, foamRadius: 1 });
      out.push({ x: A.x + fx * 1.8, z: A.z + fz * 1.8, radius: 1, height: -0.65 * sp, foam: 0.1 * sp, foamRadius: 0.7 });
    }
  }
}
