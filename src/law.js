import { wantedLevel } from './pursuit.js';

const clamp = (v, lo = 0, hi = 5) => Math.max(lo, Math.min(hi, v));

export function pursuitStatusLabel(pursuit, visual = true) {
  if (!pursuit) return 'Wanted';
  return visual ? 'Wanted · FWC pursuit' : 'Wanted · FWC searching';
}

export class Law {
  constructor(o) {
    Object.assign(this, o); // game, phys, environment, audio
    this.stats = this.game.save.law || { citations: 0, escapes: 0, cleanChecks: 0, violations: 0, seizures: 0 };
    this.game.save.law = this.stats;
    this.attention = clamp(Number(this.stats.attention) || 0); this.sinceEvent = 999; this.violationCd = 0; this.pursuit = false; this.pursuitVisual = false;
    this.hotCargoT = 0; this.lastReason = typeof this.stats.lastReason === 'string' ? this.stats.lastReason : ''; this.hudT = 0; this.enabled = false;
    this.el = document.getElementById('lawState');
    this.keyHandler = e => { if (import.meta.env.DEV && e.code === 'F4' && !e.repeat && this.enabled) { e.preventDefault(); this.add(3.2, 'reported collision'); } };
    window.addEventListener('keydown', this.keyHandler);
  }

  add(amount, reason = 'reported activity', announce = true) {
    const before = this.attention; this.attention = clamp(this.attention + amount); this.sinceEvent = 0; this.lastReason = reason;
    if (amount > 0) this.stats.violations = (this.stats.violations || 0) + 1;
    if (announce && amount > 0 && Math.ceil(this.attention) > Math.ceil(before)) { this.audio.warn(); this.game.toast('FWC attention', reason, 2.4); }
    this.rememberAttention(); this.game.persist(); if (this.onAttention) this.onAttention(this.attention);
  }

  violation(amount, reason, announce = false) {
    if (this.violationCd > 0) return;
    this.violationCd = Math.max(2.5, amount * 4); this.add(amount, reason, announce);
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
    this.el.classList.toggle('on', n > 0 || this.hotCargoT > 0); this.el.classList.toggle('pursuit', this.pursuit);
    if (!n && !this.hotCargoT) { this.el.innerHTML = ''; return; }
    let stars = ''; for (let i = 0; i < 5; i++) stars += `<i class="${i < n ? 'lit' : ''}">★</i>`;
    const pursuitState = this.pursuit ? (this.pursuitVisual ? 'active pursuit · ' : 'visual broken · searching · ') : '';
    const cargo = this.hotCargoT > 0 ? `<small>unmarked cargo · ${Math.ceil(this.hotCargoT)}s</small>` : this.lastReason ? `<small>${pursuitState}${this.lastReason}</small>` : '';
    this.el.innerHTML = `<span>${pursuitStatusLabel(this.pursuit, this.pursuitVisual)}</span><b aria-label="${n} of 5 wanted stars">${stars}</b>${cargo}`;
  }
}
