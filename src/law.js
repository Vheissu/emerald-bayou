import { Vector3 } from 'three';
import { pursuitSightSampleCount, wantedLevel } from './pursuit.js';

const clamp = (v, lo = 0, hi = 5) => Math.max(lo, Math.min(hi, v));
const finite = value => Number.isFinite(value);
const reportDuration = 78;
const escapeHtml = value => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

function restoreReport(report) {
  if (!report || ![report.x, report.z, report.heading, report.amount, report.remaining].every(finite)
    || report.amount <= 0 || report.remaining <= 0 || typeof report.source !== 'string' || typeof report.reason !== 'string') return null;
  return report;
}

export function witnessCanSee(terrain, source, target, range) {
  const dx = target.x - source.x, dz = target.z - source.z, distance = Math.hypot(dx, dz);
  if (!finite(distance) || distance > range) return false;
  const segments = pursuitSightSampleCount(distance) * 2;
  for (let i = 1; i < segments; i++) {
    const along = i / segments;
    const h = terrain.heightAt(source.x + dx * along, source.z + dz * along);
    if (h + 0.28 > source.y + (target.y - source.y) * along) return false;
  }
  return true;
}

export function pursuitStatusLabel(pursuit, visual = true) {
  if (!pursuit) return 'Wanted';
  return visual ? 'Wanted · FWC pursuit' : 'Wanted · FWC searching';
}

export class Law {
  constructor(o) {
    Object.assign(this, o); // game, phys, environment, audio, terrain, world, traffic
    this.stats = this.game.save.law || { citations: 0, escapes: 0, cleanChecks: 0, violations: 0, seizures: 0 };
    this.game.save.law = this.stats;
    this.attention = clamp(Number(this.stats.attention) || 0); this.sinceEvent = 999; this.violationCd = 0; this.pursuit = false; this.pursuitVisual = false;
    this.hotCargoT = 0; this.lastReason = typeof this.stats.lastReason === 'string' ? this.stats.lastReason : ''; this.hudT = 0; this.enabled = false;
    this.stats.pendingReport = restoreReport(this.stats.pendingReport);
    this.stats.dispatchReport = restoreReport(this.stats.dispatchReport);
    this.responding = false;
    this.witnessPosition = new Vector3();
    this.el = document.getElementById('lawState');
    this.keyHandler = e => { if (import.meta.env.DEV && e.code === 'F4' && !e.repeat && this.enabled) { e.preventDefault(); this.add(3.2, 'reported collision'); } };
    window.addEventListener('keydown', this.keyHandler);
  }

  add(amount, reason = 'reported activity', announce = true, dispatch = true) {
    const before = this.attention; this.attention = clamp(this.attention + amount); this.sinceEvent = 0; this.lastReason = reason;
    if (amount > 0) this.stats.violations = (this.stats.violations || 0) + 1;
    if (announce && amount > 0 && Math.ceil(this.attention) > Math.ceil(before)) { this.audio.warn(); this.game.toast('FWC attention', reason, 2.4); }
    this.rememberAttention(); this.game.persist(); if (dispatch && this.onAttention) this.onAttention(this.attention);
  }

  violation(amount, reason, announce = false) {
    if (this.violationCd > 0) return;
    this.violationCd = Math.max(2.5, amount * 4); this.add(amount, reason, announce);
  }

  findWitness() {
    if (!this.terrain) return '';
    const p = this.phys, E = this.environment;
    const level = E.waterLevel || 0, target = { x: p.pos.x, z: p.pos.y, y: Math.max(level, p.y || 0) + 1.15 };
    const range = 118 * (1 - clamp(E.restrictedVisibility || 0, 0, 1) * 0.66) * (1 - clamp(E.night || 0, 0, 1) * 0.42);
    let witness = '', nearest = range;
    const consider = (name, x, y, z) => {
      const distance = Math.hypot(x - target.x, z - target.z);
      if (distance < nearest && witnessCanSee(this.terrain, { x, y, z }, target, nearest)) {
        witness = name; nearest = distance;
      }
    };
    for (const b of this.traffic?.boats || []) {
      if (b.active && b.profile?.callsign) consider(b.profile.callsign, b.x, level + (b.kind === 'canoe' ? 0.9 : 1.45), b.z);
    }
    const crew = (name, group) => {
      const site = group?.userData.site;
      if (!site || Math.hypot(site.x - target.x, site.z - target.z) > nearest + 50) return;
      for (const person of group.userData.people || []) {
        if (!person.visible) continue;
        const pos = person.getWorldPosition(this.witnessPosition);
        consider(name, pos.x, pos.y + 1.2, pos.z);
      }
    };
    for (const group of this.world?.liveCamps?.values() || []) crew(group.userData.site?.name || 'Fish camp', group);
    for (const { site, g } of this.world?.liveSites?.values() || []) {
      if (site.kind !== 'blind') crew(site.kind === 'ramp' ? 'Ramp crew' : 'Dock crew', g);
    }
    return witness;
  }

  reportViolation(amount, reason, source = '', fix = null) {
    if (!(amount > 0) || !finite(amount)) return false;
    const witness = source || this.findWitness();
    if (!witness) return false;
    const pending = this.stats.pendingReport;
    if (pending && pending.amount >= amount) return false;
    const p = this.phys;
    const report = { amount, reason, source: witness, x: fix?.x ?? p.pos.x, z: fix?.z ?? p.pos.y,
      heading: fix?.heading ?? p.heading, remaining: pending ? pending.remaining : amount >= 0.7 ? 2.4 : 4.2 };
    if (!restoreReport(report)) return false;
    this.stats.pendingReport = report;
    this.game.persist();
    return true;
  }

  updateReports(dt) {
    const dispatch = this.stats.dispatchReport;
    if (dispatch) {
      dispatch.remaining -= dt;
      if (dispatch.remaining <= 0) { this.stats.dispatchReport = null; this.game.persist(); }
    }
    const report = this.stats.pendingReport;
    if (!report) return;
    report.remaining -= dt;
    if (report.remaining > 0) return;
    this.stats.pendingReport = null;
    // Pull the call when the same patrol already has the hull under observation.
    if (!this.pursuit) {
      report.remaining = reportDuration;
      this.stats.dispatchReport = report;
    }
    this.stats.witnessReports = (this.stats.witnessReports || 0) + 1;
    const reason = report.reason + ' reported by ' + report.source;
    this.add(report.amount, reason, false, false);
    this.radio?.transmit({
      channel: 'FWC TAC', speaker: 'FWC DISPATCH',
      text: `Twenty-seven, ${report.source} reported ${report.reason}. Check the last fix for Tower Boat.`,
      priority: 3, key: 'witness-dispatch', cooldown: 4,
    });
  }

  takeDispatchReport() {
    const report = this.stats.dispatchReport;
    this.stats.dispatchReport = null;
    this.game.persist();
    return report;
  }

  rememberAttention() { this.stats.attention = Math.round(this.attention * 1000) / 1000; this.stats.lastReason = this.lastReason; }

  cool(amount) { this.attention = clamp(this.attention - amount); this.sinceEvent = Math.max(this.sinceEvent, 25); this.rememberAttention(); }

  addContraband() {
    this.hotCargoT = Math.max(this.hotCargoT, 190); this.add(1.65, 'unmarked cargo reported in the channel');
    if (this.game.reputation) this.game.reputation.change('fwc', -0.8, 'contraband', 'The unmarked package put the hull on an FWC call sheet.', false);
  }

  hasContraband() { return this.hotCargoT > 0; }

  confiscate() {
    if (!this.hasContraband()) return false;
    this.hotCargoT = 0; this.stats.seizures = (this.stats.seizures || 0) + 1; this.stats.citations = (this.stats.citations || 0) + 1;
    this.attention = clamp(this.attention - 0.8); this.sinceEvent = 0; this.lastReason = 'cargo seized · patrols remember the hull';
    if (this.game.reputation) this.game.reputation.change('runners', -0.5, 'cargo-seized', 'The backchannel heard the package went over the side to FWC.', false);
    this.game.persist(); return true;
  }

  cleanCheck() {
    this.stats.cleanChecks = (this.stats.cleanChecks || 0) + 1; this.cool(0.9); this.game.persist();
    if (this.game.reputation) this.game.reputation.change('fwc', 0.3, 'clean-check', 'A clean inspection went into the patrol log.', false);
  }

  cited() {
    this.stats.citations = (this.stats.citations || 0) + 1; this.game.persist();
    if (this.game.reputation) this.game.reputation.change('fwc', -0.45, 'citation', 'Another citation went against the hull.', false);
  }

  escaped() {
    this.stats.escapes = (this.stats.escapes || 0) + 1; this.sinceEvent = 0; this.lastReason = 'patrol searching the back channels'; this.rememberAttention(); this.game.persist();
    if (this.game.reputation) {
      this.game.reputation.change('fwc', -1, 'patrol-escape', 'FWC marked the hull after the pursuit.', false);
      this.game.reputation.change('runners', 0.6, 'patrol-escape', 'The backchannel heard you lost a patrol in the cuts.', true);
    }
  }

  setPursuit(on) {
    const was = this.pursuit; this.pursuit = Boolean(on);
    if (this.pursuit) { this.sinceEvent = 0; if (!was) this.pursuitVisual = true; }
    else this.pursuitVisual = false;
  }

  setPursuitVisual(on) { if (this.pursuit) this.pursuitVisual = Boolean(on); }

  update(dt, enabled = true) {
    this.enabled = enabled; if (!enabled) return;
    this.violationCd = Math.max(0, this.violationCd - dt); this.sinceEvent += dt;
    this.updateReports(dt);
    if (this.hotCargoT > 0) {
      this.hotCargoT -= dt;
      if (this.hotCargoT <= 0) { this.hotCargoT = 0; this.cool(0.45); this.game.toast('Radio traffic moved on', 'The unmarked package is no longer drawing calls.', 2.6); }
    }
    if (!this.pursuit && this.sinceEvent > 42 && this.attention > 0) {
      const hour = this.environment.hour, night = hour < 5.5 || hour > 20.5;
      const conceal = 1 + (night ? 0.35 : 0) + this.environment.values.storm * 0.85;
      this.attention = Math.max(0, this.attention - dt * 0.018 * conceal);
    }
    this.rememberAttention();
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.16; this.render(); }
  }

  render() {
    if (!this.el) return;
    const n = wantedLevel(this.attention);
    const pending = this.stats.pendingReport, responding = this.responding || this.stats.dispatchReport;
    this.el.classList.toggle('on', n > 0 || this.hotCargoT > 0 || Boolean(pending)); this.el.classList.toggle('pursuit', this.pursuit);
    if (!n && !this.hotCargoT && !pending) { this.el.innerHTML = ''; return; }
    let stars = ''; for (let i = 0; i < 5; i++) stars += `<i class="${i < n ? 'lit' : ''}">★</i>`;
    const status = this.pursuit ? pursuitStatusLabel(true, this.pursuitVisual) : responding ? 'FWC responding' : pending ? 'Witness calling FWC' : 'Wanted';
    const detail = this.hotCargoT > 0 ? `unmarked cargo · ${Math.ceil(this.hotCargoT)}s` : !this.pursuit && pending ? pending.source : this.lastReason;
    this.el.innerHTML = `<span>${status}</span><b aria-label="${n} of 5 wanted stars">${stars}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}`;
  }
}
