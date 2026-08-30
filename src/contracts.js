import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { mulberry32 } from './noise.js';
import { WORLD_HALF } from './heightfield.js';
import { regionAt } from './regions.js';
import { fmtDist } from './game.js';
import { emitWakeStamp } from './wakestamps.js';
import { emitMapMarker } from './mapmarkers.js';
import { sampleVesselWake } from './wakefield.js';

const MPH = 2.23694;
const RESIDENTS = ['leon', 'june', 'cal'];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const hashName = id => id === 'leon' ? 0x1e0d : id === 'june' ? 0x6a4e : 0xca17;

function recolor(group, color) {
  let done = false;
  group.traverse(o => {
    if (done || !o.isMesh || !o.material?.color || o.material.metalness < 0.45) return;
    o.material = o.material.clone(); o.material.color.setHex(color); done = true;
  });
}

function signal(parent, color, x, y, z, range = 42) {
  const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.072, 9, 7), mat);
  const light = new THREE.PointLight(color, 0, range, 2); group.add(bulb, light);
  return { group, bulb, light, mat };
}

function serviceCase() {
  const g = new THREE.Group(); g.name = 'channel-light service battery';
  const shell = new THREE.MeshStandardMaterial({ color: 0xd2a532, roughness: 0.64, metalness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.74, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xaeb3ad, roughness: 0.36, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.52), shell); body.position.y = 0.22; g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.09, 0.56), shell); lid.position.y = 0.48; g.add(lid);
  for (const x of [-0.23, 0.23]) { const latch = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.045), metal); latch.position.set(x, 0.29, -0.285); g.add(latch); }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.026, 7, 18, Math.PI), dark); handle.position.set(0, 0.55, 0); handle.rotation.x = Math.PI / 2; g.add(handle);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return g;
}

function coldBox() {
  const g = new THREE.Group(); g.name = 'Split Pine cold-chain cooler';
  const blue = new THREE.MeshStandardMaterial({ color: 0x4f8295, roughness: 0.58, metalness: 0.03 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7e7df, roughness: 0.62, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252a28, roughness: 0.76, metalness: 0.24 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.49, 0.62), blue); body.position.y = 0.27; g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.13, 0.68), white); lid.position.y = 0.59; g.add(lid);
  for (const x of [-0.29, 0.29]) { const latch = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.18, 0.05), dark); latch.position.set(x, 0.39, -0.34); g.add(latch); }
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.018), white); crossV.position.set(0, 0.28, -0.322); g.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.018), white); crossH.position.set(0, 0.28, -0.323); g.add(crossH);
  const seal = new THREE.Mesh(new THREE.BoxGeometry(0.91, 0.035, 0.61), dark); seal.position.y = 0.505; g.add(seal);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return g;
}

function canvasParcel() {
  const g = new THREE.Group(); g.name = 'unmanifested canvas parcel';
  const wrap = new THREE.MeshStandardMaterial({ color: 0x74654f, roughness: 0.98, metalness: 0 });
  const cord = new THREE.MeshStandardMaterial({ color: 0xb8975b, roughness: 0.92, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.34, 0.52), wrap); body.position.y = 0.19; g.add(body);
  for (const rot of [0, Math.PI / 2]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.014, 6, 18), cord); band.scale.set(rot ? 1 : 1.42, rot ? 1.42 : 1, 1); band.rotation.set(Math.PI / 2, rot, 0); band.position.y = 0.2; g.add(band); }
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.14), new THREE.MeshStandardMaterial({ color: 0xc8b993, roughness: 0.9, side: THREE.DoubleSide })); tag.position.set(0.16, 0.372, -0.05); tag.rotation.x = -Math.PI / 2; g.add(tag);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return g;
}

function channelAid() {
  const g = new THREE.Group(); g.name = 'working channel aid';
  const steel = new THREE.MeshStandardMaterial({ color: 0x737b76, roughness: 0.52, metalness: 0.68 });
  const green = new THREE.MeshStandardMaterial({ color: 0x2d6847, roughness: 0.68, metalness: 0.08 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d5c8, roughness: 0.8, metalness: 0.02 });
  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.46, 16), white); float.position.y = 0.05; g.add(float);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.49, 0.54, 0.15, 16), green); stripe.position.y = 0.08; g.add(stripe);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 2.5, 8), steel); pole.position.y = 1.42; g.add(pole);
  const daymark = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.8), green); daymark.position.set(0, 1.65, 0); daymark.rotation.y = 0.12; g.add(daymark);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0x142d36, roughness: 0.32, metalness: 0.5 })); panel.position.set(0, 2.06, 0); panel.rotation.x = -0.32; g.add(panel);
  const beacon = signal(g, 0x54ff82, 0, 2.73, 0, 95); beacon.bulb.scale.setScalar(1.25);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return { group: g, beacon };
}

function makeAgent(mesh, role) {
  return {
    mesh, role, x: 0, z: 0, heading: 0, navHeading: 0, speed: 0, turn: 0, choice: 0, decisionT: 0,
    targetX: 0, targetZ: 0, safeX: 0, safeZ: 0, active: false, backing: false, shx: 0, shz: 0, groundT: 0,
    navigationLights: role === 'contract-patrol',
  };
}

function sanePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = finite(raw.x, NaN), z = finite(raw.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 80) return null;
  return { ...raw, x, z, heading: finite(raw.heading) };
}

function sanitizeOffer(raw) {
  if (!raw || !RESIDENTS.includes(raw.resident)) return null;
  const dest = sanePoint(raw.dest); if (!dest) return null;
  return {
    ...raw, id: String(raw.id || `${raw.resident}-saved`), resident: raw.resident, dest,
    createdMinutes: Math.max(0, finite(raw.createdMinutes)), expiresMinutes: Math.max(0, finite(raw.expiresMinutes)),
    reward: Math.max(0, Math.round(finite(raw.reward))), seed: finite(raw.seed) >>> 0, announced: Boolean(raw.announced),
  };
}

function sanitizeActive(raw) {
  const offer = sanitizeOffer(raw); if (!offer) return null;
  return {
    ...offer, ...raw, dest: offer.dest, stage: String(raw.stage || 'transit'), acceptedMinutes: Math.max(0, finite(raw.acceptedMinutes)),
    resolved: Boolean(raw.resolved), resolution: String(raw.resolution || ''), resolvedMinutes: Math.max(0, finite(raw.resolvedMinutes)),
    load: clamp(finite(raw.load), 0, 1.5), routeStart: Math.max(1, finite(raw.routeStart, 1)), serviceT: clamp(finite(raw.serviceT), 0, 20),
    cold: clamp(finite(raw.cold, 1)), seal: clamp(finite(raw.seal, 1)), deadlineMinutes: Math.max(0, finite(raw.deadlineMinutes)),
    lastMinutes: Math.max(0, finite(raw.lastMinutes)), cargoX: finite(raw.cargoX), cargoZ: finite(raw.cargoZ), cargoHeading: finite(raw.cargoHeading),
    patrolStage: String(raw.patrolStage || 'waiting'), patrolX: finite(raw.patrolX), patrolZ: finite(raw.patrolZ), patrolHeading: finite(raw.patrolHeading),
    patrolSpeed: Math.max(0, finite(raw.patrolSpeed)), inspectionT: Math.max(0, finite(raw.inspectionT)), captureT: Math.max(0, finite(raw.captureT)),
    evadeT: Math.max(0, finite(raw.evadeT)), runBonus: Boolean(raw.runBonus), warnedCold: Boolean(raw.warnedCold), warnedWarm: Boolean(raw.warnedWarm),
    recipientX: finite(raw.recipientX, offer.dest.x), recipientZ: finite(raw.recipientZ, offer.dest.z), recipientHeading: finite(raw.recipientHeading, offer.dest.heading),
    departX: finite(raw.departX), departZ: finite(raw.departZ), droppedMinutes: Math.max(0, finite(raw.droppedMinutes)),
  };
}

export class ResidentContracts {
  constructor(parent, residents) {
    this.P = parent; this.residents = residents;
    Object.assign(this, parent); // scene, terrain, world, water, phys, boat, game, audio, environment, currents, radio, law, reputation, condition, encounters, incidents
    const saved = this.game.save.residentContracts || {}, offers = {};
    for (const id of RESIDENTS) { const offer = sanitizeOffer(saved.offers?.[id]); if (offer) offers[id] = offer; }
    this.state = this.game.save.residentContracts = {
      version: 1, nextSerial: Math.max(1, Math.trunc(finite(saved.nextSerial, 1))), offers,
      cooldowns: Object.fromEntries(RESIDENTS.map(id => [id, Math.max(0, finite(saved.cooldowns?.[id]))])),
      active: sanitizeActive(saved.active),
      stats: { accepted: 0, completed: 0, failed: 0, leon: 0, june: 0, cal: 0, perfectCold: 0, seizures: 0, ...(saved.stats || {}) },
      notes: Array.isArray(saved.notes) ? saved.notes.map(n => ({ ...n, ...sanePoint(n), expiresMinutes: Math.max(0, finite(n.expiresMinutes)) })).filter(n => Number.isFinite(n.x)).slice(-6) : [],
    };
    this.rigs = this.makeRigs(); this.obs = []; this.phys.addObs('resident-contracts', this.obs);
    this.agents = [this.rigs.patrolAgent, this.rigs.receiverAgent]; this.agentPitches = [1.12, 0.84];
    this._flow = new THREE.Vector2(); this.enabled = false; this.prompting = false; this.nearOffer = null;
    this.persistT = 5; this.announceT = 7; this.hitCd = 0; this.obLevel = 0; this.obPitch = 1; this.obX = 0; this.obZ = 0;
    this.aidObs = { x: 0, z: 0, r: 0.7, tag: 'channel marker' };
    this.cargoObs = { x: 0, z: 0, r: 0.68, tag: 'cold-chain cooler' };
    this.receiverObs = this.boatObstacle(this.rigs.receiverAgent, 'runner work skiff');
    this.patrolObs = this.boatObstacle(this.rigs.patrolAgent, 'FWC patrol');
    this.restore(); this.game.contracts = this; this.radio.contracts = this;
  }

  makeRigs() {
    const service = serviceCase(), cold = coldBox(), parcel = canvasParcel(), aid = channelAid();
    const receiver = buildSkiff({ crew: true }); recolor(receiver, 0x3b2d28); receiver.name = 'contract recipient skiff'; receiver.visible = false;
    const receiverLamp = signal(receiver, 0x4e8fff, 0, 1.34, -0.2, 62);
    const patrol = buildSkiff({ crew: true }); recolor(patrol, 0x315c4e); patrol.name = 'FWC contract patrol'; patrol.visible = false;
    const blue = signal(patrol, 0x267cff, -0.28, 1.37, -0.18, 72), red = signal(patrol, 0xff382b, 0.28, 1.37, -0.18, 72);
    const search = new THREE.SpotLight(0xe9f3e4, 0, 115, 0.3, 0.68, 1.5); search.position.set(0, 1.5, -0.65);
    const searchTarget = new THREE.Object3D(); searchTarget.position.set(0, 0.1, -38); search.target = searchTarget; patrol.add(search, searchTarget);
    this.scene.add(service, cold, parcel, aid.group, receiver, patrol);
    return {
      service, cold, parcel, aid, receiver, receiverLamp, patrol, blue, red, search,
      receiverAgent: makeAgent(receiver, 'contract-recipient'), patrolAgent: makeAgent(patrol, 'contract-patrol'),
    };
  }

  entry(id) { return this.residents.entries.find(e => e.id === id); }
  coreBusy() { return ['search', 'choice', 'delivery'].includes(this.P.state.stage) || Boolean(this.P.passage?.busy()) || Boolean(this.P.stormLine?.busy()); }
  blocking() { return Boolean(this.state.active && !this.state.active.resolved); }
  capturesInput(code) { return (code === 'KeyE' || code === 'KeyF') && (this.prompting || this.blocking()); }

  persist() {
    const a = this.state.active;
    if (a?.resident === 'cal') {
      const p = this.rigs.patrolAgent, r = this.rigs.receiverAgent;
      if (p.active) Object.assign(a, { patrolX: p.x, patrolZ: p.z, patrolHeading: p.heading, patrolSpeed: p.speed });
      if (r.active) Object.assign(a, { recipientX: r.x, recipientZ: r.z, recipientHeading: r.heading });
    }
    this.game.save.residentContracts = this.state; this.game.persist();
  }

  clearPrompt() { if (this.prompting) this.P.clearPrompt(); this.prompting = false; this.nearOffer = null; }
  setPrompt(html) { this.P.setPrompt(html); this.prompting = true; }
  call(channel, speaker, text, priority, key) { this.radio.transmit({ channel, speaker, text, priority, key: `contract:${key}`, cooldown: 0 }); }

  eligible(id) {
    if (this.P.state.stage !== 'complete') return false;
    if (id === 'june' && this.P.passage.state.stage !== 'complete') return false;
    if (id === 'leon' && this.reputation.score('locals') <= -7) return false;
    if (id === 'june' && this.reputation.score('locals') <= -6) return false;
    if (id === 'cal' && this.reputation.score('runners') <= -6) return false;
    if (id === 'cal') { const h = this.environment.hour; if (!(h >= 18.2 || h < 4.8)) return false; }
    return true;
  }

  canInteract(active = false) {
    if (this.coreBusy() || this.game.state || this.game.paused || this.encounters.active || this.incidents.active) return false;
    const recovery = this.game.aftermath;
    if (recovery && (recovery.blocking() || recovery.interactiveNear)) return false;
    if (!active && (this.game.dockCamp || this.game.dockJob || this.game.atBoard || this.condition.serviceHere)) return false;
    return true;
  }

  safeWater(x, z) {
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 650 || this.world.blockedAt(x, z)) return false;
    const depth = this.water.level - this.terrain.heightAt(x, z), base = this.terrain.hf.computeBase(x, z);
    if (depth < 0.72 || depth > 6.2 || base.s < 0.34) return false;
    if (this.game.jobs?.some(j => Math.hypot(j.x - x, j.z - z) < 130)) return false;
    for (const entry of this.residents.entries) if (Math.hypot(entry.point.x - x, entry.point.z - z) < 150) return false;
    return true;
  }

  remoteWater(origin, seed, min = 1400, max = 3500) {
    const rr = mulberry32(seed >>> 0);
    for (let k = 0; k < 720; k++) {
      const a = rr() * Math.PI * 2, r = min + Math.sqrt(rr()) * (max - min), x = origin.x + Math.cos(a) * r, z = origin.z + Math.sin(a) * r;
      if (!this.safeWater(x, z)) continue;
      let heading = 0, best = -1e9;
      for (let i = 0; i < 16; i++) {
        const h = i / 16 * Math.PI * 2, fx = -Math.sin(h), fz = -Math.cos(h);
        const depths = [-70, -34, 34, 70].map(d => this.water.level - this.terrain.heightAt(x + fx * d, z + fz * d));
        if (Math.min(...depths) < 0.58) continue;
        const score = depths.reduce((sum, d) => sum + Math.min(4.2, d), 0);
        if (score > best) { best = score; heading = h; }
      }
      if (best > 4) return { x, z, heading, region: regionAt(x, z).id };
    }
    const a = (seed % 6283) / 1000, ax = clamp(origin.x + Math.cos(a) * min, -WORLD_HALF + 900, WORLD_HALF - 900), az = clamp(origin.z + Math.sin(a) * min, -WORLD_HALF + 900, WORLD_HALF - 900);
    return this.P.findWater(ax, az, seed ^ 0x8e91);
  }

  campDestination(origin, seed) {
    const rr = mulberry32(seed >>> 0);
    const camps = this.world.campsNear(origin.x, origin.z, 5600).filter(c => {
      const d = Math.hypot(c.tie.x - origin.x, c.tie.z - origin.z);
      return d > 1450 && d < 4100 && this.water.level - this.terrain.heightAt(c.tie.x, c.tie.z) > 0.62;
    });
    if (!camps.length) return null;
    camps.sort((a, b) => a.key.localeCompare(b.key)); const camp = camps[Math.floor(rr() * camps.length)];
    const dx = camp.tie.x - camp.bank.x, dz = camp.tie.z - camp.bank.z, l = Math.hypot(dx, dz) || 1;
    return {
      x: camp.tie.x, z: camp.tie.z, heading: Math.atan2(-dx / l, -dz / l), region: regionAt(camp.tie.x, camp.tie.z).id,
      campKey: camp.key, campName: camp.name, displayX: camp.bank.x + dx / l * 9.5, displayZ: camp.bank.z + dz / l * 9.5, displayY: 0.86,
    };
  }

  createOffer(id, force = false) {
    if (!RESIDENTS.includes(id) || this.state.offers[id] || (!force && !this.eligible(id))) return this.state.offers[id] || null;
    const entry = this.entry(id); if (!entry) return null;
    const serial = this.state.nextSerial++, seed = ((this.environment.day * 0x9e3779b1) ^ (serial * 0x85ebca6b) ^ hashName(id)) >>> 0;
    let dest = id === 'june' ? this.campDestination(entry.point, seed) : this.remoteWater(entry.point, seed, id === 'cal' ? 1800 : 1350, id === 'cal' ? 3900 : 3200);
    if (!dest) { this.state.cooldowns[id] = this.environment.minutes + 45; this.persist(); return null; }
    const rr = mulberry32(seed ^ 0x51ed), reward = id === 'leon' ? 365 + Math.floor(rr() * 8) * 5 : id === 'june' ? 545 + Math.floor(rr() * 10) * 5 : 715 + Math.floor(rr() * 12) * 5;
    if (id === 'leon') { dest.aid = 3 + Math.floor(rr() * 16); dest.label = `Cut ${dest.aid} green`; }
    if (id === 'cal') {
      const names = ['ELLIS VANE', 'MICAH ROWE', 'SILAS REED', 'TESS VALE', 'NOAH BRIGGS'];
      dest.recipient = names[Math.floor(rr() * names.length)]; dest.label = `${dest.recipient} · ${regionAt(dest.x, dest.z).name}`;
    }
    if (id === 'june') dest.label = dest.campName;
    const offer = {
      id: `${id}-${this.environment.day}-${serial}`, resident: id, seed, dest, reward, announced: force,
      createdMinutes: this.environment.minutes, expiresMinutes: this.environment.minutes + 900,
    };
    this.state.offers[id] = offer; this.persist(); return offer;
  }

  ensureOffers() {
    if (this.state.active || this.coreBusy() || this.game.state || this.environment.values.storm > 0.88) return;
    const now = this.environment.minutes;
    for (const id of RESIDENTS) {
      const offer = this.state.offers[id];
      if (offer && offer.expiresMinutes <= now) { delete this.state.offers[id]; this.state.cooldowns[id] = now + 180; this.persist(); continue; }
      const entry = this.entry(id);
      if (!offer && entry?.present && this.state.cooldowns[id] <= now && this.eligible(id)) this.createOffer(id);
    }
  }

  announceOffers(dt) {
    this.announceT -= dt; if (this.announceT > 0 || this.state.active || this.coreBusy()) return;
    const offer = RESIDENTS.map(id => this.state.offers[id]).find(o => o && !o.announced && this.entry(o.resident)?.present);
    if (!offer) { this.announceT = 7; return; }
    offer.announced = true; this.announceT = 15;
    if (offer.resident === 'leon') this.call('CH 68', 'LEON DOSS · OLD MILL', `Tower Boat, ${offer.dest.label} is dying under load. I have a battery if you are still taking channel work.`, 2, `offer:${offer.id}`);
    else if (offer.resident === 'june') this.call('CH 68', 'JUNE BELL · SPLIT PINE', `Tower Boat, I have a sealed cold box for ${offer.dest.campName}. It cannot sit in the sun and it cannot take a hard landing.`, 2, `offer:${offer.id}`);
    else this.call('CH 72', 'CAL ROOK · LOST KEY', `Seventy-two. Lost Key has an unmanifested parcel for ${regionAt(offer.dest.x, offer.dest.z).name}. Cash if the seal stays mine.`, 3, `offer:${offer.id}`);
    this.persist();
  }

  offerSummary(offer) {
    if (offer.resident === 'leon') return `service ${offer.dest.label} · $${offer.reward}`;
    if (offer.resident === 'june') return `cold-chain run to ${offer.dest.campName} · up to $${offer.reward}`;
    return `unmanifested handoff · $${offer.reward}`;
  }

  updateOfferInteraction() {
    if (this.state.active || !this.canInteract(false)) { this.clearPrompt(); return; }
    let nearest = null, best = 18;
    for (const id of RESIDENTS) {
      const offer = this.state.offers[id], entry = this.entry(id); if (!offer?.announced || !entry?.present) continue;
      const d = Math.hypot(entry.point.x - this.phys.pos.x, entry.point.z - this.phys.pos.y); if (d < best) { best = d; nearest = offer; }
    }
    this.nearOffer = nearest;
    if (!nearest || this.phys.speed * MPH >= 6) { this.clearPrompt(); return; }
    const entry = this.entry(nearest.resident);
    this.setPrompt(`<b>E</b> take ${entry.name.split(' ')[0]}’s work <i>· ${this.offerSummary(nearest)} · F pass</i>`);
    if (this.P.interact) this.accept(nearest); else if (this.P.alternate) this.decline(nearest);
  }

  decline(offer) {
    delete this.state.offers[offer.resident]; this.state.cooldowns[offer.resident] = this.environment.minutes + 240; this.clearPrompt();
    const entry = this.entry(offer.resident);
    this.call(entry.channel, `${entry.name} · ${entry.place}`, offer.resident === 'cal' ? 'Copy. The parcel will find another hull.' : 'Copy. I will keep asking the water.', 1, `decline:${offer.id}`);
    this.persist();
  }

  cargoFor(id) { return id === 'leon' ? this.rigs.service : id === 'june' ? this.rigs.cold : this.rigs.parcel; }
  attachCargoToBoat(a) {
    const cargo = this.cargoFor(a.resident); cargo.removeFromParent(); this.boat.add(cargo); cargo.visible = true;
    if (a.resident === 'leon') { cargo.position.set(-0.67, 0.69, -1.22); cargo.rotation.set(0.02, -0.18, 0.01); }
    else if (a.resident === 'june') { cargo.position.set(0.66, 0.67, -1.18); cargo.rotation.set(0.02, 0.15, -0.02); }
    else { cargo.position.set(-0.63, 0.66, -1.08); cargo.rotation.set(0.03, -0.24, 0.02); }
    this.phys.loaded = Math.max(this.phys.loaded, a.load);
  }

  releaseLoad(a) { this.phys.loaded = Math.max(0, this.phys.loaded - (a.load || 0)); }

  accept(offer) {
    if (this.state.active || !offer) return false;
    const distance = Math.hypot(offer.dest.x - this.phys.pos.x, offer.dest.z - this.phys.pos.y);
    const a = this.state.active = sanitizeActive({
      ...offer, stage: 'transit', acceptedMinutes: this.environment.minutes, resolved: false, resolution: '', resolvedMinutes: 0,
      load: offer.resident === 'june' ? 0.25 : offer.resident === 'leon' ? 0.18 : 0.16, routeStart: Math.max(1, distance),
      serviceT: 0, cold: 1, seal: 1, deadlineMinutes: offer.resident === 'june' ? this.environment.minutes + clamp(88 + distance * 0.019, 110, 170) : 0,
      lastMinutes: this.environment.minutes, cargoX: 0, cargoZ: 0, cargoHeading: 0, patrolStage: 'waiting', patrolX: 0, patrolZ: 0,
      patrolHeading: 0, patrolSpeed: 0, inspectionT: 0, captureT: 0, evadeT: 0, runBonus: false, warnedCold: false, warnedWarm: false,
      recipientX: offer.dest.x, recipientZ: offer.dest.z, recipientHeading: offer.dest.heading,
    });
    delete this.state.offers[offer.resident]; this.state.stats.accepted = (this.state.stats.accepted || 0) + 1;
    this.attachCargoToBoat(a); this.clearPrompt(); this.audio.pickup();
    if (a.resident === 'leon') {
      this.call('CH 68', 'LEON DOSS · OLD MILL', `Battery is live. ${a.dest.label} is on your chart. Tie off on the lee side and give the new unit a full cycle.`, 2, `start:${a.id}`);
      this.game.toast('Channel service aboard', `${a.dest.label} · keep the yellow case dry`, 3.1);
    } else if (a.resident === 'june') {
      this.call('CH 68', 'JUNE BELL · SPLIT PINE', `${a.dest.campName} is waiting at the dock. If the lid seal opens, call me before you call them.`, 2, `start:${a.id}`);
      this.game.toast('Cold box aboard', `${Math.ceil(a.deadlineMinutes - this.environment.minutes)} minutes on the cold window`, 3.1);
    } else {
      this.law.addContraband();
      this.call('CH 72', 'CAL ROOK · LOST KEY', `${a.dest.recipient} has one blue light in ${regionAt(a.dest.x, a.dest.z).name}. No names on sixteen.`, 3, `start:${a.id}`);
      this.game.toast('Unmanifested parcel aboard', 'FWC traffic can now identify the hull.', 3.1);
    }
    this.persist(); return true;
  }

  placeAid(a, t) {
    const q = this.rigs.aid, d = a.dest; q.group.visible = true;
    q.group.position.set(d.x, this.water.waveHeight(d.x, d.z, t) - 0.13, d.z);
    q.group.rotation.set(Math.sin(t * 0.72 + a.seed) * 0.025, d.heading, Math.cos(t * 0.61 + a.seed) * 0.035, 'YXZ');
    const night = this.environment.hour < 6.4 || this.environment.hour > 18.4;
    let lit = 0;
    if (a.resolved && a.resolution === 'serviced') lit = Math.floor(t * 0.82) % 4 === 0 ? 135 : 2;
    else if (a.stage === 'servicing') lit = Math.sin(t * 6.8) > 0.15 ? 55 : 0;
    else lit = Math.sin(t * 2.7 + Math.sin(t * 0.41) * 3) > 0.82 ? 18 : 0;
    q.beacon.light.intensity = night || a.stage === 'servicing' ? lit : lit * 0.18;
    q.beacon.bulb.scale.setScalar(0.85 + Math.min(1, lit / 90) * 0.65);
    if (Math.hypot(d.x - this.phys.pos.x, d.z - this.phys.pos.y) < 72) { this.aidObs.x = d.x; this.aidObs.z = d.z; this.obs.push(this.aidObs); }
  }

  updateLeon(a, dt, t) {
    this.placeAid(a, t); const d = Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y), mph = this.phys.speed * MPH;
    this.game.wpTarget = { x: a.dest.x, z: a.dest.z, label: a.dest.label, color: '#6fe08b', story: true, contract: true };
    if (a.stage === 'transit') {
      if (d < 10 && mph < 4.5 && this.canInteract(true)) {
        this.setPrompt(`<b>E</b> tie off and service ${a.dest.label}`);
        if (this.P.interact) { a.stage = 'servicing'; a.serviceT = 0; this.clearPrompt(); this.audio.checkpoint(); this.game.toast('Service cycle started', 'Hold inside 30 ft and under 3 mph.', 2.7); this.persist(); }
      } else this.clearPrompt();
    } else if (a.stage === 'servicing') {
      this.clearPrompt();
      const holding = d < 9.2 && mph < 3.3 && this.environment.values.storm < 0.94;
      a.serviceT = clamp(a.serviceT + dt * (holding ? 1 : -0.38), 0, 8);
      if (!holding && a.serviceT > 0.3 && this.hitCd <= 0) { this.hitCd = 3; this.game.toast(this.environment.values.storm >= 0.94 ? 'Service paused' : 'Line will not hold', this.environment.values.storm >= 0.94 ? 'Wait for the core wind to pass.' : 'Bring the stern back inside 30 ft.', 2.2); }
      if (a.serviceT >= 7.5) this.finishLeon(a);
    }
  }

  finishLeon(a) {
    const cargo = this.rigs.service; cargo.removeFromParent(); this.rigs.aid.group.add(cargo); cargo.position.set(0.46, 0.36, 0.15); cargo.rotation.set(0, 0.4, 0); cargo.visible = true;
    this.releaseLoad(a); this.game.addCash(a.reward);
    this.reputation.change('locals', 0.65, 'resident-light-service', `You put ${a.dest.label} back into service for Leon Doss.`, true);
    this.reputation.change('fwc', 0.45, 'resident-light-service', 'A failed channel aid was serviced before it became a navigation report.', false);
    this.state.notes.push({ x: a.dest.x, z: a.dest.z, heading: a.dest.heading, label: `${a.dest.label} serviced`, color: '#6fe08b', contract: true, expiresMinutes: this.environment.minutes + 4320 });
    if (this.state.notes.length > 6) this.state.notes.shift();
    this.call('CH 68', 'LEON DOSS · OLD MILL', 'I have the return flash. Green is clean and the load is steady. Money is on your tower account.', 3, `finish:${a.id}`);
    this.game.bountyToast(`Channel aid serviced <b>+$${a.reward}</b>`); this.audio.complete(); this.resolve(a, 'serviced', true);
  }

  coldDecay(a) {
    const now = this.environment.minutes, dm = clamp(now - a.lastMinutes, 0, 3); a.lastMinutes = now; if (dm <= 0) return;
    const solar = Math.max(0, Math.sin((this.environment.hour - 6) / 12 * Math.PI));
    const rain = clamp(finite(this.environment.values.rain)), storm = clamp(finite(this.environment.values.storm));
    const exposed = a.stage === 'overboard' ? 0.0026 : 0, late = now > a.deadlineMinutes ? 0.0028 : 0;
    a.cold = clamp(a.cold - dm * (0.00072 + solar * (0.00072 - rain * 0.00025) + exposed + (1 - a.seal) * 0.0016 + late));
    if (a.cold < 0.5 && !a.warnedCold) { a.warnedCold = true; this.audio.warn(); this.game.toast('Cold reserve falling', `${Math.round(a.cold * 100)}% · keep the lid sealed and get to ${a.dest.campName}`, 2.8); }
    if ((a.cold < 0.2 || now > a.deadlineMinutes + 30) && !a.warnedWarm) {
      a.warnedWarm = true; this.call('CH 68', 'JUNE BELL · SPLIT PINE', 'That box is outside the clean window. Get it onto the dock. They may still save part of the load.', 3, `warm:${a.id}`);
    }
    if (storm > 0.92 && a.stage === 'overboard') a.cold = Math.max(0, a.cold - dm * 0.0008);
  }

  dropColdBox(a, why) {
    if (a.stage === 'overboard') return;
    const q = this.rigs.cold; q.removeFromParent(); this.scene.add(q); a.stage = 'overboard'; a.cargoX = this.phys.pos.x; a.cargoZ = this.phys.pos.y; a.cargoHeading = this.phys.heading + 0.7; a.droppedMinutes = this.environment.minutes;
    q.position.set(a.cargoX, this.water.waveHeight(a.cargoX, a.cargoZ, 0), a.cargoZ); q.visible = true; this.releaseLoad(a);
    a.seal = clamp(a.seal - 0.12); a.cold = clamp(a.cold - 0.08); this.audio.warn();
    this.call('CH 68', 'JUNE BELL · SPLIT PINE', 'I saw the stop on the tracker. The box floats, but the drain plug is not a miracle. Get it back aboard.', 3, `overboard:${a.id}`);
    this.game.toast('Cold box overboard', why, 3); this.persist();
  }

  checkColdImpact(a) {
    this.hitCd = Math.max(0, this.hitCd);
    if (a.stage !== 'transit' || this.hitCd > 0) return;
    const force = Math.max(this.phys.hit, this.phys.impact);
    if (force < 4.8) return;
    this.hitCd = 2.4; const damage = clamp((force - 4.2) * 0.035, 0.04, 0.25);
    a.seal = clamp(a.seal - damage); a.cold = clamp(a.cold - damage * 0.18);
    if ((this.phys.wipeT > 0 && force > 6.7) || force > 10.2 || Math.abs(this.phys.roll) > 1.08) this.dropColdBox(a, 'The landing tore it off the deck. Turn back for the white lid.');
    else { this.audio.knock(0.24); this.game.toast('Cooler seal took a hit', `${Math.round(a.seal * 100)}% seal integrity`, 2.2); this.persistT = Math.min(this.persistT, 1); }
  }

  updateOverboard(a, dt, t) {
    const flow = this.currents.flowAt(a.cargoX, a.cargoZ, this._flow); a.cargoX += flow.x * dt * 0.82; a.cargoZ += flow.y * dt * 0.82;
    a.cargoX = clamp(a.cargoX, -WORLD_HALF + 100, WORLD_HALF - 100); a.cargoZ = clamp(a.cargoZ, -WORLD_HALF + 100, WORLD_HALF - 100);
    const q = this.rigs.cold; q.position.set(a.cargoX, this.water.waveHeight(a.cargoX, a.cargoZ, t) - 0.08, a.cargoZ); q.rotation.set(Math.sin(t * 0.93) * 0.09, a.cargoHeading, Math.cos(t * 0.78) * 0.13, 'YXZ'); q.visible = true;
    const d = Math.hypot(a.cargoX - this.phys.pos.x, a.cargoZ - this.phys.pos.y); this.game.wpTarget = { x: a.cargoX, z: a.cargoZ, label: 'cold box overboard', color: '#79bed2', story: true, contract: true };
    if (d < 70) { this.cargoObs.x = a.cargoX; this.cargoObs.z = a.cargoZ; this.obs.push(this.cargoObs); }
    if (d < 7.5 && this.phys.speed * MPH < 5 && this.canInteract(true)) {
      this.setPrompt('<b>E</b> lift June’s cold box back aboard');
      if (this.P.interact) { a.stage = 'transit'; a.seal = clamp(a.seal - 0.06); a.cold = clamp(a.cold - 0.04); this.attachCargoToBoat(a); this.clearPrompt(); this.audio.pickup(); this.game.toast('Cold box recovered', `${Math.round(a.cold * 100)}% cold · ${Math.round(a.seal * 100)}% seal`, 2.8); this.persist(); }
    } else this.clearPrompt();
  }

  updateJune(a, dt, t) {
    this.coldDecay(a); this.checkColdImpact(a);
    if (a.stage === 'overboard') { this.updateOverboard(a, dt, t); return; }
    const d = Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y);
    this.game.wpTarget = { x: a.dest.x, z: a.dest.z, label: a.dest.campName, color: '#79bed2', story: true, contract: true };
    if (d < 14 && this.phys.speed * MPH < 6 && this.canInteract(true)) {
      this.setPrompt(`<b>E</b> put June’s cold box on ${a.dest.campName} dock`); if (this.P.interact) this.finishJune(a);
    } else this.clearPrompt();
  }

  finishJune(a) {
    const quality = clamp(a.cold * 0.7 + a.seal * 0.3), good = quality >= 0.42;
    const reward = good ? Math.max(190, Math.round(a.reward * (0.58 + quality * 0.42) / 5) * 5) : 0;
    const q = this.rigs.cold; q.removeFromParent(); this.scene.add(q); q.position.set(a.dest.displayX, a.dest.displayY, a.dest.displayZ); q.rotation.set(0, a.dest.heading + Math.PI / 2, 0); q.visible = true; this.releaseLoad(a);
    if (good) {
      this.game.addCash(reward); this.reputation.change('locals', quality > 0.82 ? 0.9 : 0.55, 'resident-cold-chain', `June Bell’s cold box reached ${a.dest.campName} with the seal usable.`, true);
      this.reputation.change('fwc', 0.2, 'resident-cold-chain', 'A remote medical cold-chain load reached its logged camp.', false);
      if (quality > 0.88) this.state.stats.perfectCold = (this.state.stats.perfectCold || 0) + 1;
      this.call('CH 68', `${a.dest.campName.toUpperCase()} · DOCK`, quality > 0.82 ? 'Box is cold and both latches are clean. Tell June we have it.' : 'Box is here. Seal took work, but the load is still in range.', 2, `finish:${a.id}`);
      this.game.bountyToast(`Cold-chain delivery <b>+$${reward}</b>`); this.audio.complete(); this.resolve(a, 'delivered', true);
    } else {
      this.reputation.change('locals', -0.55, 'resident-cold-chain-spoiled', `The cold-chain load reached ${a.dest.campName} too warm to use.`, true);
      this.reputation.change('fwc', -0.15, 'resident-cold-chain-spoiled', 'A logged cold-chain load was written off after transport.', false);
      this.call('CH 68', `${a.dest.campName.toUpperCase()} · DOCK`, 'Temperature strip is black. We cannot use this. Call Split Pine.', 3, `spoiled:${a.id}`);
      this.game.toast('Cold load written off', 'No payment · the camp could not use it.', 3); this.audio.warn(); this.resolve(a, 'spoiled', false);
    }
  }

  placeReceiver(a, t) {
    const R = this.rigs, q = R.receiver, d = a.dest, moving = R.receiverAgent.active;
    q.visible = true;
    if (!moving) { q.position.set(d.x, this.water.waveHeight(d.x, d.z, t) - 0.05, d.z); q.rotation.set(Math.sin(t * 0.55 + a.seed) * 0.012, d.heading, Math.cos(t * 0.48 + a.seed) * 0.018, 'YXZ'); }
    const night = this.environment.hour < 6.2 || this.environment.hour > 18.5, pulse = 0.5 + Math.sin(t * 4.8) * 0.5;
    R.receiverLamp.light.intensity = night ? 12 + pulse * 68 : 2 + pulse * 8; R.receiverLamp.bulb.scale.setScalar(0.8 + pulse * 0.45);
    const x = moving ? R.receiverAgent.x : d.x, z = moving ? R.receiverAgent.z : d.z;
    if (Math.hypot(x - this.phys.pos.x, z - this.phys.pos.y) < 72) this.addBoatObstacle(R.receiverAgent, this.receiverObs, x, z, moving ? R.receiverAgent.heading : d.heading);
  }

  setAgent(A, x, z, heading, speed = 0) { this.incidents.setAgent(A, x, z, heading, speed); }

  spawnPatrol(a) {
    const at = this.incidents.spot(true); if (!at) return false;
    this.setAgent(this.rigs.patrolAgent, at.x, at.z, at.heading, 6.5); a.patrolStage = 'approach'; a.inspectionT = 0; a.captureT = 0; a.evadeT = 0;
    Object.assign(a, { patrolX: at.x, patrolZ: at.z, patrolHeading: at.heading, patrolSpeed: 6.5 });
    this.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower Boat, reduce speed and hold your line. We have a directed cargo check for that hull.', 4, `patrol:${a.id}`);
    this.game.toast('Directed FWC stop', 'Blue lights are working toward your wake.', 2.8); this.law.add(0.55, 'directed cargo check'); this.persist(); return true;
  }

  restoreAgent(A, a, patrol = true) {
    const x = patrol ? a.patrolX : a.recipientX, z = patrol ? a.patrolZ : a.recipientZ, h = patrol ? a.patrolHeading : a.recipientHeading, speed = patrol ? a.patrolSpeed : 0;
    this.setAgent(A, x, z, h, speed);
  }

  updatePatrolLights(t, searching = false) {
    const R = this.rigs, blink = Math.floor(t * (searching ? 5.6 : 2.6)) % 2;
    R.blue.light.intensity = blink ? 105 : 4; R.red.light.intensity = blink ? 4 : 105;
    const night = this.environment.hour < 6.2 || this.environment.hour > 19.1;
    R.search.intensity = searching && night ? 720 : 0;
  }

  beginRun(a) {
    if (a.patrolStage === 'pursuit') return;
    a.patrolStage = 'pursuit'; a.runBonus = true; a.captureT = 0; a.evadeT = 0; this.clearPrompt();
    this.law.setPursuit(true); this.law.add(0.85, 'failed to heave to for cargo inspection');
    this.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower Boat is refusing the stop. Twenty-seven is in pursuit. Clear the channel.', 4, `run:${a.id}`);
    this.game.toast('FWC pursuit', 'Lose the patrol in the cuts or make the blue-light handoff.', 3); this.persist();
  }

  makeDeparturePoint(x, z, heading, distance = 420) {
    for (const da of [0.35, -0.35, 0.75, -0.75, 1.2, -1.2]) {
      const h = heading + da, tx = x - Math.sin(h) * distance, tz = z - Math.cos(h) * distance;
      if (this.safeWater(tx, tz)) return { x: tx, z: tz };
    }
    return { x: clamp(x - Math.sin(heading) * 220, -WORLD_HALF + 120, WORLD_HALF - 120), z: clamp(z - Math.cos(heading) * 220, -WORLD_HALF + 120, WORLD_HALF - 120) };
  }

  patrolDepart(a) {
    const A = this.rigs.patrolAgent; if (!A.active) this.restoreAgent(A, a, true);
    const q = this.makeDeparturePoint(A.x, A.z, A.heading); a.departX = q.x; a.departZ = q.z; a.patrolStage = 'departing';
  }

  surrenderCal(a, forced = false) {
    const A = this.rigs.patrolAgent, q = this.rigs.parcel; q.removeFromParent(); this.rigs.patrol.add(q); q.position.set(0.52, 0.56, -0.85); q.rotation.set(0, -0.2, 0); q.visible = true; this.releaseLoad(a);
    this.law.hotCargoT = Math.max(this.law.hotCargoT, 1); this.law.confiscate(); this.law.setPursuit(false);
    this.reputation.change('fwc', forced ? -0.35 : 0.25, forced ? 'resident-cargo-seized' : 'resident-cargo-surrendered', forced ? 'FWC had to board the tower hull for the unmanifested parcel.' : 'You heaved to and surrendered an unmanifested parcel.', true);
    this.reputation.change('runners', forced ? -0.9 : -0.65, 'resident-cargo-lost', 'Cal Rook’s parcel went onto an FWC evidence boat.', false);
    this.state.stats.seizures = (this.state.stats.seizures || 0) + 1; this.patrolDepart(a);
    this.call('FWC TAC', 'WARDEN SOTO · FWC 27', forced ? 'Parcel is aboard Twenty-seven. Tower Boat will receive the citation by radio.' : 'Tower Boat is stopped. Parcel is aboard Twenty-seven. Resume normal traffic.', 3, `seize:${a.id}`);
    this.game.toast(forced ? 'Parcel seized' : 'Parcel surrendered', 'No payment · Cal will hear where it went.', 3); this.audio.warn(); this.resolve(a, forced ? 'seized' : 'surrendered', false);
  }

  finishCal(a) {
    const q = this.rigs.parcel; q.removeFromParent(); this.rigs.receiver.add(q); q.position.set(-0.5, 0.58, -0.82); q.rotation.set(0, 0.22, 0); q.visible = true; this.releaseLoad(a);
    const reward = a.reward + (a.runBonus ? 150 : 0); this.game.addCash(reward);
    this.reputation.change('runners', a.runBonus ? 1.25 : 0.85, 'resident-runner-handoff', `Cal Rook’s sealed parcel reached ${a.dest.recipient}.`, true);
    if (a.runBonus) this.reputation.change('fwc', -0.55, 'resident-runner-escape', 'The tower hull carried unmanifested cargo through a directed stop.', false);
    this.law.hotCargoT = 0; this.law.setPursuit(false); this.law.cool(a.runBonus ? 0.2 : 0.55);
    const R = this.rigs.receiverAgent; this.setAgent(R, a.dest.x, a.dest.z, a.dest.heading, 0.5); const out = this.makeDeparturePoint(a.dest.x, a.dest.z, a.dest.heading); a.departX = out.x; a.departZ = out.z;
    this.call('CH 72', `${a.dest.recipient} · ${regionAt(a.dest.x, a.dest.z).name.toUpperCase()}`, a.runBonus ? 'Seal is mine and Soto is not. Cal added the trouble money.' : 'Seal is clean. Cal’s number is good.', 3, `finish:${a.id}`);
    this.game.bountyToast(`Unmanifested handoff <b>+$${reward}</b>`); this.audio.complete(); this.resolve(a, 'delivered', true);
  }

  updateCalPatrol(a, dt, t) {
    const A = this.rigs.patrolAgent; if (!A.active && ['approach', 'inspection', 'pursuit', 'departing'].includes(a.patrolStage)) this.restoreAgent(A, a, true);
    if (!A.active) return;
    const d = Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y), severe = this.environment.values.storm > 0.96;
    if (severe && ['approach', 'inspection', 'pursuit'].includes(a.patrolStage)) {
      a.patrolStage = 'departing'; this.law.setPursuit(false); this.patrolDepart(a);
      this.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Twenty-seven is breaking off for weather. Tower Boat, this stop is not cleared; it is postponed.', 3, `weather-break:${a.id}`);
    }
    if (a.patrolStage === 'approach') {
      this.incidents.updateAgent(A, dt, t, this.phys.pos.x, this.phys.pos.y, 10.6, 24); this.updatePatrolLights(t, false);
      if (d < 52) { a.patrolStage = 'inspection'; a.inspectionT = 0; this.call('FWC TAC', 'WARDEN SOTO · FWC 27', 'Bring it under six knots and heave to. Keep both hands where I can see them.', 4, `inspection:${a.id}`); }
    } else if (a.patrolStage === 'inspection') {
      this.incidents.updateAgent(A, dt, t, this.phys.pos.x, this.phys.pos.y, 8.8, 20); this.updatePatrolLights(t, true); a.inspectionT += dt;
      if (d < 62 && this.canInteract(true)) {
        this.setPrompt('<b>E</b> heave to and surrender the parcel <i>· F hold the line and run</i>');
        if (this.P.interact) {
          if (this.phys.speed * MPH < 7) this.surrenderCal(a, false); else { this.audio.warn(); this.game.toast('Still making way', 'Come below 7 mph before Soto boards.', 1.8); }
        } else if (this.P.alternate) this.beginRun(a);
      }
      if (!a.resolved && ((a.inspectionT > 4 && this.phys.speed * MPH > 13) || d > 88)) this.beginRun(a);
    } else if (a.patrolStage === 'pursuit') {
      this.incidents.updateAgent(A, dt, t, this.phys.pos.x, this.phys.pos.y, 13.2, 5.5); this.updatePatrolLights(t, true);
      if (d > 360) a.evadeT += dt; else a.evadeT = Math.max(0, a.evadeT - dt * 0.5);
      if (d < 8.2) a.captureT += dt * (this.phys.speed * MPH < 12 ? 1.35 : 0.65); else a.captureT = Math.max(0, a.captureT - dt * 0.6);
      if (a.captureT > 4.3) { this.surrenderCal(a, true); return; }
      if (a.evadeT > 7) {
        a.patrolStage = 'departing'; this.law.setPursuit(false); this.patrolDepart(a);
        this.call('CH 72', 'CAL ROOK · LOST KEY', 'Twenty-seven lost your wake. Do not celebrate on the radio. Finish the run.', 3, `escaped:${a.id}`);
        this.game.toast('Patrol lost', 'The parcel is still hot until the handoff.', 2.8); this.persist();
      }
    } else if (a.patrolStage === 'departing') {
      this.incidents.updateAgent(A, dt, t, a.departX, a.departZ, 10.5, 4); this.updatePatrolLights(t, false);
      if (Math.hypot(A.x - a.departX, A.z - a.departZ) < 8 || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 900) { A.active = false; A.mesh.visible = false; this.rigs.blue.light.intensity = this.rigs.red.light.intensity = this.rigs.search.intensity = 0; }
    }
    if (A.active) { this.addBoatObstacle(A, this.patrolObs, A.x, A.z, A.heading); emitMapMarker(this.game, A.x, A.z, 'boat', '#5aa7ff', A.heading); }
  }

  updateCal(a, dt, t) {
    this.placeReceiver(a, t); this.law.hotCargoT = Math.max(this.law.hotCargoT, 2.5);
    const dTarget = Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y), ratio = dTarget / a.routeStart;
    this.game.wpTarget = { x: a.dest.x, z: a.dest.z, label: `${a.dest.recipient} handoff`, color: '#5b8fff', story: true, contract: true };
    if (a.patrolStage === 'waiting' && ratio < 0.72 && this.environment.minutes - a.acceptedMinutes > 5) this.spawnPatrol(a);
    if (dTarget < 13 && this.phys.speed * MPH < 6 && this.canInteract(true)) {
      this.setPrompt(`<b>E</b> hand the sealed parcel to ${a.dest.recipient}`); if (this.P.interact) { this.finishCal(a); return; }
    } else if (a.patrolStage !== 'inspection') this.clearPrompt();
    if (!a.resolved) this.updateCalPatrol(a, dt, t);
  }

  resolve(a, resolution, success) {
    a.resolved = true; a.resolution = resolution; a.resolvedMinutes = this.environment.minutes; this.clearPrompt();
    this.state.cooldowns[a.resident] = this.environment.minutes + (a.resident === 'leon' ? 1440 : a.resident === 'june' ? 960 : 720);
    this.state.stats[success ? 'completed' : 'failed'] = (this.state.stats[success ? 'completed' : 'failed'] || 0) + 1;
    if (success) this.state.stats[a.resident] = (this.state.stats[a.resident] || 0) + 1;
    if (this.game.wpTarget?.contract) this.game.wpTarget = null; this.persist();
  }

  updateResolved(a, dt, t) {
    this.clearPrompt();
    if (a.resident === 'leon') this.placeAid(a, t);
    else if (a.resident === 'cal') {
      if (a.resolution === 'delivered') {
        const R = this.rigs.receiverAgent; if (!R.active) this.restoreAgent(R, a, false);
        this.incidents.updateAgent(R, dt, t, a.departX, a.departZ, 7.8, 4); a.recipientX = R.x; a.recipientZ = R.z; a.recipientHeading = R.heading; this.placeReceiver(a, t);
        if (Math.hypot(R.x - a.departX, R.z - a.departZ) < 8) { R.active = false; R.mesh.visible = false; }
      } else if (this.rigs.patrolAgent.active || a.patrolStage === 'departing') this.updateCalPatrol(a, dt, t);
    }
    if (this.environment.minutes - a.resolvedMinutes > 12) this.clearResolved(a);
  }

  clearResolved(a) {
    for (const q of [this.rigs.service, this.rigs.cold, this.rigs.parcel]) { q.removeFromParent(); this.scene.add(q); q.visible = false; }
    this.rigs.aid.group.visible = false; this.rigs.receiver.visible = false; this.rigs.patrol.visible = false;
    this.rigs.receiverAgent.active = false; this.rigs.patrolAgent.active = false;
    this.rigs.receiverLamp.light.intensity = this.rigs.blue.light.intensity = this.rigs.red.light.intensity = this.rigs.search.intensity = 0;
    if (a.resident === 'cal') { this.law.setPursuit(false); this.law.hotCargoT = 0; }
    this.state.active = null; this.persist();
  }

  boatObstacle(A, tag) {
    return { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag, onHit: (into, nx, nz) => {
      if (A.active) { A.shx += -nx * into * 0.48; A.shz += -nz * into * 0.48; A.speed *= 0.58; }
      if (tag === 'FWC patrol' && into > 2.7 && this.hitCd <= 0) { this.hitCd = 4; this.law.violation(0.8, 'FWC vessel struck during cargo stop', true); }
    } };
  }

  addBoatObstacle(A, obstacle, x = A.x, z = A.z, heading = A.heading) {
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    obstacle.ax = x + fx * 2.1; obstacle.az = z + fz * 2.1; obstacle.bx = x - fx * 2.1; obstacle.bz = z - fz * 2.1; this.obs.push(obstacle);
  }

  restore() {
    const a = this.state.active; if (!a) return;
    if (!a.resolved || a.resident === 'leon') {
      if (a.resident === 'june' && a.stage === 'overboard') {
        const q = this.rigs.cold; q.removeFromParent(); this.scene.add(q); q.visible = true;
      } else if (!a.resolved) this.attachCargoToBoat(a);
    }
    if (a.resident === 'leon') this.rigs.aid.group.visible = true;
    if (a.resident === 'june' && a.resolved) { const q = this.rigs.cold; q.removeFromParent(); this.scene.add(q); q.position.set(a.dest.displayX, a.dest.displayY, a.dest.displayZ); q.rotation.y = a.dest.heading + Math.PI / 2; q.visible = true; }
    if (a.resident === 'cal') {
      this.rigs.receiver.visible = true;
      if (['approach', 'inspection', 'pursuit', 'departing'].includes(a.patrolStage) || ['surrendered', 'seized'].includes(a.resolution)) this.restoreAgent(this.rigs.patrolAgent, a, true);
      if (a.resolved && a.resolution === 'delivered') {
        this.restoreAgent(this.rigs.receiverAgent, a, false); const q = this.rigs.parcel; q.removeFromParent(); this.rigs.receiver.add(q); q.position.set(-0.5, 0.58, -0.82); q.rotation.set(0, 0.22, 0); q.visible = true;
      } else if (a.resolved) { const q = this.rigs.parcel; q.removeFromParent(); this.rigs.patrol.add(q); q.position.set(0.52, 0.56, -0.85); q.rotation.set(0, -0.2, 0); q.visible = true; }
      if (!a.resolved) { this.law.hotCargoT = Math.max(this.law.hotCargoT, 2.5); if (a.patrolStage === 'pursuit') this.law.setPursuit(true); }
    }
  }

  markers() {
    const out = [];
    for (const id of RESIDENTS) {
      const o = this.state.offers[id], e = this.entry(id); if (!o?.announced || !e?.present) continue;
      out.push({ x: e.point.x, z: e.point.z, color: e.color, label: `${e.name} · work available`, story: false, contract: true });
    }
    const a = this.state.active;
    if (a && !a.resolved) {
      if (a.resident === 'june' && a.stage === 'overboard') out.push({ x: a.cargoX, z: a.cargoZ, color: '#79bed2', label: 'cold box overboard', story: true, contract: true });
      else out.push({ x: a.dest.x, z: a.dest.z, color: a.resident === 'leon' ? '#6fe08b' : a.resident === 'june' ? '#79bed2' : '#5b8fff', label: a.resident === 'leon' ? a.dest.label : a.resident === 'june' ? a.dest.campName : `${a.dest.recipient} handoff`, story: true, contract: true });
    }
    for (const n of this.state.notes) out.push({ ...n, story: false, contract: true });
    return out;
  }

  hud() {
    const a = this.state.active; if (!a || a.resolved) return null;
    if (a.resident === 'leon') {
      if (a.stage === 'servicing') return { title: 'Leon Doss · Channel Work', obj: 'Hold station while the replacement cycles', sub: `${Math.round(a.serviceT / 7.5 * 100)}% · inside 30 ft · under 3 mph${this.environment.values.storm >= 0.94 ? ' · core wind has paused the work' : ''}` };
      return { title: 'Leon Doss · Channel Work', obj: `Carry the service battery to ${a.dest.label}`, sub: `${regionAt(a.dest.x, a.dest.z).name} · ${fmtDist(Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y))}` };
    }
    if (a.resident === 'june') {
      const left = Math.ceil(a.deadlineMinutes - this.environment.minutes), status = left >= 0 ? `${left} min cold window` : `${Math.abs(left)} min outside window`;
      if (a.stage === 'overboard') return { title: 'June Bell · Cold Chain', obj: 'Recover the cold box from the current', sub: `${Math.round(a.cold * 100)}% cold · ${Math.round(a.seal * 100)}% seal · ${fmtDist(Math.hypot(a.cargoX - this.phys.pos.x, a.cargoZ - this.phys.pos.y))}` };
      return { title: 'June Bell · Cold Chain', obj: `Deliver the sealed cooler to ${a.dest.campName}`, sub: `${Math.round(a.cold * 100)}% cold · ${Math.round(a.seal * 100)}% seal · ${status}` };
    }
    const patrol = this.rigs.patrolAgent, pd = patrol.active ? fmtDist(Math.hypot(patrol.x - this.phys.pos.x, patrol.z - this.phys.pos.y)) : '';
    if (a.patrolStage === 'inspection') return { title: 'Cal Rook · No Manifest', obj: 'FWC wants the hull stopped', sub: `${pd} · E heave to and surrender · F run` };
    if (a.patrolStage === 'pursuit') return { title: 'Cal Rook · No Manifest', obj: 'Lose FWC or reach the blue-light handoff', sub: `${pd} to patrol · ${fmtDist(Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y))} to ${a.dest.recipient}` };
    if (a.patrolStage === 'approach') return { title: 'Cal Rook · No Manifest', obj: `Get the parcel to ${a.dest.recipient}`, sub: `Directed FWC stop closing · ${pd}` };
    return { title: 'Cal Rook · No Manifest', obj: `Take the sealed parcel to ${a.dest.recipient}`, sub: `${regionAt(a.dest.x, a.dest.z).name} · ${fmtDist(Math.hypot(a.dest.x - this.phys.pos.x, a.dest.z - this.phys.pos.y))}` };
  }

  menuLine() {
    const s = this.state.stats, a = this.state.active;
    if (a && !a.resolved) return `active · ${a.resident === 'leon' ? 'channel service' : a.resident === 'june' ? 'cold-chain run' : 'unmanifested handoff'}`;
    return `${Number(s.completed) || 0} completed · ${Number(s.failed) || 0} lost · ${Number(s.perfectCold) || 0} clean cold-chain loads`;
  }

  updateAudio() {
    this.obLevel = 0; this.obPitch = 1; this.obX = 0; this.obZ = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const A = this.agents[i], pitch = this.agentPitches[i];
      if (!A.active) continue; const d = Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y);
      if (d < 155) { const level = (0.22 + 0.74 * Math.min(1, A.speed / 11)) * (1 - d / 155); if (level > this.obLevel) { this.obLevel = level; this.obPitch = pitch; this.obX = A.x; this.obZ = A.z; } }
    }
  }

  wakeHeightAt(x, z, t) { return sampleVesselWake(this.agents, x, z, t, 12.4, 0.105); }

  stamps(out) {
    for (const A of this.agents) {
      if (!A.active || A.speed < 2 || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 95) continue;
      const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 11);
      emitWakeStamp(out, A.x - fx * 1.8, A.z - fz * 1.8, 1.1, 0.5 * sp, 1.55 * sp, 1);
      emitWakeStamp(out, A.x + fx * 1.8, A.z + fz * 1.8, 1, -0.65 * sp, 0.1 * sp, 0.7);
    }
  }

  pruneNotes() {
    const before = this.state.notes.length; this.state.notes = this.state.notes.filter(n => n.expiresMinutes > this.environment.minutes);
    if (this.state.notes.length !== before) this.persist();
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.obs.length = 0; this.hitCd = Math.max(0, this.hitCd - dt);
    if (!enabled) { this.clearPrompt(); this.updateAudio(); return; }
    this.ensureOffers(); this.announceOffers(dt); const a = this.state.active;
    if (!a) this.updateOfferInteraction();
    else if (a.resolved) this.updateResolved(a, dt, t);
    else {
      this.phys.loaded = Math.max(this.phys.loaded, a.stage === 'overboard' ? 0 : a.load);
      if (a.resident === 'leon') this.updateLeon(a, dt, t); else if (a.resident === 'june') this.updateJune(a, dt, t); else this.updateCal(a, dt, t);
      this.persistT -= dt; if (this.persistT <= 0) { this.persistT = 5; this.persist(); }
    }
    this.pruneNotes(); this.updateAudio();
  }

  forceOffer(id) {
    delete this.state.offers[id]; this.state.cooldowns[id] = 0; const offer = this.createOffer(id, true); if (offer) { offer.announced = true; this.persist(); } return offer;
  }
  forceStart(id) { const offer = this.state.offers[id] || this.forceOffer(id); return offer ? this.accept(offer) : false; }
  resetDebug() {
    const a = this.state.active; if (a && !a.resolved && a.stage !== 'overboard') this.releaseLoad(a);
    this.law.setPursuit(false); this.law.hotCargoT = 0; this.clearPrompt();
    for (const q of [this.rigs.service, this.rigs.cold, this.rigs.parcel]) { q.removeFromParent(); this.scene.add(q); q.visible = false; }
    this.rigs.aid.group.visible = this.rigs.receiver.visible = this.rigs.patrol.visible = false; this.rigs.receiverAgent.active = this.rigs.patrolAgent.active = false;
    this.state.nextSerial = 1; this.state.offers = {}; this.state.cooldowns = { leon: 0, june: 0, cal: 0 }; this.state.active = null; this.state.notes = [];
    this.state.stats = { accepted: 0, completed: 0, failed: 0, leon: 0, june: 0, cal: 0, perfectCold: 0, seizures: 0 };
    if (this.game.wpTarget?.contract) this.game.wpTarget = null; this.persist();
  }
}
