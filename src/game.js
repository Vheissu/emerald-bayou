import * as THREE from 'three';
import { Beacon, crabFloat, kayak, fuelDrum, raceCase, wreck, shack } from './markers.js';
import { mulberry32 } from './noise.js';
import { WORLD_HALF } from './heightfield.js';
import { cargoEjectionReason, rampPoint, splitRemaining } from './raceformats.js';
import { emitMapMarker, MapMarkerPool } from './mapmarkers.js';

const SAVE_KEY = 'emeraldBayou.save.v2';
const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
const fmtCash = (c) => '$' + Math.round(c).toLocaleString('en-US');
const MPH = 2.23694;
const FT = 3.28084, MI = 1 / 1609.344;
const HULL_SAMPLES = [-2, 0, 1.6];
const MENU_TABS = ['jobs', 'world', 'records', 'system'];
const esc = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
// Florida measures in feet and miles: under about a fifth of a mile in feet, then miles
export const fmtDist = (m) => m < 300 ? `${Math.round(m * FT / 10) * 10} ft` : m < 16090 ? `${(m * MI).toFixed(m < 3219 ? 2 : 1)} mi` : `${Math.round(m * MI)} mi`;
const MEDALS = ['BRONZE', 'SILVER', 'GOLD'];
export const HUD_REFRESH_HZ = 12;
const HUD_REFRESH_INTERVAL = 1 / HUD_REFRESH_HZ;

export class Game {
  constructor(o) {
    Object.assign(this, o); // phys, T (terrain), scene, audio, tricks, manatees, gators, skiff, boat, dockTie, startX, startZ
    this.save = this.load();
    this.positionSaveT = 8;
    this.positionRestored = this.restoreBoatPosition();
    this.state = null; // active mission runtime
    this.paused = false; this.playing = false; this.inputLock = false; this.menuOpen = false; this.resultOpen = false;
    this.sel = 0; this.systemSel = 0; this.menuTab = 'jobs'; this.resetArmedUntil = 0; this.resetTimer = 0; this.persistenceDisabled = false;
    this.beacon = new Beacon(0xf07a2e, 5); this.beacon2 = new Beacon(0xf3ede0, 4.5); this.beacon2.uniforms.alpha.value = 0.35;
    this.scene.add(this.beacon.group, this.beacon2.group);
    this.el = {
      mission: document.getElementById('mission'), timer: document.getElementById('timer'), wp: document.getElementById('wp'),
      cash: document.getElementById('cash'), tricks: document.getElementById('tricks'), arrow: document.getElementById('arrow'),
      toast: document.getElementById('toast'), menu: document.getElementById('menu'), result: document.getElementById('result'), fade: document.getElementById('fade'),
      air: document.getElementById('airVal'), bounty: document.getElementById('bounty'), prompt: document.getElementById('prompt'), waterRule: document.getElementById('waterRule'),
    };
    this.nearCamp = null; this.nearTraps = []; this.scanT = 0; this.dockCamp = null; this.mapOpen = false; this.map = null;
    this.noWakeScan = { key: '', label: '', kind: '', d: Infinity, radius: 0, limit: 8, priority: 0, animal: null };
    this.noWakeOverT = 0; this.noWakeCooldown = 0; this.manateeWarnCooldown = 0; this.noWakeHudKey = '';
    this.toastT = 0; this.bountyT = 0; this.shake = 0; this.wpTarget = null; this.mapMarkers = []; this.mapMarkerPool = new MapMarkerPool(); this.hudT = 0;
    this.missions = buildMissions(this);
    this.jobs = this.buildJobs();
    this.bounties = new Bounties(this);
    if (this.world) for (const k of this.save.traps) this.world.collected.add(k);
    this.tricks.onEvent = (text, pts, kind, value) => { this.audio.trick(this.tricks.mult); this.bounties.event(kind, value, text); this.record(kind, value); };
    this.tricks.onBank = (pts, mult, n) => { this.audio.bank(); this.addCash(Math.round(pts / 40)); if (this.state && this.state.m.id === 'stunt') this.state.score += pts; this.bounties.event('bank', pts); this.record('bank', pts); this.record('chain', n); };
    this._v = new THREE.Vector3(); this._f = new THREE.Vector2();
    this.fx = null; // set by main: { thud(), splash() } hooks not needed; main reads phys
    window.addEventListener('keydown', e => this.onKey(e));
    this.pagehideHandler = () => this.persist();
    window.addEventListener('pagehide', this.pagehideHandler);
    this.renderHud();
  }
  load() {
    const fill = (s) => { s.rec = s.rec || {}; s.bounties = s.bounties || {}; s.camps = s.camps || []; s.seen = s.seen || []; s.traps = s.traps || []; s.nature = s.nature || {}; s.runs = s.runs || 0; return s; };
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.best) return fill(s); } catch (e) { /* ignore */ }
    // migrate the pass-3 save if there is one
    try { const s = JSON.parse(localStorage.getItem('emeraldBayou.save.v1')); if (s && s.best) return fill({ cash: s.cash || 0, best: s.best, done: s.done || [] }); } catch (e) { /* ignore */ }
    return fill({ cash: 0, best: {}, done: [] });
  }
  obstacleClearance(o, x, z) {
    if (!o || o.disabled || o.active === false) return Infinity;
    const r = Number.isFinite(Number(o.r)) ? Math.max(0, Number(o.r)) : 0;
    if ([o.ax, o.az, o.bx, o.bz].every(Number.isFinite)) {
      const dx = o.bx - o.ax, dz = o.bz - o.az, l2 = dx * dx + dz * dz;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / l2)) : 0;
      return Math.hypot(x - (o.ax + dx * u), z - (o.az + dz * u)) - r;
    }
    return Number.isFinite(o.x) && Number.isFinite(o.z) ? Math.hypot(x - o.x, z - o.z) - r : Infinity;
  }
  safeBoatPosition(x, z, live = false) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.max(Math.abs(x), Math.abs(z)) >= WORLD_HALF - 120) return false;
    // Always reload in permanent channel water, not on a storm-flooded bank that may be dry by the next save.
    if (!this.T || this.T.heightAt(x, z) >= -0.62 || (this.world && this.world.blockedAt(x, z))) return false;
    if (live && (this.phys.airborne || this.phys.wipeT > 0 || this.phys.wet < 0.48 || this.phys.landFac > 0.3)) return false;
    const lists = [this.phys.obstacles || []];
    if (live && this.phys.dyn) for (const list of this.phys.dyn.values()) lists.push(list || []);
    for (const list of lists) for (const o of list) if (this.obstacleClearance(o, x, z) < 3.1) return false;
    return true;
  }
  restoreBoatPosition() {
    const p = this.save.boatPosition;
    if (!p || typeof p !== 'object') return false;
    const x = Number(p.x), z = Number(p.z), heading = Number(p.heading);
    if (!Number.isFinite(heading) || !this.safeBoatPosition(x, z)) { delete this.save.boatPosition; return false; }
    this.phys.reset(x, z, Math.atan2(Math.sin(heading), Math.cos(heading)));
    return true;
  }
  hasProgress() {
    const s = this.save, rec = s.rec || {}, story = s.story || {}, incidents = s.incidents || {};
    const travelled = s.boatPosition && Math.hypot(Number(s.boatPosition.x) - this.startX, Number(s.boatPosition.z) - this.startZ) > 30;
    return Boolean(
      this.state || (s.done || []).length || Number(s.cash) || (s.camps || []).length || (s.traps || []).length || Number(s.runs)
      || Object.values(rec).some(value => Number(value) > 0)
      || Object.values(s.encounters || {}).some(value => Number(value) > 0)
      || Number(incidents.heard) || (s.reputation?.deeds || []).length
      || (s.discoveries?.found || []).length
      || (s.navigationAids?.reports || []).length
      || Number(s.fishing?.total)
      || (story.stage && story.stage !== 'dormant') || travelled
    );
  }
  newGameArmed() { return Date.now() < this.resetArmedUntil; }
  requestNewGame() {
    if (this.newGameArmed()) {
      this.persistenceDisabled = true;
      try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('emeraldBayou.save.v1'); } catch (error) { /* an unavailable store already has nothing durable to clear */ }
      location.reload(); return true;
    }
    this.resetArmedUntil = Date.now() + 6000;
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.newGameArmed()) return;
      this.resetArmedUntil = 0; if (this.menuOpen) this.renderMenu(); this.onResetArmed?.();
    }, 6100);
    if (this.menuOpen) this.renderMenu(); this.onResetArmed?.(); return false;
  }
  captureBoatPosition() {
    const p = this.phys;
    if (!p || !this.safeBoatPosition(p.pos.x, p.pos.y, true)) return false;
    this.save.boatPosition = {
      x: Math.round(p.pos.x * 1000) / 1000,
      z: Math.round(p.pos.y * 1000) / 1000,
      heading: Math.round(Math.atan2(Math.sin(p.heading), Math.cos(p.heading)) * 100000) / 100000,
      savedAt: Date.now(),
    };
    return true;
  }
  persist() { if (this.persistenceDisabled) return; this.captureBoatPosition(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* ignore */ } }
  addCash(n) { this.save.cash += n; this.persist(); }
  unlocked(i) { return i === 0 || this.save.done.includes(this.missions[i - 1].id) || this.save.done.includes(this.missions[i].id) || this.debugUnlock; }
  unlockAll() { this.debugUnlock = true; this.renderMenu(); }
  record(kind, value) {
    const r = this.save.rec; let changed = false;
    const up = (k, v) => { if (v > (r[k] || 0)) { r[k] = v; changed = true; } };
    if (kind === 'air') up('air', value); else if (kind === 'spin') up('spin', value); else if (kind === 'drift') up('drift', value); else if (kind === 'bank') up('bank', value); else if (kind === 'chain') up('chain', value);
    else if (kind === 'peak') up('peak', value); else if (kind === 'speed') up('speed', value); else if (kind === 'mud') up('mud', value);
    else if (kind === 'run') up('run', value); else if (kind === 'traps') up('traps', value);
    if (changed) this.persist();
  }

  // ---- helpers for missions ----
  dist(x, z) { return Math.hypot(this.phys.pos.x - x, this.phys.pos.y - z); }
  mph() { return this.phys.speed * MPH; }
  river(z, side = 0) { return { x: this.T.riverCenterX(z) + side * this.T.riverHalfWidth(z) * 0.45, z }; }
  headingTo(ax, az, bx, bz) { return Math.atan2(-(bx - ax), -(bz - az)); }
  toast(text, sub = '', dur = 2.6) { this.el.toast.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`; this.el.toast.classList.add('on'); this.toastT = dur; }
  bountyToast(text) { this.el.bounty.innerHTML = text; this.el.bounty.classList.add('on'); this.bountyT = 4; }
  fadeTo(fn) { this.el.fade.classList.add('on'); setTimeout(() => { fn(); setTimeout(() => this.el.fade.classList.remove('on'), 150); }, 420); }
  // find a pool / shallow spot with a seeded search
  findSpot(seed, zMin, zMax, hMin, hMax, offMin, offMax, extra) {
    const rr = mulberry32(seed); const T = this.T;
    for (let i = 0; i < 6000; i++) {
      const z = zMin + rr() * (zMax - zMin); const side = rr() < 0.5 ? -1 : 1;
      const x = T.riverCenterX(z) + side * (T.riverHalfWidth(z) + offMin + rr() * (offMax - offMin));
      const h = T.heightAt(x, z); if (h < hMin || h > hMax) continue;
      if (extra && !extra(x, z, h)) continue;
      return { x, z, h };
    }
    return { x: T.riverCenterX(zMin), z: zMin, h: -2 };
  }

  // ---- job posts: every mission has a place on the water where it starts; a ring marks it, E takes it ----
  buildJobs() {
    const ICON = { shakedown: ['S', '#f3ede0', 0xf3ede0], manatee: ['M', '#7be08a', 0x7be08a], sprint: ['flag', '#f07a2e', 0xf07a2e], traps: ['T', '#f07a2e', 0xf07a2e], chase: ['P', '#e0554a', 0xe0554a], stunt: ['star', '#e5c063', 0xe5c063], cargo: ['C', '#f3ede0', 0xf3ede0], rescue: ['R', '#7be08a', 0x7be08a], gator: ['G', '#7be08a', 0x7be08a], gauntlet: ['flag', '#f07a2e', 0xf07a2e], sonar: ['W', '#8fb8d8', 0x8fb8d8], bigair: ['star', '#e5c063', 0xe5c063], tour: ['flag', '#f07a2e', 0xf07a2e], splits: ['flag', '#f07a2e', 0xf07a2e], rampcircuit: ['star', '#e5c063', 0xe5c063], relay: ['D', '#8fb8d8', 0x8fb8d8] };
    const posts = [];
    for (const [i, m] of this.missions.entries()) {
      const st = m.start(this); let x = st.x, z = st.z, n = 0;
      while (posts.some(p => Math.hypot(p.x - x, p.z - z) < 20)) { n++; const row = Math.ceil(n / 2); z = st.z - 52 * row; x = this.T.riverCenterX(z) + (n % 2 ? -1 : 1) * this.T.riverHalfWidth(z) * 0.42; }
      const [glyph, color, hex] = ICON[m.id] || ['J', '#f3ede0', 0xf3ede0];
      const beacon = new Beacon(hex, 2.6, 20); beacon.uniforms.alpha.value = 0.5; this.scene.add(beacon.group);
      posts.push({ i, m, x, z, y: Math.max(0, this.T.heightAt(x, z)) + 0.05, glyph, color, hex, beacon });
    }
    return posts;
  }
  // ---- mission lifecycle ----
  start(i) { this.startMission(this.missions[i]); }
  startMission(m) {
    this.closeMenu(); this.closeResult(); this.closeMap();
    this.fadeTo(() => {
      if (this.state) this.end(false, true);
      this.tricks.bust(''); this.tricks.session = 0;
      const st = m.start(this);
      this.phys.reset(st.x, st.z, st.heading);
      this.phys.loaded = 0; this.phys.towDrag = 0;
      this.state = { m, t: 0, phase: 0, score: 0, done: false, cd: m.countdown ? 3.999 : 0, strikes: 0 };
      m.setup(this.state, this);
      this.inputLock = !!m.countdown;
      this.toast(m.title, m.desc, 3.2);
      this.renderHud();
    });
  }
  medalFor(m, s) {
    if (m.gold) { const t = s.t; return t <= m.gold ? 'GOLD' : t <= m.silver ? 'SILVER' : t <= m.bronze ? 'BRONZE' : ''; }
    if (m.scoreMedal) { const v = s.score; return v >= m.scoreMedal[0] ? 'GOLD' : v >= m.scoreMedal[1] ? 'SILVER' : v >= m.scoreMedal[2] ? 'BRONZE' : ''; }
    return '';
  }
  end(success, silent = false) {
    const s = this.state; if (!s) return;
    s.m.cleanup && s.m.cleanup(s, this);
    this.beacon.hide(); this.beacon2.hide(); this.wpTarget = null; this.phys.loaded = 0; this.phys.towDrag = 0;
    this.state = null; this.inputLock = false;
    if (silent) return;
    const m = s.m; const lines = [];
    if (success) {
      const time = s.t; const best = this.save.best[m.id] || {};
      const medal = this.medalFor(m, s);
      lines.push(`Time <b>${fmtT(time)}</b>${medal ? ` &nbsp;·&nbsp; <b>${medal}</b>` : ''}`);
      if (m.scoreMedal || m.id === 'stunt') lines.push(`${m.scoreLabel || 'Style score'} <b>${s.score.toLocaleString()}</b>`);
      const first = !this.save.done.includes(m.id);
      const rewardK = s.rewardK === undefined ? 1 : s.rewardK;
      const reward = Math.round((first ? m.reward : m.reward * 0.35) * rewardK);
      lines.push(`${first ? 'Reward' : 'Repeat bonus'} <b>${fmtCash(reward)}</b>${rewardK < 1 ? ` <i>(${Math.round(rewardK * 100)}% of the load)</i>` : ''}`);
      if (m.scoreMedal || m.id === 'stunt') { if (!best.score || s.score > best.score) { best.score = s.score; if (this.save.best[m.id]) lines.push('New best score'); } }
      else if (!best.time || time < best.time) { best.time = time; if (this.save.best[m.id]) lines.push('New best time'); }
      if (medal && (!best.medal || MEDALS.indexOf(medal) > MEDALS.indexOf(best.medal))) best.medal = medal;
      this.save.best[m.id] = best; if (first) this.save.done.push(m.id); this.addCash(reward); this.persist();
      if (medal) this.bounties.event('medal', medal);
      this.bounties.event('mission', m.id);
      const nxt = this.missions.indexOf(m) + 1;
      if (first && nxt > 0 && nxt < this.missions.length) lines.push(`Unlocked <b>${this.missions[nxt].title}</b>`);
      if (m.isRun) { this.save.runs++; this.record('run', m.runMi); this.bounties.event('runjob', 1); if (!this.save.camps.includes(m.to.key)) this.save.camps.push(m.to.key); this.persist(); lines.push(`${m.runMi.toFixed(1)} mile run &nbsp;·&nbsp; runs done <b>${this.save.runs}</b>`); }
      if (this.reputation) this.reputation.mission(m, first);
      this.audio.complete();
      this.showResult(`${m.title}`, lines, false);
    } else {
      this.audio.fail();
      this.showResult('Mission failed', [s.failReason || ''], true);
    }
    this.renderHud();
  }
  showResult(title, lines, fail) {
    this.el.result.innerHTML = `<h2 class="${fail ? 'fail' : ''}">${fail ? title : 'Mission complete'}</h2>${fail ? '' : `<div class="lines" style="font-size:24px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase">${title}</div>`}<div class="lines">${lines.map(l => `<div>${l}</div>`).join('')}</div><div class="foot">Enter · continue &nbsp;&nbsp; R · retry &nbsp;&nbsp; M · jobs board</div>`;
    this.el.result.classList.remove('hidden'); this.resultOpen = true; this.paused = true; document.getElementById('hud').classList.add('dim'); this.lastMission = this.state ? this.state.m : this.lastMission;
  }
  closeResult() { this.el.result.classList.add('hidden'); this.resultOpen = false; this.paused = this.menuOpen; if (!this.menuOpen) document.getElementById('hud').classList.remove('dim'); }
  fail(reason) { if (this.state) { this.state.failReason = reason; this.end(false); } }

  // ---- the chart ----
  openMap() { if (!this.map) return; this.mapOpen = true; this.paused = true; this.map.show(); document.getElementById('hud').classList.add('dim'); }
  closeMap() { if (!this.mapOpen) return; this.mapOpen = false; this.paused = this.menuOpen || this.resultOpen; this.map.hide(); if (!this.paused) document.getElementById('hud').classList.remove('dim'); }

  // ---- camp runs: a delivery from the camp you are tied up at to another camp a few kilometres off ----
  startRun(from) {
    const W = this.world; const day = Math.floor(Date.now() / 86400000);
    const cands = W.campsNear(from.x, from.z, 4800).filter(c => c !== from).map(c => ({ c, d: Math.hypot(c.x - from.x, c.z - from.z) })).filter(o => o.d > 1300);
    let to;
    if (cands.length) { cands.sort((a, b) => a.d - b.d); const near = cands.slice(0, 3); to = near[(from.seed + day * 7) % near.length].c; } // one of the three nearest camps: 1.3-3 km as a rule
    else to = { key: 'home', name: 'the tower dock', tie: this.dockTie, x: this.dockTie.x, z: this.dockTie.z };
    const dist = Math.hypot(to.tie.x - from.tie.x, to.tie.z - from.tie.z);
    const localStanding = this.reputation ? this.reputation.score('locals') : 0;
    const payFactor = Math.max(0.82, Math.min(1.22, 1 + localStanding * 0.025));
    const G = this;
    const m = {
      id: `run:${from.key}>${to.key}`, isRun: true, from, to, runMi: dist * MI,
      title: `Run to ${to.name}`, desc: `Supplies for ${to.name}, ${(dist * MI).toFixed(1)} miles off as the egret flies. Tie up under 7 mph.`,
      reward: Math.round((150 + dist * 0.14) * payFactor), gold: dist / 9.5, silver: dist / 7.5, bronze: dist / 5.5,
      start: () => ({ x: from.tie.x, z: from.tie.z, heading: G.headingTo(from.tie.x, from.tie.z, to.tie.x, to.tie.z) }),
      setup() {},
      update(s, G) {
        G.beacon.set(to.tie.x, 0, to.tie.z, 0x7be08a, true); G.wpTarget = { x: to.tie.x, z: to.tie.z, label: to.name }; G.beacon2.hide();
        if (G.dist(to.tie.x, to.tie.z) < 12 && G.mph() < 7) return 'done';
        return null;
      },
      hud(s, G) { return { obj: `Deliver to ${to.name}`, sub: `${fmtDist(G.dist(to.tie.x, to.tie.z))} · gold under ${fmtT(m.gold)}` }; },
      markers(s, G, out) { out.push({ x: to.tie.x, z: to.tie.z, color: '#7be08a', r: 5 }); },
    };
    this.startMission(m);
  }

  // ---- menu ----
  openMenu(tab = 'jobs') {
    this.menuTab = MENU_TABS.includes(tab) ? tab : 'jobs'; this.menuOpen = true; this.paused = true; this.renderMenu();
    this.el.menu.classList.remove('hidden'); this.el.menu.setAttribute('aria-hidden', 'false'); document.getElementById('hud').classList.add('dim');
    requestAnimationFrame(() => this.el.menu.focus({ preventScroll: true }));
  }
  closeMenu() {
    this.menuOpen = false; this.paused = this.resultOpen; this.el.menu.classList.add('hidden'); this.el.menu.setAttribute('aria-hidden', 'true');
    if (!this.resultOpen) document.getElementById('hud').classList.remove('dim');
  }
  renderMenu() {
    const rows = this.missions.map((m, i) => {
      const b = this.save.best[m.id]; const lock = !this.unlocked(i);
      let best = '';
      if (b) { best = b.score !== undefined ? `${b.score.toLocaleString()} pts` : b.time ? fmtT(b.time) : ''; if (b.medal) best += `<i>${b.medal}</i>`; }
      const goal = m.gold ? `Gold ${fmtT(m.gold)}` : m.scoreMedal ? `Gold ${m.scoreMedal[0].toLocaleString()}` : m.timeLimit ? `${fmtT(m.timeLimit)} limit` : '';
      return `<button type="button" class="m ${i === this.sel ? 'sel' : ''} ${lock ? 'locked' : ''} ${b ? 'done' : ''}" data-mission="${i}" ${lock ? 'disabled' : ''}><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${m.title}</span><span class="best">${lock ? 'LOCKED' : best || fmtCash(m.reward)}</span><span class="d">${lock ? 'Finish the previous job first.' : m.desc}${goal && !lock ? `<em>${goal}</em>` : ''}</span></button>`;
    }).join('');
    const r = this.save.rec;
    const records = [
      ['Top speed', r.speed ? `${Math.round(r.speed)} mph` : '—'], ['Longest air', r.air ? `${r.air.toFixed(2)} s` : '—'], ['Highest air', r.peak ? `${r.peak.toFixed(1)} m` : '—'],
      ['Biggest spin', r.spin ? `${r.spin}°` : '—'], ['Longest drift', r.drift ? `${r.drift.toFixed(1)} s` : '—'], ['Best chain', r.bank ? `${Math.round(r.bank).toLocaleString()} pts` : '—'],
      ['Longest run', r.run ? `${r.run.toFixed(1)} mi` : '—'], ['Camps found', `${this.save.camps.length}`], ['Traps recovered', `${this.save.traps.length}`],
      ['Dolphin passes', `${Math.max(0, Number(this.save.nature?.dolphinPasses) || 0)}`],
    ];
    const bl = this.bounties.today().map(b => `<div class="b ${b.done ? 'done' : ''}"><span class="chk">${b.done ? '✓' : ''}</span><span class="bt">${b.text}${b.count > 1 && !b.done ? ` <i>${b.progress} / ${b.count}</i>` : ''}</span><span class="pay">${fmtCash(b.pay)}</span></div>`).join('');
    const encounterCount = Object.values(this.save.encounters || {}).reduce((n, v) => n + (Number(v) || 0), 0);
    const incidents = this.save.incidents || {}, incidentResolved = Number(incidents.resolved) || 0, incidentHeard = Number(incidents.heard) || 0;
    const citations = Number(this.save.law && this.save.law.citations) || 0;
    const regionsSeen = (this.save.regions || []).length, regionTotal = this.regions ? this.regions.all.length : 9;
    const standing = this.reputation ? { locals: this.reputation.rank('locals'), fwc: this.reputation.rank('fwc'), runners: this.reputation.rank('runners') } : { locals: 'unproven', fwc: 'unknown hull', runners: 'unproven' };
    const storyLine = this.story ? this.story.menuLine() : 'Running Dark · not started';
    const contractLine = this.contracts ? this.contracts.menuLine() : 'no resident work logged';
    const fieldNotes = this.discoveries?.menuEntries?.() || [];
    const fieldNoteCount = fieldNotes.filter(entry => entry.found).length;
    const fieldNoteRows = fieldNotes.length ? fieldNotes.map(entry => `<div class="deed ${entry.found ? 'found' : ''}"><b>${entry.found ? esc(entry.short) : 'Unlogged'}</b>${esc(entry.found ? `${entry.place} · day ${entry.record?.day || '—'}` : entry.hint)}</div>`).join('') : '<div class="deed">No field observations logged.</div>';
    const fishingEntries = this.fishing?.menuEntries?.() || [], fishLogged = fishingEntries.filter(entry => entry.caught > 0).length;
    const fishingRows = fishingEntries.length ? fishingEntries.map(entry => `<div class="deed ${entry.caught ? 'found' : ''}"><b>${esc(entry.name)}</b>${entry.caught ? `${entry.caught} landed · best ${entry.bestIn.toFixed(1)} in` : 'Not logged'}</div>`).join('') : '<div class="deed">No catches logged.</div>';
    records.push(['Field notes', `${fieldNoteCount} / ${fieldNotes.length || 3}`]);
    records.push(['Aid reports', `${Math.max(0, Number(this.save.navigationAids?.stats?.reports) || 0)}`]);
    records.push(['Fish landed', `${Math.max(0, Number(this.save.fishing?.total) || 0)}`]);
    records.push(['Fish released', `${Math.max(0, Number(this.save.fishing?.released) || 0)}`]);
    const wanted = Math.max(0, Math.min(5, Math.ceil(Number(this.law?.attention) || 0)));
    const deeds = (this.reputation?.deeds || []).slice(-6).reverse();
    const deedRows = deeds.length ? deeds.map(deed => `<div class="deed"><b>${esc(deed.faction)} ${deed.delta > 0 ? '+' : ''}${Number(deed.delta).toFixed(1)}</b>${esc(deed.text)}</div>`).join('') : '<div class="deed">Nobody has made up their mind about this hull yet.</div>';
    const quality = esc(this.getQualityLabel?.() || 'Auto');
    const resetArmed = this.newGameArmed();
    let kicker = '', title = '', copy = '', content = '', keyHelp = '';
    if (this.menuTab === 'jobs') {
      kicker = 'Jobs board'; title = 'Work the water'; copy = 'Races, freight, rescues and recovery work. Finished jobs stay open for better times and repeat pay.';
      content = `<div class="menu-grid"><div><div class="list">${rows}</div><div class="stats">Bankroll <b>${fmtCash(this.save.cash)}</b> &nbsp;·&nbsp; style <b>${this.tricks.total.toLocaleString()} pts</b> &nbsp;·&nbsp; complete <b>${this.save.done.length} / ${this.missions.length}</b></div></div><aside><section class="menu-card"><div class="h">Today's bounties</div>${bl}</section><section class="menu-card"><div class="h">Story on the water</div><div class="deed"><b>Main line</b>${esc(storyLine)}</div><div class="deed"><b>Residents</b>${esc(contractLine)}</div></section></aside></div>`;
      keyHelp = '<span><b>↑ ↓</b> choose &nbsp; <b>Enter</b> start</span><span><b>M / Esc</b> back to the water</span>';
    } else if (this.menuTab === 'world') {
      kicker = 'Living world'; title = 'Water remembers'; copy = 'Calls, favors and collisions change how camps, runners and FWC receive this boat.';
      content = `<div class="world-grid"><section class="menu-card"><div class="h">Current picture</div><div class="kpis"><div class="kpi"><b>${encounterCount}</b><span>encounters</span></div><div class="kpi"><b>${regionsSeen}/${regionTotal}</b><span>regions</span></div><div class="kpi"><b>${incidentResolved}/${incidentHeard}</b><span>calls resolved</span></div><div class="kpi"><b>${wanted ? '★'.repeat(wanted) : 'Clear'}</b><span>FWC wanted</span></div><div class="kpi"><b>${citations}</b><span>citations</span></div><div class="kpi"><b>${Number(incidents.fwc) || 0}/${Number(incidents.runners) || 0}</b><span>FWC / runners</span></div></div></section><section class="menu-card"><div class="h">Standing</div><div class="standing"><span>Locals</span><b>${esc(standing.locals)}</b><em>${this.reputation ? this.reputation.score('locals').toFixed(1) : '0.0'}</em></div><div class="standing"><span>FWC</span><b>${esc(standing.fwc)}</b><em>${this.reputation ? this.reputation.score('fwc').toFixed(1) : '0.0'}</em></div><div class="standing"><span>Backchannel</span><b>${esc(standing.runners)}</b><em>${this.reputation ? this.reputation.score('runners').toFixed(1) : '0.0'}</em></div></section><section class="menu-card"><div class="h">Open threads</div><div class="deed"><b>Story</b>${esc(storyLine)}</div><div class="deed"><b>Resident work</b>${esc(contractLine)}</div><div class="deed"><b>Conditions</b>${esc(this.getWorldLabel?.() || 'South Florida backcountry')}</div></section><section class="menu-card"><div class="h">What people remember</div>${deedRows}</section><section class="menu-card field-notes"><div class="h">Field notes · ${fieldNoteCount} / ${fieldNotes.length || 3}</div><div class="field-note-grid">${fieldNoteRows}</div></section></div>`;
      keyHelp = '<span><b>Tab / ← →</b> change section</span><span><b>Esc</b> back to the water</span>';
    } else if (this.menuTab === 'records') {
      kicker = 'Boat log'; title = 'Records'; copy = 'Fastest runs, biggest air, field work and catches measured over the gunwale.';
      content = `<div class="records-grid"><section class="menu-card"><div class="h">Hull &amp; style</div>${records.slice(0, 6).map(([k,v]) => `<div class="r"><span>${k}</span><b>${v}</b></div>`).join('')}</section><section class="menu-card"><div class="h">Backcountry work</div>${records.slice(6).map(([k,v]) => `<div class="r"><span>${k}</span><b>${v}</b></div>`).join('')}<div class="r"><span>Jobs finished</span><b>${this.save.done.length} / ${this.missions.length}</b></div><div class="r"><span>Camp runs</span><b>${Number(this.save.runs) || 0}</b></div><div class="r"><span>Cash earned</span><b>${fmtCash(this.save.cash)}</b></div></section><section class="menu-card fishing-log"><div class="h">Catch-and-release log · ${fishLogged} / ${fishingEntries.length || 6} species</div><div class="fish-log-grid">${fishingRows}</div></section></div>`;
      keyHelp = '<span><b>Tab / ← →</b> change section</span><span><b>Esc</b> back to the water</span>';
    } else {
      kicker = 'Paused'; title = 'Tower radio'; copy = 'Resume the water, set the rendering budget, or return to the title.';
      const systemActions = [
        ['resume', 'Resume', 'Return to the boat', 'Esc', false],
        ['graphics', 'Graphics', 'Auto adapts after sustained frame pressure; fixed modes stay locked', quality, false],
        ['title', 'Return to title', "Save the hull's current position and leave the water paused", 'Title', false],
      ];
      if (this.hasProgress()) systemActions.push(['new', resetArmed ? 'Confirm new game' : 'New game', resetArmed ? 'Select again now to clear jobs, cash, records and world history' : 'Start over at the tower dock; graphics choice is kept', resetArmed ? 'Clear save' : 'Reset', resetArmed]);
      this.systemSel = Math.max(0, Math.min(this.systemSel, systemActions.length - 1));
      const actions = systemActions.map(([action, name, detail, value, danger], i) => `<button type="button" class="system-action ${i === this.systemSel ? 'sel' : ''} ${danger ? 'danger' : ''}" data-action="${action}"><strong>${name}</strong><small>${detail}</small><em>${value}</em></button>`).join('');
      content = `<div class="menu-grid"><div class="system-list">${actions}</div><aside><section class="menu-card"><div class="h">On the water</div><div class="keys">W / S throttle · A / D rudder<br>Drag to look · wheel to change camera distance<br>C cast / reel · X cut or reel in · G anchor<br>L spotlight · H horn · Tab chart · M jobs<br>In dense fog: H sounds one prolonged blast<br>In the air: S nose up · Shift nose down · A / D spin<br>R reset the hull</div></section></aside></div>`;
      keyHelp = '<span><b>↑ ↓ / Enter</b> choose &nbsp; <b>Tab / ← →</b> change section</span><span><b>Esc</b> resume</span>';
    }
    const tabs = { jobs: ['▤', 'Jobs'], world: ['⌖', 'World'], records: ['△', 'Records'], system: ['⚙', 'System'] };
    const rail = MENU_TABS.map(tab => `<button type="button" class="rail-tab ${tab === this.menuTab ? 'active' : ''}" data-tab="${tab}" ${tab === this.menuTab ? 'aria-current="page"' : ''}><span>${tabs[tab][0]}</span>${tabs[tab][1]}</button>`).join('');
    this.el.menu.innerHTML = `<nav class="menu-rail" aria-label="Pause menu"><div class="rail-mark">EB</div>${rail}<div class="rail-status">${fmtCash(this.save.cash)}<br>${esc(this.getWorldShortLabel?.() || 'Open water')}</div></nav><main class="menu-stage"><section class="menu-view"><header class="menu-head"><div><p>${kicker}</p><h1>${title}</h1></div><p class="menu-copy">${copy}</p></header>${content}</section></main><footer class="menu-keybar">${keyHelp}</footer>`;
    this.el.menu.querySelectorAll('[data-tab]').forEach(element => element.addEventListener('click', () => { this.menuTab = element.dataset.tab; this.renderMenu(); this.el.menu.focus({ preventScroll: true }); }));
    this.el.menu.querySelectorAll('[data-mission]').forEach(element => {
      element.addEventListener('click', () => { const i = +element.dataset.mission; if (this.unlocked(i)) { this.sel = i; this.start(i); } });
      element.addEventListener('mouseenter', () => { const i = +element.dataset.mission; if (this.unlocked(i)) { this.sel = i; this.el.menu.querySelectorAll('.m').forEach(candidate => candidate.classList.toggle('sel', +candidate.dataset.mission === i)); } });
    });
    this.el.menu.querySelectorAll('[data-action]').forEach((element, index) => {
      element.addEventListener('mouseenter', () => { this.systemSel = index; this.el.menu.querySelectorAll('.system-action').forEach((candidate, i) => candidate.classList.toggle('sel', i === index)); });
      element.addEventListener('click', () => {
        const action = element.dataset.action;
        if (action === 'resume') this.closeMenu();
        else if (action === 'graphics') { this.onCycleQuality?.(); this.renderMenu(); }
        else if (action === 'title') this.onReturnToTitle?.();
        else if (action === 'new') this.requestNewGame();
      });
    });
    const selEl = this.el.menu.querySelector('.m.sel'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }
  onKey(e) {
    if (!this.playing) return;
    if (this.resultOpen) {
      if (e.code === 'Enter' || e.code === 'Space') this.closeResult();
      else if (e.code === 'KeyR' && this.lastMission) { this.closeResult(); this.startMission(this.lastMission); }
      else if (e.code === 'KeyM' || e.code === 'Escape') { this.closeResult(); this.openMenu(); }
      e.preventDefault(); return;
    }
    if (this.menuOpen) {
      if (e.code === 'Escape' || e.code === 'KeyM') { this.closeMenu(); e.preventDefault(); return; }
      if (e.code === 'Tab' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const direction = e.code === 'ArrowLeft' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1;
        this.menuTab = MENU_TABS[(MENU_TABS.indexOf(this.menuTab) + MENU_TABS.length + direction) % MENU_TABS.length]; this.renderMenu(); e.preventDefault(); return;
      }
      if (this.menuTab === 'jobs' && (e.code === 'ArrowDown' || e.code === 'KeyS')) { do { this.sel = (this.sel + 1) % this.missions.length; } while (!this.unlocked(this.sel)); this.renderMenu(); e.preventDefault(); return; }
      if (this.menuTab === 'jobs' && (e.code === 'ArrowUp' || e.code === 'KeyW')) { do { this.sel = (this.sel + this.missions.length - 1) % this.missions.length; } while (!this.unlocked(this.sel)); this.renderMenu(); e.preventDefault(); return; }
      if (this.menuTab === 'system' && (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowUp' || e.code === 'KeyW')) {
        const count = Math.max(1, this.el.menu.querySelectorAll('[data-action]').length), direction = e.code === 'ArrowDown' || e.code === 'KeyS' ? 1 : -1;
        this.systemSel = (this.systemSel + count + direction) % count; this.renderMenu(); e.preventDefault(); return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        const focused = document.activeElement;
        if (focused?.matches?.('#menu button')) focused.click();
        else if (this.menuTab === 'jobs' && this.unlocked(this.sel)) this.start(this.sel);
        else if (this.menuTab === 'system') this.el.menu.querySelector('.system-action.sel')?.click();
        e.preventDefault(); return;
      }
      return;
    }
    if (e.code === 'Tab') { e.preventDefault(); this.mapOpen ? this.closeMap() : this.openMap(); return; }
    if (this.mapOpen) { if (e.code === 'Escape' || e.code === 'KeyM') this.closeMap(); return; }
    if (e.code === 'KeyM') { this.openMenu('jobs'); return; }
    if (e.code === 'Escape') { this.openMenu('system'); return; }
    if ((e.code === 'KeyC' || e.code === 'KeyX') && this.fishing?.capturesInput(e)) return;
    if ((e.code === 'KeyE' || e.code === 'KeyF') && this.story?.capturesInput(e.code)) return;
    if ((e.code === 'KeyE' || e.code === 'KeyF') && this.aftermath?.capturesInput(e.code)) return;
    if (e.code === 'KeyE' && this.navigationAids?.capturesInput(e.code)) return;
    if (e.code === 'KeyE' && !this.state && !this.paused) { if (this.dockJob) { if (this.unlocked(this.dockJob.i)) this.start(this.dockJob.i); else this.toast('Locked', `Finish ${this.missions[this.dockJob.i - 1].title} first`, 2); return; } if (this.dockCamp) { this.startRun(this.dockCamp); return; } if (this.atBoard) { this.openMenu(); return; } }
    if (e.code === 'KeyR' && this.state && (this.state.m.countdown || this.state.m.restartOnR)) { this.start(this.missions.indexOf(this.state.m)); }
  }

  // a surfaced gator under the hull: thump, hop, lose the chain
  // the bull came at the hull while it sat there
  gatorCharge(g) {
    const p = this.phys; const dx = p.pos.x - g.pos.x, dz = p.pos.y - g.pos.z, d = Math.hypot(dx, dz) || 1;
    p.hit = Math.max(p.hit, 5); p.hitNormal.set(dx / d, dz / d); p.hitTag = 'gator';
    p.vel.x += dx / d * 2.2; p.vel.y += dz / d * 2.2; p.vy = Math.max(p.vy, 1.6); p.rollVel += (Math.random() < 0.5 ? -1 : 1) * 3.0; p.angVel += (Math.random() - 0.5) * 2.4;
    this.tricks.bust('GATOR'); this.audio.thud(1.4); this.shake = Math.min(1, this.shake + 0.7);
    this.toast('Bull gator', 'He does not like the hull sitting on his water. Keep moving near him.', 2.6);
    this.bounties.event('charged', 1);
  }
  // another driver's boat took a hit from ours
  boatHit(b, into) {
    const lines = ['Watch it!', 'Hey! Learn to drive that thing!', 'You blind, son?', 'Easy! Easy!', 'That is a new hull, dammit!'];
    const P = b.profile, name = P ? `${P.callsign} · ${P.operator}` : 'another boat';
    this.toast(`“${lines[Math.floor(Math.random() * lines.length)]}”`, into > 6 ? `${name} · hard collision` : `${name} · hull contact`, 2.4);
    this.tricks.bust('BOAT');
    if (P?.id === 'fwc-27' && into > 2.5) {
      if (this.law) { this.law.stats.patrolRams = (this.law.stats.patrolRams || 0) + 1; this.law.add(1.75 + Math.min(1.1, into * 0.1), 'rammed FWC patrol boat', true); }
      if (this.reputation) this.reputation.change('fwc', -Math.min(0.9, 0.38 + into * 0.045), 'patrol-ram', 'FWC logged the tower airboat striking twenty-seven.', false);
      return Boolean(this.encounters?.forcePatrolPursuit?.(b, into));
    }
    if (this.law && into > 3.5) this.law.violation(0.35 + Math.min(0.7, into * 0.06), `${P?.callsign || 'boat'} collision reported`);
    if (P && this.reputation && into > 3.5) this.reputation.change(P.faction, -Math.min(0.45, 0.12 + into * 0.025), 'working-boat-collision', `${P.callsign} logged the collision against the tower airboat.`, false);
    return false;
  }
  anglerSay(a, line, angry = false) {
    this.toast(`“${line}”`, angry ? 'You rocked his boat. Idle past anglers.' : 'The angler in the johnboat', 2.4);
    if (angry && this.law) this.law.violation(0.12, 'reckless wake complaint');
  }
  considerNoWake(out, x, z, key, label, kind, cx, cz, radius, limit = 8, animal = null, priority = 0) {
    const d = Math.hypot(x - cx, z - cz);
    if (d >= radius || priority < out.priority || (priority === out.priority && d >= out.d)) return;
    out.key = key; out.label = label; out.kind = kind; out.d = d; out.radius = radius; out.limit = limit; out.priority = priority; out.animal = animal;
  }
  findNoWakeZone(x, z) {
    const out = this.noWakeScan; out.key = ''; out.label = ''; out.kind = ''; out.d = Infinity; out.radius = 0; out.limit = 8; out.priority = 0; out.animal = null;
    if (this.world) {
      for (const g of this.world.liveCamps.values()) {
        const c = g.userData.site; if (c) this.considerNoWake(out, x, z, `camp:${c.key}`, c.name, 'camp', c.tie.x, c.tie.z, 88);
      }
      for (const { site: s } of this.world.liveSites.values()) {
        if (s.kind === 'blind') continue;
        const center = s.kind === 'house' ? s.tie : s;
        const radius = s.kind === 'ramp' ? 105 : s.kind === 'boathouse' ? 78 : 82;
        const label = s.kind === 'ramp' ? 'Public boat ramp' : s.kind === 'boathouse' ? 'Working boathouse' : 'Private dock';
        this.considerNoWake(out, x, z, `site:${s.key}`, label, s.kind, center.x, center.z, radius);
      }
    }
    if (this.manatees) for (const m of this.manatees.list) if (m.surfaced || m.zoneT > 0) this.considerNoWake(out, x, z, m.zoneKey, 'Manatee ahead', 'manatee', m.pos.x, m.pos.z, 70, 6, m, 1);
    return out;
  }
  updateNoWake(dt, enabled) {
    this.noWakeCooldown = Math.max(0, this.noWakeCooldown - dt);
    this.manateeWarnCooldown = Math.max(0, this.manateeWarnCooldown - dt);
    const z = this.noWakeScan, active = enabled && Boolean(z.key), mph = this.mph();
    if (!active) {
      this.noWakeOverT = Math.max(0, this.noWakeOverT - dt * 2.5);
      if (this.el.waterRule && this.noWakeHudKey) { this.el.waterRule.classList.remove('on', 'warn'); this.el.waterRule.innerHTML = ''; this.noWakeHudKey = ''; }
      return;
    }
    const manatee = z.kind === 'manatee', speeding = mph > z.limit;
    this.noWakeOverT = speeding ? this.noWakeOverT + dt : Math.max(0, this.noWakeOverT - dt * 3.5);
    const hudKey = `${z.key}:${speeding ? Math.round(mph) : 0}`;
    if (this.el.waterRule && hudKey !== this.noWakeHudKey) {
      this.noWakeHudKey = hudKey;
      this.el.waterRule.classList.add('on'); this.el.waterRule.classList.toggle('warn', speeding);
      this.el.waterRule.innerHTML = manatee
        ? speeding ? `<span>Manatee ahead · ${Math.round(mph)} mph</span><small>Idle speed · watch the boil</small>` : '<span>Idle speed · 5 mph</span><small>Manatee ahead</small>'
        : speeding ? `<span>Slow down · ${Math.round(mph)} mph</span><small>No wake · ${z.label}</small>` : `<span>No wake · 5 mph</span><small>${z.label}</small>`;
    }
    if (this.noWakeOverT < (manatee ? 1 : 2.2) || (manatee ? this.manateeWarnCooldown : this.noWakeCooldown) > 0) return;
    this.noWakeOverT = manatee ? 0.35 : 0.8;
    if (manatee) {
      this.manateeWarnCooldown = 12;
      this.manatees.alert(z.animal, this.phys.pos.x, this.phys.pos.y, 0.7);
      this.audio.warn(); this.toast('Manatee diving', 'Throttle back and hold the last place you saw the boil.', 2.8); return;
    }
    this.noWakeCooldown = 45;
    const call = z.kind === 'ramp' ? '“No wake at the ramp!”' : z.kind === 'camp' ? '“Idle speed past the dock!”' : '“Cut that wake!”';
    this.toast(call, `${z.label} · complaint called in`, 2.8);
    if (this.law) {
      this.law.stats.wakeWarnings = (this.law.stats.wakeWarnings || 0) + 1;
      this.law.violation(0.28, `wake complaint · ${z.label.toLowerCase()}`);
    }
    if (this.reputation) this.reputation.change('locals', -0.15, 'no-wake', `You threw a wake through ${z.label.toLowerCase()}.`, false);
    else this.persist();
  }
  manateeNearMiss(m) {
    if (!m || m.nearMissT > 0) return;
    m.nearMissT = 14; this.manatees.alert(m, this.phys.pos.x, this.phys.pos.y, 1.25);
    this.manateeWarnCooldown = Math.max(this.manateeWarnCooldown, 14); this.tricks.bust('WILDLIFE'); this.audio.warn();
    this.toast('Manatee under the bow', 'Kill the throttle. FWC has the wake report.', 3);
    if (this.law) {
      this.law.stats.manateeNearMisses = (this.law.stats.manateeNearMisses || 0) + 1;
      this.law.add(0.55, 'high-speed manatee near-miss', false);
    }
    if (this.reputation) this.reputation.change('fwc', -0.3, 'manatee-near-miss', 'FWC logged a high-speed pass over a surfaced manatee.', false);
    else this.persist();
  }
  manateeHit(m) {
    if (!m || m.strikeT > 0) return;
    const p = this.phys, dx = p.pos.x - m.pos.x, dz = p.pos.y - m.pos.z, d = Math.hypot(dx, dz) || 1;
    m.strikeT = 18; m.nearMissT = 18; this.manatees.alert(m, p.pos.x, p.pos.y, 2);
    p.hit = Math.max(p.hit, 4.8); p.hitNormal.set(dx / d, dz / d); p.hitTag = 'manatee'; p.hitObj = m;
    p.vel.multiplyScalar(0.78); p.vy = Math.max(p.vy, 0.9); p.rollVel += (Math.random() < 0.5 ? -1 : 1) * 1.7; p.angVel += (Math.random() - 0.5) * 1.2;
    this.manateeWarnCooldown = Math.max(this.manateeWarnCooldown, 20); this.tricks.bust('WILDLIFE'); this.audio.thud(1.35); this.shake = Math.min(1, this.shake + 0.58);
    this.toast('Manatee strike', 'Bring the boat to idle. FWC is logging the hull.', 3.4);
    if (this.law) {
      this.law.stats.manateeStrikes = (this.law.stats.manateeStrikes || 0) + 1;
      this.law.add(1.65, 'protected manatee strike', false);
    }
    if (this.reputation) {
      this.reputation.change('fwc', -1.1, 'manatee-strike', 'A protected manatee strike went into the FWC file.', true);
      this.reputation.change('locals', -0.35, 'manatee-strike', 'Word reached the camps that the tower boat hit a manatee.', false);
    } else this.persist();
  }
  gatorHit(g) {
    const p = this.phys;
    p.hit = Math.max(p.hit, 4.5); p.hitNormal.set(-p.vel.x, -p.vel.y).normalize();
    p.vel.multiplyScalar(0.8); p.vy = Math.max(p.vy, 1.4); p.rollVel += (Math.random() < 0.5 ? -1 : 1) * 2.2; p.angVel += (Math.random() - 0.5) * 1.6;
    g.dive = 9; g.hitT = 4;
    this.tricks.bust('GATOR');
    this.audio.thud(1.3); this.shake = Math.min(1, this.shake + 0.5);
    this.toast('Gator!', g.big ? 'That was the bull. He will remember that.' : 'Ran right over him', 1.6);
    if (this.state && this.state.m.onGator) { const r = this.state.m.onGator(this.state, this, g); if (r && r.fail) this.fail(r.fail); }
  }

  // ---- per-frame ----
  update(dt, t) {
    if (!this.paused && Number.isFinite(dt)) {
      this.positionSaveT -= dt;
      if (this.positionSaveT <= 0) { this.positionSaveT = 8; this.persist(); }
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('on'); }
    if (this.bountyT > 0) { this.bountyT -= dt; if (this.bountyT <= 0) this.el.bounty.classList.remove('on'); }
    this.beacon.update(t); this.beacon2.update(t);
    this.mapMarkers.length = 0; this.mapMarkerPool.reset();
    const p = this.phys;
    if (p.impact > 2.5) this.shake = Math.min(1, this.shake + p.impact * 0.08);
    if (p.hit > 3) this.shake = Math.min(1, this.shake + p.hit * 0.05);
    this.shake *= Math.exp(-dt * 6);
    // what we hit: deadheads and snags are the bayou's own hazards, docks and boats belong to somebody
    this.hitCd = Math.max(0, (this.hitCd || 0) - dt);
    if (p.hit > 2.5 && p.hitTag && this.hitCd <= 0 && !this.paused) {
      const tag = p.hitTag, mph = this.mph();
      if (tag === 'log') { this.hitCd = 4; this.audio.knock(Math.min(1, p.hit / 6)); this.tricks.bust('DEADHEAD'); this.toast('Deadhead', mph > 18 ? 'A sunken log, right under the surface. They drift in the still water.' : 'Sunken log', 2.2); if (p.hit > 4 && !p.airborne && p.wipeT <= 0) this.bounties.event('deadhead', mph); }
      else if (tag === 'snag') { this.hitCd = 4; this.audio.knock(Math.min(1, p.hit / 6)); this.tricks.bust('SNAG'); this.toast('Snag', 'Dead cypress standing in the channel', 2); }
      else if (tag === 'dock' || tag === 'house' || tag === 'truck' || tag === 'blind') {
        this.hitCd = 4; this.tricks.bust('DOCK');
        if (p.hit > 5) {
          this.toast(tag === 'truck' ? 'That was somebody\'s truck' : 'Hit the dock', 'Somebody is going to hear about that', 2);
          if (this.law) this.law.violation(0.35 + Math.min(0.45, p.hit * 0.035), `${tag} strike reported`);
        }
      }
    }
    this.el.air.textContent = p.airborne && p.airTime > 0.25 ? `AIR ${p.airTime.toFixed(2)}s · ${Math.max(0, p.y * FT).toFixed(0)} ft` : '';
    // beached against something with the throttle pinned: nudge the player toward reverse
    if (p.landFac > 0.5 && p.speed < 0.6 && p.throttle > 0.7 && !this.paused) { this.stuckT = (this.stuckT || 0) + dt; if (this.stuckT > 1.6) { this.toast('Hung up', 'Back off with S and pick another line', 2.2); this.stuckT = -4; } }
    else if (this.stuckT > 0) this.stuckT = 0; else if (this.stuckT < 0) this.stuckT = Math.min(0, this.stuckT + dt);
    // records & bounties that watch the physics directly
    if (!this.paused) {
      if (p.landedFrame && p.airTime > 0.25) { this.record('peak', p.airPeak); this.bounties.event('peak', p.airPeak); }
      const mph = p.speed * MPH; if (mph > 5) { this.record('speed', mph); this.bounties.event('speed', mph); }
      if (this.tricks.driftNow > 0) this.bounties.event('driftnow', this.tricks.driftNow);
      this.bounties.tick(dt);
      // Large wildlife reacts to the hull footprint, not just the boat's center point.
      if (this.manatees && p.speed > 2.5 && !p.airborne) {
        const f = p.forward(this._f), mph = this.mph(), survey = this.state && this.state.m.id === 'manatee';
        for (const m of this.manatees.list) {
          let hullD = Infinity;
          for (const oz of HULL_SAMPLES) { const hx = p.pos.x - f.x * oz, hz = p.pos.y - f.y * oz; hullD = Math.min(hullD, Math.hypot(hx - m.pos.x, hz - m.pos.z)); }
          if (hullD < 24 && mph > 6) this.manatees.alert(m, p.pos.x, p.pos.y, Math.min(1.5, mph / 24));
          if (!m.surfaced || m.strikeT > 0) continue;
          if (hullD < 2.25) this.manateeHit(m);
          else if (!survey && hullD < 8 && mph > 12) this.manateeNearMiss(m);
        }
      }
      // gators under the hull
      if (this.gators && p.speed > 2.5 && !p.airborne) {
        const f = p.forward(this._f);
        for (const g of this.gators.list) {
          if (!g.surfaced || g.hitT > 0) continue;
          const r = 1.6 * g.mesh.scale.x + 1.0;
          for (const oz of HULL_SAMPLES) { const hx = p.pos.x - f.x * oz, hz = p.pos.y - f.y * oz; if (Math.hypot(hx - g.pos.x, hz - g.pos.z) < r) { this.gatorHit(g); break; } }
        }
      }
      if (this.gators && this.gators.list[0]) { const g = this.gators.list[0]; if (g.surfaced && Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.y) < 16) this.bounties.event('seegator', 1); }
      const lag = this.T.lagoon; if (Math.hypot(p.pos.x - lag.x, p.pos.y - lag.y) < 60) this.bounties.event('visit', 'lagoon');
      // the world around the boat: camps to find, traps to pick up, docks to take a run from
      this.scanT -= dt;
      if (this.scanT <= 0 && this.world) {
        this.scanT = 0.25;
        const nc = this.world.nearestCamp(p.pos.x, p.pos.y, 6000); this.nearCamp = nc;
        if (nc) {
          if (nc.d < 2200 && !this.save.seen.includes(nc.camp.key)) { this.save.seen.push(nc.camp.key); this.persist(); }
          if (nc.d < 70 && !this.save.camps.includes(nc.camp.key)) { this.save.camps.push(nc.camp.key); this.addCash(75); this.toast(nc.camp.name, `Fish camp found · +$75 · ${this.save.camps.length} on the chart`, 3.2); this.audio.pickup(); this.bounties.event('discover', 1); }
        }
        this.nearTraps = this.world.trapsNear(p.pos.x, p.pos.y, 80);
        this.findNoWakeZone(p.pos.x, p.pos.y);
      }
      for (const tr of this.nearTraps) if (Math.hypot(tr.x - p.pos.x, tr.z - p.pos.y) < 4.6) {
        this.world.collectTrap(tr); this.save.traps.push(tr.key); this.addCash(40); this.audio.pickup();
        this.bountyToast(`Lost trap recovered <b>+$40</b> · ${this.save.traps.length} total`); this.bounties.event('trap', 1); this.record('traps', this.save.traps.length);
        this.nearTraps = this.nearTraps.filter(x => x !== tr); break;
      }
      const nc = this.nearCamp; const slow = this.mph() < 6, freeRide = !this.state && !this.fishing?.blocking() && !this.story?.blocking() && !this.aftermath?.blocking() && !this.encounters?.active && !this.life?.traffic?.activeCollision();
      this.updateNoWake(dt, freeRide);
      this.dockCamp = (freeRide && nc && Math.hypot(nc.camp.tie.x - p.pos.x, nc.camp.tie.z - p.pos.y) < 16 && slow) ? nc.camp : null;
      this.dockJob = null; if (freeRide && slow) { let bd = 14; for (const j of this.jobs) { const d = this.dist(j.x, j.z); if (d < bd) { bd = d; this.dockJob = j; } } }
      this.atBoard = freeRide && slow && !this.dockJob && this.dist(this.dockTie.x, this.dockTie.z) < 18;
      this.el.prompt.classList.toggle('on', !!(this.dockCamp || this.dockJob || this.atBoard));
      if (this.dockJob) { const m = this.dockJob.m, lock = !this.unlocked(this.dockJob.i); const goal = m.gold ? `gold ${fmtT(m.gold)}` : m.scoreMedal ? `gold ${m.scoreMedal[0].toLocaleString()}` : m.timeLimit ? `${fmtT(m.timeLimit)} limit` : fmtCash(m.reward); this.el.prompt.innerHTML = lock ? `<b>E</b> ${m.title} <i>· locked · finish ${this.missions[this.dockJob.i - 1].title}</i>` : `<b>E</b> ${m.title} <i>· ${goal}</i>`; }
      else if (this.dockCamp) this.el.prompt.innerHTML = `<b>E</b> take a run from ${this.dockCamp.name}`;
      else if (this.atBoard) this.el.prompt.innerHTML = `<b>E</b> jobs board`;
    }
    const s = this.state;
    if (s && !this.paused) {
      if (s.cd > 0) {
        const before = Math.ceil(s.cd); s.cd -= dt; const after = Math.ceil(s.cd);
        if (after !== before) { if (after >= 1) { this.toast(String(after), '', 1); this.audio.countdown(); } else { this.toast('GO', '', 1); this.audio.countdown(true); this.inputLock = false; } }
      } else {
        s.t += dt;
        const r = s.m.update(s, this, dt, t);
        if (r === 'done') this.end(true);
        else if (r && r.fail) this.fail(r.fail);
      }
    }
    this.collectMarkers(t);
    this.refreshHud(dt);
  }
  // everything the radar shows: the objective (pinned to the edge when off the radar), job posts, camps, homesteads,
  // ramps, other boats, anglers, the bull, traps close by, home
  collectMarkers(t) {
    const p = this.phys, px = p.pos.x, pz = p.pos.y, wp = this.wpTarget;
    const nearWp = (x, z) => wp && Math.hypot(x - wp.x, z - wp.z) < 3;
    if (this.state) {
      const mm = []; this.state.m.markers && this.state.m.markers(this.state, this, mm);
      for (const k of mm) { const current = nearWp(k.x, k.z); emitMapMarker(this, k.x, k.z, current || k.r >= 5 ? 'objective' : 'dot', k.color, k.heading, current, k.glyph, k.locked, k.done, k.known, k.soft, k.r); }
      if (wp && !mm.some(k => nearWp(k.x, k.z))) emitMapMarker(this, wp.x, wp.z, 'objective', '#f07a2e', 0, true);
    } else {
      for (const j of this.jobs) { const d = Math.hypot(j.x - px, j.z - pz); const unlocked = this.unlocked(j.i), on = d < 420; if (on) j.beacon.set(j.x, j.y, j.z, unlocked ? j.hex : 0x4a5550, false); else j.beacon.hide(); j.beacon.update(t); if (d < 1200) emitMapMarker(this, j.x, j.z, 'job', j.color, 0, false, j.glyph, !unlocked, this.save.done.includes(j.m.id)); }
      if (wp && !wp.story) emitMapMarker(this, wp.x, wp.z, 'objective', wp.color || '#7be08a', 0, true, '', false, false, false, true);
    }
    if (this.state) for (const j of this.jobs) j.beacon.hide();
    emitMapMarker(this, this.dockTie.x, this.dockTie.z, 'home');
    if (this.world) {
      for (const c of this.world.campsNear(px, pz, 900)) { const known = this.save.camps.includes(c.key); if (!known && !this.save.seen.includes(c.key)) continue; emitMapMarker(this, c.tie.x, c.tie.z, 'camp', '', 0, false, '', false, false, known); }
      for (const l of this.world.liveSites.values()) emitMapMarker(this, l.site.x, l.site.z, l.site.kind);
      for (const tr of this.world.trapsNear(px, pz, 170)) emitMapMarker(this, tr.x, tr.z, 'trap');
    }
    if (this.gators) { this.gators.calm = !!this.state; for (const g of this.gators.list) if (g.surfaced && g.big) emitMapMarker(this, g.pos.x, g.pos.z, 'gator'); }
    if (this.life) {
      for (const b of this.life.traffic.boats) if (b.active) emitMapMarker(this, b.x, b.z, 'boat', b.profile?.color || (b.kind === 'canoe' ? 'rgba(225,205,150,0.95)' : b.kind === 'air' ? 'rgba(240,235,220,0.95)' : 'rgba(125,175,235,0.95)'), b.heading);
      for (const { a } of this.life.traffic.liveAnglers.values()) emitMapMarker(this, a.x, a.z, 'angler');
    }
  }
  refreshHud(dt) {
    this.hudT += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.hudT + 1e-9 < HUD_REFRESH_INTERVAL) return false;
    this.hudT %= HUD_REFRESH_INTERVAL;
    this.renderHud(true);
    return true;
  }
  renderHud(light = false) {
    const s = this.state, e = this.el;
    if (s) {
      const h = s.m.hud(s, this);
      e.mission.innerHTML = `<div class="title">${s.m.title}</div><div class="obj">${h.obj || ''}</div><div class="sub">${h.sub || ''}</div>`;
      let tm = '';
      const limit = s.limitOverride || s.m.timeLimit;
      if (limit) { const left = limit - (s.t - (s.limitStart || 0)); tm = `${fmtT(left)}<small>remaining</small>`; e.timer.classList.toggle('warn', left < 20); }
      else if (s.m.gold) { tm = `${fmtT(s.t)}<small>gold ${fmtT(s.m.gold)}</small>`; e.timer.classList.remove('warn'); }
      else { tm = `${fmtT(s.t)}<small>elapsed</small>`; e.timer.classList.remove('warn'); }
      e.timer.innerHTML = tm;
      e.wp.innerHTML = this.wpTarget ? `${this.wpTarget.label || 'objective'} <b>${fmtDist(this.dist(this.wpTarget.x, this.wpTarget.z))}</b>` : '';
    } else if (this.fishing?.hud()) {
      const h = this.fishing.hud();
      e.mission.innerHTML = `<div class="title">${h.title}</div><div class="obj">${h.obj || ''}</div><div class="sub">${h.sub || ''}</div>`;
      e.timer.innerHTML = h.timer || ''; e.timer.classList.toggle('warn', Boolean(h.warn)); e.wp.innerHTML = '';
    } else if (this.story?.hud()) {
      const h = this.story.hud();
      e.mission.innerHTML = `<div class="title">${h.title}</div><div class="obj">${h.obj || ''}</div><div class="sub">${h.sub || ''}</div>`;
      e.timer.innerHTML = ''; e.timer.classList.remove('warn');
      e.wp.innerHTML = this.wpTarget ? `${this.wpTarget.label || 'objective'} <b>${fmtDist(this.dist(this.wpTarget.x, this.wpTarget.z))}</b>` : '';
    } else if (this.aftermath?.hud()) {
      const h = this.aftermath.hud();
      e.mission.innerHTML = `<div class="title">${h.title}</div><div class="obj">${h.obj || ''}</div><div class="sub">${h.sub || ''}</div>`;
      e.timer.innerHTML = ''; e.timer.classList.remove('warn');
      e.wp.innerHTML = this.wpTarget ? `${this.wpTarget.label || 'objective'} <b>${fmtDist(this.dist(this.wpTarget.x, this.wpTarget.z))}</b>` : '';
    } else if (this.discoveries?.hud()) {
      const h = this.discoveries.hud();
      e.mission.innerHTML = `<div class="title">${h.title}</div><div class="obj">${h.obj || ''}</div><div class="sub">${h.sub || ''}</div>`;
      e.timer.innerHTML = ''; e.timer.classList.remove('warn'); e.wp.innerHTML = '';
    } else if (this.life?.traffic?.activeCollision()) {
      const b = this.life.traffic.activeCollision(), c = b.collision, checking = c.stage === 'disabled', restarting = c.stage === 'restart';
      e.mission.innerHTML = `<div class="title">Collision aftermath</div><div class="obj">${checking ? `Idle below 5.5 mph and hold alongside ${b.profile.callsign}` : restarting ? `${b.profile.callsign} is restarting` : `${b.profile.callsign} reported the collision`}</div><div class="sub">${checking ? 'Stay until the crew accounts for everyone' : restarting ? 'The collision stays on the log, but you did not leave them' : 'FWC has your hull and direction'}</div>`;
      e.timer.innerHTML = checking ? `${Math.max(0, 7 - c.hold).toFixed(1)}<small>seconds alongside</small>` : restarting ? `${Math.max(0, 4.5 - c.t).toFixed(1)}<small>engine restart</small>` : '';
      e.timer.classList.toggle('warn', checking && c.distance > 80); e.wp.innerHTML = this.wpTarget ? `${this.wpTarget.label} <b>${fmtDist(c.distance)}</b>` : '';
    } else {
      const b = this.bounties.today().filter(x => !x.done)[0];
      const nc = this.nearCamp; const known = nc && this.save.camps.includes(nc.camp.key);
      const campLine = nc ? `<div class="obj">${known ? nc.camp.name : 'Unknown camp'} · ${fmtDist(nc.d)}</div>` : '';
      e.mission.innerHTML = `<div class="title">Free ride</div>${campLine}<div class="hint">C · fish &nbsp; M · jobs board &nbsp; Tab · chart</div>${b ? `<div class="sub">Bounty · ${b.text} · ${fmtCash(b.pay)}</div>` : ''}`;
      e.timer.innerHTML = ''; e.wp.innerHTML = '';
      this.wpTarget = (nc && nc.d > 60 && nc.d < 5000) ? { x: nc.camp.tie.x, z: nc.camp.tie.z, label: known ? nc.camp.name : 'camp' } : null;
    }
    e.cash.innerHTML = `${fmtCash(this.save.cash)}<b>${this.tricks.total.toLocaleString()} <span style="font-size:14px;letter-spacing:0.1em">pts</span></b>`;
    // trick feed
    const tr = this.tricks;
    const evs = tr.events.slice(-5).map(ev => `<div class="ev ${ev.bust ? 'bust' : ''}" style="opacity:${Math.max(0, 1 - (ev.t - 1.6) / 0.8).toFixed(2)}">${ev.text}${ev.points ? `<span>+${ev.points}</span>` : ''}</div>`).join('');
    const chain = tr.chain.length ? `<div class="chain">${tr.chain.length} trick chain <b>×${tr.mult}</b> ${Math.round(tr.chainPts * tr.mult)}</div>` : '';
    e.tricks.innerHTML = evs + chain;
  }
  // screen-space arrow to the current objective when it is off screen
  projectMarker(camera, w, h) {
    const a = this.el.arrow; const tgt = this.wpTarget;
    if (!tgt) { a.style.display = 'none'; return; }
    const v = this._v.set(tgt.x, 1.5, tgt.z).project(camera);
    const behind = v.z > 1;
    let sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
    if (behind) { sx = w - sx; sy = h; }
    const onScreen = !behind && sx > 0 && sx < w && sy > 0 && sy < h;
    if (onScreen) { a.style.display = 'none'; return; }
    const cx = w / 2, cy = h / 2; let dx = sx - cx, dy = sy - cy; const ang = Math.atan2(dy, dx);
    const mx = w / 2 - 60, my = h / 2 - 70; const k = Math.min(Math.abs(mx / (dx || 1e-3)), Math.abs(my / (dy || 1e-3)));
    dx *= k; dy *= k;
    a.style.display = 'block'; a.style.transform = `translate(${cx + dx}px, ${cy + dy}px)`;
    a.firstElementChild.style.transform = `rotate(${ang * 180 / Math.PI + 90}deg)`;
    a.lastElementChild.textContent = fmtDist(this.dist(tgt.x, tgt.z));
  }
}

// ------------------------------------------------------------------------------------------
// Daily bounties: four small challenges drawn from a pool, new set every day, paid on completion.
// ------------------------------------------------------------------------------------------
const BOUNTY_POOL = [
  { id: 'air15', text: 'Hang 1.5 s in the air', kind: 'air', target: 1.5, pay: 150 },
  { id: 'peak4', text: 'Get 4 m off the water', kind: 'peak', target: 4, pay: 200 },
  { id: 'spin360', text: 'Land a 360', kind: 'spin', target: 360, pay: 300 },
  { id: 'chain5', text: 'Chain five tricks', kind: 'chainlen', target: 5, pay: 250 },
  { id: 'drift3', text: 'Hold a 3 s drift', kind: 'driftnow', target: 3, pay: 150 },
  { id: 'speed31', text: 'Hit 31 mph', kind: 'speed', target: 31, pay: 100 },
  { id: 'mud4', text: 'Run the flats for 4 s straight', kind: 'mud', target: 4, pay: 150 },
  { id: 'near5', text: 'Five near misses', kind: 'nearmiss', target: 1, count: 5, pay: 250 },
  { id: 'bank3k', text: 'Bank a 3,000-point chain', kind: 'bank', target: 3000, pay: 300 },
  { id: 'clean3', text: 'Three clean landings', kind: 'clean', target: 1, count: 3, pay: 200 },
  { id: 'tail', text: 'Land a tail slap', kind: 'tail', target: 1, pay: 200 },
  { id: 'gold', text: 'Take a gold medal', kind: 'medal', target: 'GOLD', pay: 400 },
  { id: 'gator', text: 'Get a look at the bull gator', kind: 'seegator', target: 1, pay: 150 },
  { id: 'lagoon', text: 'Ride out to the lagoon', kind: 'visit', target: 'lagoon', pay: 100 },
  { id: 'huge', text: 'Land a huge air', kind: 'air', target: 1.7, pay: 300 },
  { id: 'twojobs', text: 'Finish two jobs', kind: 'mission', target: 1, count: 2, pay: 350 },
  { id: 'newcamp', text: 'Find a new fish camp', kind: 'discover', target: 1, pay: 250 },
  { id: 'runjob', text: 'Complete a camp run', kind: 'runjob', target: 1, pay: 300 },
  { id: 'traps3', text: 'Recover three lost traps', kind: 'trap', target: 1, count: 3, pay: 220 },
  { id: 'spook3', text: 'Spook three sunning gators', kind: 'spook', target: 1, count: 3, pay: 150 },
  { id: 'flush8', text: 'Flush eight egrets', kind: 'flush', target: 1, count: 8, pay: 120 },
  { id: 'deadhead', text: 'Hit a deadhead at 25 mph and stay on the water', kind: 'deadhead', target: 25, pay: 180 },
  { id: 'idlepass', text: 'Idle past an angler', kind: 'idlepass', target: 1, pay: 120 },
  { id: 'charged', text: 'Get charged by the bull and live', kind: 'charged', target: 1, pay: 200 },
  { id: 'baitwatch', text: 'Hold off a feeding school for six seconds', kind: 'baitwatch', target: 1, pay: 140 },
  { id: 'dolphinpass', text: 'Keep a steady course when dolphins join the bow', kind: 'dolphinpass', target: 1, pay: 200 },
  { id: 'catch3', text: 'Land and release three fish', kind: 'catch', target: 1, count: 3, pay: 180 },
  { id: 'snook', text: 'Land a common snook', kind: 'fishspecies', target: 'common-snook', pay: 220 },
];
class Bounties {
  constructor(G) {
    this.G = G;
    const day = Math.floor(Date.now() / 86400000);
    const sv = G.save.bounties;
    if (sv.day !== day) { sv.day = day; sv.done = []; sv.counts = {}; G.persist(); }
    const rr = mulberry32(day * 7919 + 13);
    const pool = BOUNTY_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.list = pool.slice(0, 4);
    this.flash = [];
  }
  today() { const sv = this.G.save.bounties; return this.list.map(b => ({ ...b, done: sv.done.includes(b.id), progress: sv.counts[b.id] || 0 })); }
  event(kind, value, text) {
    const sv = this.G.save.bounties;
    for (const b of this.list) {
      if (sv.done.includes(b.id)) continue;
      let k = kind;
      if (b.kind === 'tail') { if (text !== 'TAIL SLAP') continue; k = 'tail'; value = 1; }
      if (b.kind === 'chainlen') { if (kind !== 'chainlen') continue; }
      if (b.kind !== k) continue;
      const ok = typeof b.target === 'string' ? value === b.target : value >= b.target;
      if (!ok) continue;
      if (b.count) { sv.counts[b.id] = (sv.counts[b.id] || 0) + 1; if (sv.counts[b.id] < b.count) { this.G.persist(); continue; } }
      sv.done.push(b.id); this.G.addCash(b.pay); this.G.persist();
      this.G.bountyToast(`Bounty · ${b.text} <b>+${fmtCash(b.pay)}</b>`); this.G.audio.pickup();
    }
  }
  tick(dt) { const tr = this.G.tricks; if (tr.chain.length >= 5) this.event('chainlen', tr.chain.length); }
}

// ------------------------------------------------------------------------------------------
// Mission definitions
// ------------------------------------------------------------------------------------------
export function buildMissions(G) {
  const T = G.T;
  const gateAt = (pt, label) => ({ x: pt.x, z: pt.z, r: 9, label });
  const toGate = (s, G, g, color = 0xf07a2e, next, column = true) => {
    G.beacon.set(g.x, Math.max(T.heightAt(g.x, g.z), 0), g.z, color, column); G.wpTarget = g;
    if (next) G.beacon2.set(next.x, Math.max(T.heightAt(next.x, next.z), 0), next.z); else G.beacon2.hide();
  };
  const reached = (G, g) => G.dist(g.x, g.z) < (g.r || 6);
  const dockTie = G.dockTie;

  // waypoint sequence helper (checkpoint races & tours)
  const sequence = (gates) => ({
    setup(s) { s.i = 0; },
    update(s, G) {
      const g = gates[s.i]; toGate(s, G, g, s.i === gates.length - 1 ? 0x7be08a : 0xf07a2e, gates[s.i + 1]);
      if (reached(G, g)) { s.i++; G.audio.checkpoint(); if (s.i >= gates.length) return 'done'; G.toast(`${s.i} / ${gates.length}`, '', 0.8); }
      return null;
    },
    hud(s) { return { obj: `Checkpoint ${Math.min(s.i + 1, gates.length)} of ${gates.length}`, sub: gates[s.i] ? gates[s.i].label || '' : '' }; },
    markers(s, G, out) { for (let k = s.i; k < Math.min(gates.length, s.i + 3); k++) out.push({ x: gates[k].x, z: gates[k].z, color: k === s.i ? '#f07a2e' : 'rgba(243,237,224,0.6)', r: k === s.i ? 5 : 3 }); },
  });

  const kickers = T.bars.filter(b => b.kind === 'kicker');
  const nearestBar = (z, kind) => T.bars.filter(b => b.kind === kind).sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z))[0];
  const creekPt = (z) => ({ x: T.riverCenterX(z) - 150 - 30 * Math.sin(z * 0.02), z });

  // 1. Shakedown ---------------------------------------------------------------------------
  const shakeBar = nearestBar(-95, 'kicker');
  const shakedown = {
    id: 'shakedown', title: 'Shakedown Run', desc: 'Learn the boat: run the channel, jump a sandbar, tie up at the tower.', reward: 250,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s) { s.i = 0; s.jumped = false; },
    gates: [gateAt(G.river(20), 'Throttle up · W'), { x: shakeBar.x, z: shakeBar.z, r: 12, label: 'Hit the sandbar flat out', jump: true }, gateAt(G.river(-180, 0), 'Keep the speed through the bend'), { x: dockTie.x, z: dockTie.z, r: 7, label: 'Ease off and tie up at the tower dock' }],
    update(s, G) {
      const g = this.gates[s.i]; toGate(s, G, g, s.i === this.gates.length - 1 ? 0x7be08a : 0xf07a2e, this.gates[s.i + 1]);
      if (g.jump) {
        if (G.phys.landedFrame && G.phys.airTime > 0.3 && G.dist(g.x, g.z) < 45) { s.i++; G.audio.checkpoint(); G.toast('Nice air', 'Lean back with S before you land. Bank a chain of tricks for cash.', 3); }
      } else if (reached(G, g)) {
        if (s.i === this.gates.length - 1 && G.mph() > 8) return null; // must arrive slowly
        s.i++; G.audio.checkpoint(); if (s.i >= this.gates.length) return 'done';
        if (s.i === 1) G.toast('Sandbar ahead', 'Line up straight and hold full throttle', 3);
      }
      return null;
    },
    hud(s, G) { const g = this.gates[s.i]; return { obj: g.label, sub: g.jump ? 'Get airborne off the ramp' : s.i === this.gates.length - 1 ? 'Under 8 mph at the dock' : '' }; },
    markers(s, G, out) { const g = this.gates[s.i]; out.push({ x: g.x, z: g.z, color: '#f07a2e', r: 5 }); },
  };

  // 2. Manatee count ------------------------------------------------------------------------
  const manatee = {
    id: 'manatee', title: 'Manatee Count', desc: 'Fish & Wildlife needs a headcount. Idle up to each manatee — under 6 mph — and hold for two seconds.', reward: 350,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) { s.logged = new Set(); s.hold = 0; s.warnT = 0; },
    update(s, G, dt) {
      let best = null, bd = 1e9, remaining = 0;
      for (const m of G.manatees.list) if (!s.logged.has(m)) { remaining++; const d = Math.hypot(m.pos.x - G.phys.pos.x, m.pos.z - G.phys.pos.y); if (d < bd) { bd = d; best = m; } }
      if (!remaining) return 'done';
      toGate(s, G, { x: best.pos.x, z: best.pos.z, label: 'manatee' }, 0x7be08a, null, false);
      s.warnT -= dt;
      if (best.strikeT > 17.5) return { fail: 'You struck a protected manatee. FWC ended the survey.' };
      if (bd < 16 && G.mph() > 12) {
        s.hold = 0; G.manatees.alert(best, G.phys.pos.x, G.phys.pos.y, 1.1);
        if (s.warnT <= 0) { s.warnT = 2.5; G.toast('Slow down', 'Manatee diving · idle speed and wait for it to surface', 2.2); G.audio.warn(); s.strikes = (s.strikes || 0) + 1; if (s.strikes >= 3) return { fail: 'Repeated high-speed passes ended the FWC survey.' }; }
      }
      else if (bd < 8 && G.mph() < 6 && best.surfaced) { s.hold += dt; if (s.hold >= 2) { s.logged.add(best); s.hold = 0; G.audio.pickup(); G.toast(`Logged ${s.logged.size} / ${G.manatees.list.length}`, '', 1.4); } }
      else s.hold = Math.max(0, s.hold - dt * 2);
      s.holdView = s.hold; s.waiting = bd < 12 && !best.surfaced;
      return null;
    },
    hud(s, G) { return { obj: `Logged ${s.logged.size} of ${G.manatees.list.length}`, sub: s.holdView > 0 ? `Holding… ${(s.holdView / 2 * 100).toFixed(0)}%` : s.waiting ? 'At idle · waiting for it to surface' : 'Watch for the grey backs surfacing' }; },
    markers(s, G, out) { for (const m of G.manatees.list) if (!s.logged.has(m)) out.push({ x: m.pos.x, z: m.pos.z, color: '#7be08a', r: 4 }); },
  };

  // 3. Cypress Sprint (river race) ----------------------------------------------------------
  const sprintZ = [30, -40, -110, -170, -240, -300, -360, -430, -500, -570, -640];
  const sprintGates = sprintZ.map((z, i) => gateAt(G.river(z, i % 3 === 1 ? 0.6 : i % 3 === 2 ? -0.6 : 0)));
  const sprint = { id: 'sprint', title: 'Cypress Sprint', desc: 'Eleven gates straight down the main channel. Gold under 1:03.', reward: 500, countdown: true, gold: 63, silver: 76, bronze: 95, start: (G) => ({ x: G.startX, z: G.startZ + 20, heading: 0 }), ...sequence(sprintGates) };

  // 4. Trap line ----------------------------------------------------------------------------
  const trapSpots = (() => {
    const rr = mulberry32(99); const out = [];
    let tries = 0;
    while (out.length < 8 && tries++ < 60000) {
      const z = G.startZ - 40 - rr() * 420, x = T.riverCenterX(z) + (rr() < 0.5 ? -1 : 1) * (T.riverHalfWidth(z) + 18 + rr() * 70);
      const h = T.heightAt(x, z);
      if (h > -0.3 || h < -1.6) continue; // pool water among the trees
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < 45)) continue;
      out.push({ x, z });
    }
    return out;
  })();
  const traps = {
    id: 'traps', title: 'Trap Line', desc: 'Eight crab-trap floats are set in the back pools. Some you will have to cross the flats to reach. Four minutes.', reward: 400, timeLimit: 240,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) {
      s.floats = trapSpots.map(p => { const m = crabFloat(); m.position.set(p.x, 0, p.z); G.scene.add(m); return { m, x: p.x, z: p.z, got: false, ph: Math.random() * 6 }; });
    },
    cleanup(s, G) { for (const f of s.floats) G.scene.remove(f.m); },
    update(s, G, dt, t) {
      if (s.t > this.timeLimit) return { fail: 'Out of time. The traps are still out there.' };
      let best = null, bd = 1e9;
      for (const f of s.floats) {
        if (f.got) continue;
        f.m.position.y = Math.sin(t * 1.3 + f.ph) * 0.06; f.m.rotation.set(Math.sin(t + f.ph) * 0.08, f.ph, Math.cos(t * 0.8 + f.ph) * 0.08);
        const d = G.dist(f.x, f.z); if (d < bd) { bd = d; best = f; }
        if (d < 3.8) { f.got = true; f.m.visible = false; G.audio.pickup(); G.toast(`${s.floats.filter(x => x.got).length} / 8`, '', 0.8); }
      }
      if (!best) return 'done';
      toGate(s, G, { x: best.x, z: best.z, label: 'trap float' });
      return null;
    },
    hud(s) { const n = s.floats.filter(f => f.got).length; return { obj: `Floats collected ${n} of 8`, sub: 'The beacon marks the nearest one' }; },
    markers(s, G, out) { for (const f of s.floats) if (!f.got) out.push({ x: f.x, z: f.z, color: '#f07a2e', r: 3.5 }); },
  };

  // 5. Poacher chase ------------------------------------------------------------------------
  const chasePath = (() => {
    const pts = [];
    for (let z = 330; z > -665; z -= 12) {
      const cx = T.riverCenterX(z); const cxAhead = T.riverCenterX(z - 40);
      const inside = Math.sign(cxAhead - cx); // cut toward the inside of the coming bend
      pts.push({ x: cx + inside * T.riverHalfWidth(z) * 0.3, z });
    }
    return pts;
  })();
  const chase = {
    id: 'chase', title: 'Poacher Chase', desc: 'Two men in a johnboat just pulled a gill net out of the manatee zone. Run them down before they reach the bottom of the river.', reward: 650,
    gold: 55, silver: 70, bronze: 90,
    start: (G) => ({ x: T.riverCenterX(450), z: 450, heading: 0 }),
    setup(s, G) { G.skiff.start(chasePath, 12.6); s.boardT = 0; s.warned = false; },
    cleanup(s, G) { G.skiff.stop(); },
    update(s, G, dt) {
      const sk = G.skiff; const d = Math.hypot(sk.pos.x - G.phys.pos.x, sk.pos.y - G.phys.pos.y);
      sk.update(dt, s.t, d < 12 ? 0.35 : 0);
      toGate(s, G, { x: sk.pos.x, z: sk.pos.y, label: 'poachers' }, 0xf07a2e, null, false);
      if (d < 9) { s.boardT += dt; if (s.boardT > 1.5) return 'done'; } else s.boardT = Math.max(0, s.boardT - dt * 0.5);
      if (sk.done) return { fail: 'They made it out the bottom of the river.' };
      if (d > 220 && !s.warned) { s.warned = true; G.toast('Losing them', 'Cut the bends — jump the bars, they have to go round', 2.5); }
      return null;
    },
    hud(s, G) { const d = Math.hypot(G.skiff.pos.x - G.phys.pos.x, G.skiff.pos.y - G.phys.pos.y); return { obj: s.boardT > 0 ? `Boarding… ${Math.round(s.boardT / 1.5 * 100)}%` : `Poachers ${Math.round(d)} m ahead`, sub: 'Pull alongside and hold there for a moment' }; },
    markers(s, G, out) { out.push({ x: G.skiff.pos.x, z: G.skiff.pos.y, color: '#f07a2e', r: 5 }); },
  };

  // 6. Sandbar Sessions (stunt) -------------------------------------------------------------
  const park = kickers.filter(b => Math.hypot(b.x - T.lagoon.x, b.z - T.lagoon.y) < 90);
  const parkC = park.reduce((a, b) => ({ x: a.x + b.x / park.length, z: a.z + b.z / park.length }), { x: 0, z: 0 });
  const stunt = {
    id: 'stunt', title: 'Sandbar Sessions', desc: 'Two minutes in the lagoon stunt park. Chain airs, spins and drifts for 4,000 style points.', reward: 450, timeLimit: 120, target: 4000, restartOnR: true,
    start: (G) => ({ x: parkC.x + 60, z: parkC.z + 60, heading: G.headingTo(parkC.x + 60, parkC.z + 60, parkC.x, parkC.z) }),
    setup(s, G) { s.score = 0; },
    update(s, G) {
      if (s.score >= this.target) return 'done';
      if (s.t > this.timeLimit) return { fail: `Time. ${s.score.toLocaleString()} of ${this.target.toLocaleString()} points.` };
      const b = park[Math.floor(s.t / 20) % park.length];
      toGate(s, G, { x: b.x, z: b.z, label: 'kicker' }, 0xe5c063);
      return null;
    },
    hud(s) { return { obj: `Style ${s.score.toLocaleString()} / ${this.target.toLocaleString()}`, sub: 'Points bank when a chain ends · crashes bust the chain' }; },
    markers(s, G, out) { for (const b of park) out.push({ x: b.x, z: b.z, color: '#e5c063', r: 3 }); },
  };

  // 7. Supply run (cargo) -------------------------------------------------------------------
  const campWater = creekPt(-500);
  const campLand = (() => {
    let best = null, bd = 1e9;
    for (let a = 0; a < Math.PI * 2; a += 0.15) for (let r = 10; r < 40; r += 2) {
      const x = campWater.x + Math.cos(a) * r, z = campWater.z + Math.sin(a) * r; const h = T.heightAt(x, z);
      if (h > 0.5 && h < 1.6 && r < bd) { bd = r; best = { x, z, h }; }
    }
    return best || { x: campWater.x + 20, z: campWater.z, h: 0.6 };
  })();
  const DRUM_SLOTS = [[-0.62, 0.64, -1.55], [0.1, 0.64, -1.85], [0.7, 0.64, -1.2]];
  const cargo = {
    id: 'cargo', title: 'Supply Run', desc: 'Three drums of fuel from the tower dock to the fish camp at the top of the creek. Drums do not like being airborne.', reward: 550,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) {
      s.loaded = false; s.drums = []; s.lost = 0; s.pickT = 0;
      s.camp = shack(); s.camp.position.set(campLand.x, campLand.h - 0.3, campLand.z); s.camp.rotation.y = Math.atan2(campWater.x - campLand.x, campWater.z - campLand.z); G.scene.add(s.camp);
      s.floating = [];
    },
    cleanup(s, G) { for (const d of s.drums) G.boat.remove(d); for (const f of s.floating) G.scene.remove(f.m); G.scene.remove(s.camp); },
    dropDrum(s, G, why) {
      const d = s.drums.pop(); if (!d) return;
      G.boat.remove(d);
      const f = fuelDrum(); const p = G.phys; f.position.set(p.pos.x + (Math.random() - 0.5) * 2, 0.2, p.pos.y + (Math.random() - 0.5) * 2); f.rotation.set(Math.random(), Math.random() * 6, 1.3); G.scene.add(f);
      s.floating.push({ m: f, t: 0 });
      s.lost++; G.phys.loaded = 0.3 * s.drums.length; G.audio.warn(); G.toast('Lost a drum', why, 2);
    },
    update(s, G, dt, t) {
      const p = G.phys;
      for (const f of s.floating) { f.t += dt; f.m.position.y = 0.2 - Math.min(0.9, f.t * 0.05); f.m.rotation.z += dt * 0.1; }
      if (!s.loaded) {
        toGate(s, G, { x: dockTie.x, z: dockTie.z, label: 'tower dock' }, 0xf07a2e, campWater);
        if (G.dist(dockTie.x, dockTie.z) < 7 && G.mph() < 6) {
          s.loaded = true; s.pickT = s.t; s.limitStart = s.t; s.limitOverride = 210;
          for (const sl of DRUM_SLOTS) { const d = fuelDrum(); d.position.set(sl[0], sl[1], sl[2]); G.boat.add(d); s.drums.push(d); }
          p.loaded = 0.9; G.audio.checkpoint(); G.toast('Drums aboard', 'Fish camp is up the side creek · 3:30 · keep the hull on the water', 3.2);
        }
        return null;
      }
      toGate(s, G, { x: campWater.x, z: campWater.z, label: 'fish camp' }, 0x7be08a);
      if (s.t - s.pickT > 210) return { fail: 'Too slow. The camp sent a boat of their own.' };
      if (s.drums.length) {
        if (p.landedFrame && p.airTime > 0.45) this.dropDrum(s, G, 'It came down hard off that jump');
        else if (p.impact > 6.5) this.dropDrum(s, G, 'Slammed the hull');
        else if (Math.abs(p.roll) > 0.6) this.dropDrum(s, G, 'Rolled it off the deck');
        else if (p.hit > 5) this.dropDrum(s, G, 'Knocked off in the collision');
        for (const d of s.drums) d.rotation.set(Math.sin(t * 9) * 0.03 * Math.min(1, p.speed / 8), 0, Math.cos(t * 7) * 0.03 * Math.min(1, p.speed / 8));
      }
      if (!s.drums.length) return { fail: 'All three drums are in the river. Nothing left to deliver.' };
      if (G.dist(campWater.x, campWater.z) < 9 && G.mph() < 7) { s.rewardK = s.drums.length / 3; return 'done'; }
      return null;
    },
    hud(s) { return s.loaded ? { obj: `Drums aboard ${s.drums.length} of 3`, sub: 'Big jumps, slams and rolls throw them off · under 7 mph at the camp' } : { obj: 'Load up at the tower dock', sub: 'Under 6 mph alongside' }; },
    markers(s, G, out) { out.push(s.loaded ? { x: campWater.x, z: campWater.z, color: '#7be08a', r: 5 } : { x: dockTie.x, z: dockTie.z, color: '#f07a2e', r: 5 }); },
  };

  // 8. Lost kayaker (rescue) ----------------------------------------------------------------
  const kayakSpot = (() => {
    const rr = mulberry32(7); let best = null;
    for (let i = 0; i < 4000; i++) {
      const z = -420 - rr() * 120; const c = creekPt(z); const x = c.x + (rr() - 0.5) * 120;
      const h = T.heightAt(x, z); if (h > -0.5 || h < -1.6) continue;
      if (Math.abs(x - c.x) < 20) continue; // off the creek, in a pool
      best = { x, z }; break;
    }
    return best || creekPt(-460);
  })();
  const rescue = {
    id: 'rescue', title: 'Lost Kayaker', desc: 'A kayaker is stuck in the back pools past the side creek. Get to them, then bring them to the dock inside three minutes.', reward: 600,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) { s.k = kayak(); s.k.position.set(kayakSpot.x, 0, kayakSpot.z); s.k.rotation.y = 1.1; G.scene.add(s.k); s.aboard = false; s.pickT = 0; },
    cleanup(s, G) { G.scene.remove(s.k); },
    update(s, G, dt, t) {
      if (!s.aboard) {
        s.k.position.y = Math.sin(t * 1.1) * 0.05; s.k.userData.arm.rotation.z = -0.9 + Math.sin(t * 6) * 0.5;
        toGate(s, G, { x: kayakSpot.x, z: kayakSpot.z, label: 'kayaker' }, 0x7be08a);
        if (G.dist(kayakSpot.x, kayakSpot.z) < 6 && G.mph() < 7) { s.aboard = true; s.k.visible = false; G.phys.loaded = 1; s.pickT = s.t; s.limitStart = s.t; s.limitOverride = 180; G.audio.checkpoint(); G.toast('Kayaker aboard', 'Back to the tower dock · 3:00', 3); }
      } else {
        toGate(s, G, { x: dockTie.x, z: dockTie.z, label: 'tower dock' }, 0x7be08a);
        if (s.t - s.pickT > 180) return { fail: 'Too slow. The kayaker is in a bad way.' };
        if (G.dist(dockTie.x, dockTie.z) < 7 && G.mph() < 8) return 'done';
      }
      return null;
    },
    hud(s) { return s.aboard ? { obj: 'Get to the dock', sub: 'Under 8 mph at the dock · the boat is heavier now' } : { obj: 'Find the kayaker', sub: 'Follow the side creek, then cut across the pools' }; },
    markers(s, G, out) { out.push(s.aboard ? { x: dockTie.x, z: dockTie.z, color: '#7be08a', r: 5 } : { x: kayakSpot.x, z: kayakSpot.z, color: '#7be08a', r: 5 }); },
  };

  // 9. Nuisance gator (stealth + tow) -------------------------------------------------------
  const gatorSpot = G.findSpot(311, -300, -60, -1.6, -0.8, 30, 90, (x, z) => Math.abs(x - T.riverCenterX(z)) > T.riverHalfWidth(z) + 25);
  const release = G.river(560, 0);
  const gator = {
    id: 'gator', title: 'Nuisance Gator', desc: 'The old bull has been under the tower dock all week. Ease up on him in the back pool — anything over 6 mph and he goes under — noose him, and tow him to the top of the river.', reward: 550,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) {
      const g = G.gators.list[0]; s.g = g; g.pos.set(gatorSpot.x, -0.12, gatorSpot.z); g.dive = 0; g.speed = 0.15; g.parked = true; s.noosed = false; s.hold = 0; s.spooks = 0; s.warnT = 0; s.thrash = 0;
    },
    cleanup(s, G) { const g = s.g; g.parked = false; g.towed = false; g.speed = 0.3; G.phys.towDrag = 0; },
    update(s, G, dt, t) {
      const g = s.g, p = G.phys; const d = Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.y);
      s.warnT -= dt;
      if (!s.noosed) {
        toGate(s, G, { x: g.pos.x, z: g.pos.z, label: 'bull gator' }, 0x7be08a, null, false);
        if (d < 32 && G.mph() > 6 && g.dive <= 0) {
          g.dive = 12; s.spooks++; s.hold = 0;
          if (s.warnT <= 0) { s.warnT = 3; G.toast('He went under', 'Idle speed only inside 30 m', 2); G.audio.warn(); }
          if (s.spooks >= 4) return { fail: 'You spooked him four times. He is gone for the day.' };
          // resurfaces somewhere nearby
          const a = Math.random() * Math.PI * 2; let nx = g.pos.x, nz = g.pos.z;
          for (let i = 0; i < 20; i++) { const tx = gatorSpot.x + Math.cos(a + i) * 18, tz = gatorSpot.z + Math.sin(a + i) * 18; const h = T.heightAt(tx, tz); if (h < -0.8 && h > -1.8) { nx = tx; nz = tz; break; } }
          g.pos.x = nx; g.pos.z = nz;
        }
        if (g.dive <= 0 && d < 5.5 && G.mph() < 4) { s.hold += dt; if (s.hold >= 3) { s.noosed = true; g.towed = true; g.dive = 0; p.towDrag = 0.022; p.loaded = 0.6; s.limitStart = s.t; s.limitOverride = 240; G.audio.checkpoint(); G.toast('Noosed', 'Tow him to the top of the river · 4:00 · keep it under 20 mph or he thrashes', 3.5); } }
        else s.hold = Math.max(0, s.hold - dt);
        s.holdView = s.hold;
      } else {
        toGate(s, G, { x: release.x, z: release.z, label: 'release point' }, 0x7be08a);
        // the gator trails on the rope behind the transom
        const f = p.forward(); const tx = p.pos.x + f.x * 7, tz = p.pos.y + f.y * 7;
        g.pos.x += (tx - g.pos.x) * (1 - Math.exp(-dt * 3)); g.pos.z += (tz - g.pos.z) * (1 - Math.exp(-dt * 3));
        g.heading = p.heading + Math.sin(t * 3) * 0.2; g.dive = 0;
        if (G.mph() > 20) { s.thrash += dt; if (s.thrash > 0.6) { s.thrash = 0; p.angVel += (Math.random() < 0.5 ? -1 : 1) * 1.4; p.rollVel += (Math.random() - 0.5) * 2; G.shake = Math.min(1, G.shake + 0.4); G.toast('He is thrashing', 'Ease off', 1.2); } }
        if (s.t - s.limitStart > 240) return { fail: 'Out of time. He slipped the noose.' };
        if (G.dist(release.x, release.z) < 9 && G.mph() < 5) return 'done';
      }
      return null;
    },
    hud(s, G) { return s.noosed ? { obj: 'Tow him to the release point', sub: 'Under 20 mph or he fights the rope · under 5 mph to let him go' } : { obj: s.holdView > 0 ? `Noosing… ${Math.round(s.holdView / 3 * 100)}%` : 'Find the bull in the back pool', sub: `Under 6 mph inside 30 m · spooked ${s.spooks} of 3` }; },
    markers(s, G, out) { out.push(s.noosed ? { x: release.x, z: release.z, color: '#7be08a', r: 5 } : { x: s.g.pos.x, z: s.g.pos.z, color: '#7be08a', r: 5 }); },
  };

  // 10. Creek Gauntlet ----------------------------------------------------------------------
  const gauntZ = [60, 0, -60, -120, -180, -240, -300, -360, -420, -480, -540];
  const gauntGates = gauntZ.map((z, i) => { const c = creekPt(z); const bank = i > 0 && i % 3 === 0; const side = (i % 2 ? 1 : -1); return { x: c.x + side * (bank ? 26 : 5), z, r: bank ? 8 : 7, label: bank ? 'Bank gate · over the flats' : '' }; });
  const gauntlet = { id: 'gauntlet', title: 'Creek Gauntlet', desc: 'The side creek: narrow, twisting, trees on both banks, and three gates up on the flats. Gold under 1:10.', reward: 700, countdown: true, gold: 70, silver: 85, bronze: 110, start: (G) => { const c = creekPt(100); return { x: c.x, z: 100, heading: 0 }; }, ...sequence(gauntGates) };

  // 11. Sunken skiff (sonar search) ---------------------------------------------------------
  const wreckSpots = [G.findSpot(501, -380, -120, -1.5, -0.7, 20, 80), G.findSpot(502, -640, -420, -1.5, -0.7, 20, 80)];
  const sonar = {
    id: 'sonar', title: 'Sunken Skiff', desc: 'An insurance man wants two johnboats that went down in the storm. No marker — just a fish-finder that beeps faster the closer you get.', reward: 450,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: 0 }),
    setup(s, G) { s.w = wreckSpots.map(p => { const m = wreck(); m.position.set(p.x, 0, p.z); m.visible = false; G.scene.add(m); return { m, x: p.x, z: p.z, found: false }; }); s.hold = 0; s.beepT = 0; s.signal = 0; },
    cleanup(s, G) { for (const w of s.w) G.scene.remove(w.m); },
    update(s, G, dt) {
      const left = s.w.filter(w => !w.found); if (!left.length) return 'done';
      let best = null, bd = 1e9; for (const w of left) { const d = G.dist(w.x, w.z); if (d < bd) { bd = d; best = w; } }
      s.signal = Math.max(0, Math.min(1, 1 - bd / 160));
      s.beepT -= dt; if (s.beepT <= 0) { s.beepT = 0.18 + (1 - s.signal) * 1.6; G.audio.tone(900 + s.signal * 600, 0.05, 0.08 + s.signal * 0.12, 'sine'); }
      G.wpTarget = null; G.beacon.hide(); G.beacon2.hide();
      if (bd < 8 && G.mph() < 5) { s.hold += dt; if (s.hold > 1.5) { best.found = true; best.m.visible = true; s.hold = 0; G.audio.checkpoint(); G.toast('Found one', `${s.w.filter(w => w.found).length} of 2 marked`, 2); } } else s.hold = Math.max(0, s.hold - dt);
      for (const w of s.w) if (w.found) G.beacon2.set(w.x, 0, w.z);
      return null;
    },
    hud(s) { const n = Math.round(s.signal * 10); return { obj: `Signal ${'▮'.repeat(n)}${'▯'.repeat(10 - n)}`, sub: s.hold > 0 ? `Marking… ${Math.round(s.hold / 1.5 * 100)}%` : `${s.w.filter(w => w.found).length} of 2 found · slow to under 5 mph over the wreck` }; },
    markers(s, G, out) { for (const w of s.w) if (w.found) out.push({ x: w.x, z: w.z, color: '#f3ede0', r: 3 }); },
  };

  // 12. Big Air contest ---------------------------------------------------------------------
  const bigK = park.slice().sort((a, b) => b.h - a.h)[0] || kickers[0];
  const bigStart = () => ({ x: bigK.x - bigK.dx * 80, z: bigK.z - bigK.dz * 80, heading: G.headingTo(bigK.x - bigK.dx * 80, bigK.z - bigK.dz * 80, bigK.x, bigK.z) });
  const bigair = {
    id: 'bigair', title: 'Big Air', desc: 'Three runs at the tallest kicker in the lagoon. Your best single jump counts: air, spins and a clean landing. Gold at 1,200.', reward: 500, scoreMedal: [1200, 850, 550], scoreLabel: 'Best jump', restartOnR: true,
    start: () => bigStart(),
    setup(s, G) { s.score = 0; s.attempt = 1; s.landedT = -1; s.last = 0; },
    update(s, G, dt) {
      const p = G.phys;
      toGate(s, G, { x: bigK.x, z: bigK.z, label: 'kicker' }, 0xe5c063);
      if (s.landedT < 0) {
        if (p.landedFrame && p.airTime > 0.25) {
          const l = G.tricks.lastLanding; s.last = l && (l.q === 'clean' || l.q === 'hard') ? l.pts : 0;
          s.score = Math.max(s.score, s.last); s.landedT = 0;
          G.toast(s.last ? `${s.last.toLocaleString()} points` : 'No score', l.q === 'wipeout' ? 'Wipeout' : l.q === 'stuffed' ? 'Nose dive' : l.q === 'hard' ? 'Hard landing' : `Run ${s.attempt} of 3`, 2.2);
        } else if (G.dist(bigK.x, bigK.z) > 140) { s.landedT = 0; s.last = 0; G.toast('Missed the kicker', `Run ${s.attempt} of 3`, 2); }
      } else {
        s.landedT += dt;
        if (s.landedT > 2.4) {
          if (s.attempt >= 3) return s.score >= this.scoreMedal[2] ? 'done' : { fail: `Best jump ${s.score.toLocaleString()}. Needs ${this.scoreMedal[2].toLocaleString()} for bronze.` };
          s.attempt++; s.landedT = -1; const st = bigStart(); G.phys.reset(st.x, st.z, st.heading); G.tricks.bust('');
        }
      }
      return null;
    },
    hud(s) { return { obj: `Run ${s.attempt} of 3 · best ${s.score.toLocaleString()}`, sub: 'Full throttle, lean back with S, A / D to spin' }; },
    markers(s, G, out) { out.push({ x: bigK.x, z: bigK.z, color: '#e5c063', r: 5 }); },
  };

  // 13. Grand tour --------------------------------------------------------------------------
  // down the river, across the back pools at their wettest line (z -400), up the creek, and back across at z -60
  const tourGates = [];
  for (let z = 30; z >= -340; z -= 60) tourGates.push(gateAt(G.river(z, (tourGates.length % 3) === 1 ? 0.5 : (tourGates.length % 3) === 2 ? -0.5 : 0)));
  { const a = T.riverCenterX(-400), c = creekPt(-400); tourGates.push({ x: a + (c.x - a) * 0.5, z: -400, r: 10, label: 'Across the back pools' }); tourGates.push({ x: c.x, z: -400, r: 9, label: 'Up the creek' }); }
  for (let z = -340; z <= 20; z += 60) { const c = creekPt(z); tourGates.push({ x: c.x, z, r: 8, label: '' }); }
  { const a = T.riverCenterX(-60), c = creekPt(-60); tourGates.push({ x: a + (c.x - a) * 0.5, z: -60, r: 10, label: 'Back across to the river' }); }
  tourGates.push({ ...gateAt(G.river(G.startZ)), label: 'Finish at the start' });
  const tour = { id: 'tour', title: 'Bayou Grand Tour', desc: `The big lap: down the river, across the back pools, up the creek and back over the flats. ${tourGates.length} gates. Gold under 1:50.`, reward: 900, countdown: true, gold: 110, silver: 135, bronze: 170, start: (G) => ({ x: G.startX, z: G.startZ + 20, heading: 0 }), ...sequence(tourGates) };

  // 14. Split clock -------------------------------------------------------------------------
  // Every gate starts a new deadline. A weak leg cannot be hidden inside one very fast straight, so the driver has
  // to hold speed through every bend rather than learning one shortcut through a single global stopwatch.
  const splitStart = gateAt(G.river(440), 'Starting line');
  const splitZ = [360, 285, 210, 135, 55, -30, -110, -190, -280, -380];
  const splitGates = splitZ.map((z, i) => gateAt(G.river(z, i % 2 ? 0.58 : -0.58)));
  {
    let prev = splitStart;
    for (const [i, gate] of splitGates.entries()) {
      const distance = Math.hypot(gate.x - prev.x, gate.z - prev.z);
      gate.limit = Math.max(11, Math.min(18, Math.ceil(distance / 7.2) + 4));
      gate.label = `Split ${i + 1} · ${gate.limit} seconds`; prev = gate;
    }
  }
  const splits = {
    id: 'splits', title: 'Redline Splits', desc: `${splitGates.length} checkpoint clocks down the river. Every gate starts a fresh deadline; miss one split and the run is over.`, reward: 760, countdown: true, gold: 66, silver: 82, bronze: 105,
    start: (G) => ({ x: splitStart.x, z: splitStart.z, heading: G.headingTo(splitStart.x, splitStart.z, splitGates[0].x, splitGates[0].z) }),
    setup(s) { s.i = 0; s.limitStart = 0; s.limitOverride = splitGates[0].limit; s.splits = []; },
    update(s, G) {
      const gate = splitGates[s.i], remaining = splitRemaining(s.t, s.limitStart, gate.limit);
      toGate(s, G, gate, s.i === splitGates.length - 1 ? 0x7be08a : 0xf07a2e, splitGates[s.i + 1]);
      if (reached(G, gate)) {
        const legTime = s.t - s.limitStart; s.splits.push(legTime); s.i++; G.audio.checkpoint();
        if (s.i >= splitGates.length) return 'done';
        s.limitStart = s.t; s.limitOverride = splitGates[s.i].limit;
        G.toast(`Split ${s.i} · ${fmtT(legTime)}`, `${splitGates[s.i].limit} seconds to the next gate`, 1.4);
      } else if (remaining <= 0) return { fail: `Missed split ${s.i + 1}. The next gate closed.` };
      return null;
    },
    hud(s) { const gate = splitGates[Math.min(s.i, splitGates.length - 1)]; return { obj: `Split ${Math.min(s.i + 1, splitGates.length)} of ${splitGates.length}`, sub: `${splitRemaining(s.t, s.limitStart, gate.limit).toFixed(1)} seconds to make the gate` }; },
    markers(s, G, out) { for (let i = s.i; i < Math.min(splitGates.length, s.i + 3); i++) out.push({ x: splitGates[i].x, z: splitGates[i].z, color: i === s.i ? '#f07a2e' : 'rgba(243,237,224,0.6)', r: i === s.i ? 5 : 3 }); },
  };

  // 15. Three-kicker circuit ---------------------------------------------------------------
  const rampCourse = (park.length >= 3 ? park : kickers).slice(0, 3).map(bar => ({ bar, approach: rampPoint(bar, -40), landing: rampPoint(bar, 25) }));
  const rampcircuit = {
    id: 'rampcircuit', title: 'Three-Kicker Circuit', desc: 'Line up all three lagoon kickers. A gate only counts after the correct launch and a landing on the far side.', reward: 820, countdown: true, gold: 68, silver: 88, bronze: 118,
    start: (G) => { const first = rampCourse[0]; return { x: first.approach.x, z: first.approach.z, heading: G.headingTo(first.approach.x, first.approach.z, first.bar.x, first.bar.z) }; },
    setup(s) { s.i = 0; s.stage = 'approach'; s.penalties = 0; },
    update(s, G) {
      const run = rampCourse[s.i], p = G.phys;
      if (s.stage === 'approach') {
        toGate(s, G, { ...run.approach, label: `Line up kicker ${s.i + 1}` }, 0xf07a2e, run.bar);
        if (G.dist(run.approach.x, run.approach.z) < 11) { s.stage = 'ramp'; G.audio.checkpoint(); G.toast(`Kicker ${s.i + 1}`, 'Hold the line through the crest', 1.5); }
      } else if (s.stage === 'ramp') {
        toGate(s, G, { x: run.bar.x, z: run.bar.z, label: `Kicker ${s.i + 1}` }, 0xe5c063, run.landing);
        if ((p.takeoffFrame || p.airborne) && G.dist(run.bar.x, run.bar.z) < 22) { s.stage = 'air'; G.audio.checkpoint(); }
      } else {
        toGate(s, G, { ...run.landing, label: 'Land beyond the kicker' }, 0x7be08a, rampCourse[s.i + 1]?.approach);
        if (p.landedFrame) {
          const quality = G.tricks.lastLanding?.q || p.landQuality; const onLine = G.dist(run.landing.x, run.landing.z) < 65;
          if (p.airTime > 0.35 && quality !== 'wipeout' && onLine) {
            if (quality === 'stuffed') { s.t += 3; s.penalties += 3; G.toast('Heavy landing · +3 seconds', `${s.i + 1} of ${rampCourse.length} kickers cleared`, 1.7); }
            else G.toast('Kicker cleared', `${s.i + 1} of ${rampCourse.length}`, 1.2);
            s.i++; G.audio.checkpoint();
            if (s.i >= rampCourse.length) return 'done';
            s.stage = 'approach';
          } else {
            s.t += 4; s.penalties += 4; s.stage = 'approach';
            G.toast('Ramp does not count · +4 seconds', onLine ? 'Land it without a wipeout' : 'Use the marked kicker and land beyond it', 2);
          }
        }
      }
      return null;
    },
    hud(s) { const action = s.stage === 'approach' ? 'Line up' : s.stage === 'ramp' ? 'Take the kicker' : 'Land beyond the crest'; return { obj: `${action} · ${Math.min(s.i + 1, rampCourse.length)} of ${rampCourse.length}`, sub: s.penalties ? `${s.penalties} seconds in penalties` : 'The launch and landing both have to register' }; },
    markers(s, G, out) { const run = rampCourse[Math.min(s.i, rampCourse.length - 1)]; out.push({ x: run.bar.x, z: run.bar.z, color: '#e5c063', r: 5 }); for (let i = s.i + 1; i < rampCourse.length; i++) out.push({ x: rampCourse[i].bar.x, z: rampCourse[i].bar.z, color: 'rgba(229,192,99,0.55)', r: 3 }); },
  };

  // 16. Dispatch relay ---------------------------------------------------------------------
  const crossPool = (z, amount = 0.5) => { const river = G.river(z), creek = creekPt(z); return { x: river.x + (creek.x - river.x) * amount, z }; };
  const relayLegs = [
    { name: 'Tower case', pickup: { x: dockTie.x, z: dockTie.z }, drop: G.river(-260, 0.28), limit: 62, gates: [gateAt(G.river(-40, -0.45), 'South bend'), gateAt(G.river(-135, 0.5), 'Cut inside'), gateAt(G.river(-220, -0.4), 'Handoff ahead')] },
    { name: 'River case', pickup: G.river(-300, -0.42), drop: campWater, limit: 78, gates: [gateAt(G.river(-365, 0.45), 'Leave the main channel'), { ...crossPool(-420, 0.52), r: 10, label: 'Cross the back pools' }, { ...creekPt(-470), r: 8, label: 'Enter the creek' }] },
    { name: 'Camp case', pickup: { x: campWater.x + 4, z: campWater.z + 2 }, drop: { x: dockTie.x, z: dockTie.z }, limit: 105, gates: [{ ...creekPt(-420), r: 8, label: 'Down the creek' }, { ...crossPool(-350, 0.48), r: 10, label: 'Cross to the river' }, gateAt(G.river(-275, -0.35), 'Main channel'), gateAt(G.river(-145, 0.45), 'North bend'), gateAt(G.river(-35, -0.35), 'Tower ahead')] },
  ];
  const relay = {
    id: 'relay', title: 'Dispatch Relay', desc: 'Three waterproof cases, three pickups and three handoffs. Hit the route gates, slow down at both ends, and recover anything thrown overboard.', reward: 980, countdown: true, gold: 185, silver: 225, bronze: 285,
    start: (G) => ({ x: G.startX, z: G.startZ, heading: G.headingTo(G.startX, G.startZ, dockTie.x, dockTie.z) }),
    setup(s, G) {
      s.leg = 0; s.stage = 'pickup'; s.route = 0; s.ejections = 0;
      s.cases = relayLegs.map((leg, i) => { const m = raceCase(); m.position.set(leg.pickup.x, 0.18, leg.pickup.z); m.rotation.y = i * 1.7; G.scene.add(m); return { m, x: leg.pickup.x, z: leg.pickup.z, phase: i * 1.9, delivered: false }; });
    },
    cleanup(s, G) { for (const box of s.cases) box.m.removeFromParent(); G.phys.loaded = 0; },
    attach(s, G, recovered = false) {
      const leg = relayLegs[s.leg], box = s.cases[s.leg]; box.m.removeFromParent(); G.boat.add(box.m); box.m.position.set(0, 0.7, -1.55); box.m.rotation.set(0, 0, 0);
      G.phys.loaded = 0.42; s.stage = s.route >= leg.gates.length ? 'dropoff' : 'route';
      if (!recovered) { s.route = 0; s.limitStart = s.t; s.limitOverride = leg.limit; }
      G.audio.checkpoint(); G.toast(recovered ? 'Case recovered' : `${leg.name} aboard`, recovered ? 'The split clock kept running' : `${leg.limit} seconds to the handoff`, 2);
    },
    eject(s, G, reason) {
      const box = s.cases[s.leg], p = G.phys; box.m.removeFromParent(); G.scene.add(box.m); box.x = p.pos.x; box.z = p.pos.y; box.m.position.set(box.x, 0.18, box.z); box.m.rotation.set(0.15, p.heading, 0.25);
      G.phys.loaded = 0; s.stage = 'recover'; s.ejections++; G.audio.warn(); G.toast('Case overboard', `${reason} · slow down and recover it`, 2.4);
    },
    deliver(s, G) {
      const leg = relayLegs[s.leg], box = s.cases[s.leg]; box.m.removeFromParent(); G.scene.add(box.m); box.x = leg.drop.x + (s.leg - 1) * 1.1; box.z = leg.drop.z + s.leg * 0.8; box.m.position.set(box.x, 0.18, box.z); box.m.rotation.set(0, s.leg * 1.4, 0); box.delivered = true;
      G.phys.loaded = 0; delete s.limitOverride; G.audio.pickup(); G.toast(`Handoff ${s.leg + 1} of ${relayLegs.length}`, s.leg + 1 < relayLegs.length ? 'Next case is marked' : 'Relay complete', 1.8);
      s.leg++; s.route = 0; s.stage = 'pickup';
      return s.leg >= relayLegs.length ? 'done' : null;
    },
    update(s, G, dt, t) {
      for (const box of s.cases) if (box.m.parent === G.scene) { box.m.position.y = 0.18 + Math.sin(t * 1.25 + box.phase) * 0.05; box.m.rotation.z = Math.sin(t * 0.8 + box.phase) * 0.06; }
      const leg = relayLegs[s.leg], box = s.cases[s.leg];
      if (s.stage !== 'pickup' && splitRemaining(s.t, s.limitStart, leg.limit) <= 0) return { fail: `The ${leg.name.toLowerCase()} missed its handoff window.` };
      if (s.stage === 'pickup' || s.stage === 'recover') {
        const recovering = s.stage === 'recover'; toGate(s, G, { x: box.x, z: box.z, label: recovering ? 'case overboard' : leg.name.toLowerCase() }, recovering ? 0xe5c063 : 0x8fb8d8, leg.gates[0]);
        if (G.dist(box.x, box.z) < 5.5 && G.mph() < 7) this.attach(s, G, recovering);
        return null;
      }
      const reason = cargoEjectionReason(G.phys); if (reason) { this.eject(s, G, reason); return null; }
      if (s.stage === 'route') {
        const gate = leg.gates[s.route]; toGate(s, G, gate, 0xf07a2e, leg.gates[s.route + 1] || leg.drop);
        if (reached(G, gate)) { s.route++; G.audio.checkpoint(); if (s.route >= leg.gates.length) { s.stage = 'dropoff'; G.toast('Handoff ahead', 'Bring it in under 7 mph', 1.5); } }
      } else {
        toGate(s, G, { ...leg.drop, label: 'handoff' }, 0x7be08a);
        if (G.dist(leg.drop.x, leg.drop.z) < 7 && G.mph() < 7) return this.deliver(s, G);
      }
      return null;
    },
    hud(s) { const leg = relayLegs[Math.min(s.leg, relayLegs.length - 1)]; if (s.stage === 'pickup') return { obj: `Pickup ${Math.min(s.leg + 1, relayLegs.length)} of ${relayLegs.length}`, sub: `${leg.name} · slow below 7 mph` }; if (s.stage === 'recover') return { obj: 'Recover the case', sub: `${splitRemaining(s.t, s.limitStart, leg.limit).toFixed(1)} seconds remain · below 7 mph alongside` }; if (s.stage === 'dropoff') return { obj: `Handoff ${s.leg + 1} of ${relayLegs.length}`, sub: 'Under 7 mph inside the green marker' }; return { obj: `Route gate ${Math.min(s.route + 1, leg.gates.length)} of ${leg.gates.length}`, sub: `${splitRemaining(s.t, s.limitStart, leg.limit).toFixed(1)} seconds remain · ${s.ejections} cases thrown overboard` }; },
    markers(s, G, out) { if (s.leg >= relayLegs.length) return; const leg = relayLegs[s.leg], box = s.cases[s.leg]; if (s.stage === 'pickup' || s.stage === 'recover') out.push({ x: box.x, z: box.z, color: s.stage === 'recover' ? '#e5c063' : '#8fb8d8', r: 5 }); else if (s.stage === 'route') { for (let i = s.route; i < Math.min(leg.gates.length, s.route + 3); i++) out.push({ x: leg.gates[i].x, z: leg.gates[i].z, color: i === s.route ? '#f07a2e' : 'rgba(243,237,224,0.6)', r: i === s.route ? 5 : 3 }); } else out.push({ x: leg.drop.x, z: leg.drop.z, color: '#7be08a', r: 5 }); },
  };

  return [shakedown, manatee, sprint, traps, chase, stunt, cargo, rescue, gator, gauntlet, sonar, bigair, tour, splits, rampcircuit, relay];
}
