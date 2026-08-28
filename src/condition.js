const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export class BoatCondition {
  constructor(o) {
    Object.assign(this, o); // game, phys, water, environment, audio, startX, startZ
    const saved = this.game.save.boatCondition || {};
    this.state = this.game.save.boatCondition = {
      fuel: clamp(Number(saved.fuel ?? 18), 0, 18),
      hull: clamp(Number(saved.hull ?? 100), 0, 100),
      engine: clamp(Number(saved.engine ?? 100), 0, 100),
      bilge: clamp(Number(saved.bilge ?? 0), 0, 1),
    };
    this.maxFuel = 18; this.enabled = false; this.serviceHere = null; this.towPending = false;
    this.damageCd = 0; this.persistT = 8; this.hudT = 0; this.misfireT = 4; this.powerCut = 0; this.warned = {};
    this.el = document.getElementById('boatState'); this.promptEl = document.getElementById('servicePrompt');
    this.keyHandler = e => this.onKey(e); window.addEventListener('keydown', this.keyHandler);
    this.render();
  }

  onKey(e) {
    if (e.repeat || !this.enabled || this.game.menuOpen || this.game.mapOpen || this.game.resultOpen) return;
    if (e.code === 'KeyF' && this.serviceHere) { e.preventDefault(); this.service(); }
    if (e.code === 'KeyT' && this.needsTow()) { e.preventDefault(); this.tow(); }
    if (import.meta.env.DEV && e.code === 'F5') { e.preventDefault(); const d = this.game.dockTie; this.phys.reset(d.x, d.z, this.phys.heading); this.phys.y = this.water.waveHeight(d.x, d.z, 0); }
    if (import.meta.env.DEV && e.code === 'F6') {
      e.preventDefault();
      if (e.shiftKey) { this.state.fuel = 0; this.state.hull = 1; this.state.engine = 3; this.state.bilge = 0.97; }
      else { this.state.fuel = Math.min(this.state.fuel, 3.2); this.state.hull = Math.min(this.state.hull, 42); this.state.engine = Math.min(this.state.engine, 55); this.state.bilge = Math.max(this.state.bilge, 0.28); }
      this.game.persist(); this.render();
    }
  }

  serviceLocation() {
    if (this.game.state || this.phys.speed * MPH > 5) return null;
    if (this.game.dockTie && this.game.dist(this.game.dockTie.x, this.game.dockTie.z) < 24) return { name: 'tower dock', factor: 0.7, home: true };
    const nc = this.game.nearCamp;
    if (nc && this.game.save.camps.includes(nc.camp.key) && Math.hypot(nc.camp.tie.x - this.phys.pos.x, nc.camp.tie.z - this.phys.pos.y) < 19) {
      const rep = this.game.reputation;
      return { name: nc.camp.name, factor: rep ? rep.serviceFactor() : 1, home: false, note: rep ? rep.serviceNote() : '' };
    }
    return null;
  }

  estimate(where = this.serviceHere) {
    if (!where) return 0;
    const S = this.state, f = where.factor;
    return Math.ceil((this.maxFuel - S.fuel) * 5.25 * f + (100 - S.hull) * 2.4 * f + (100 - S.engine) * 3.5 * f);
  }

  service() {
    const at = this.serviceHere; if (!at) return;
    const S = this.state, total = this.estimate(at);
    if (total <= 1 && S.bilge < 0.01) { this.game.toast('Boat is ready', `${at.name} · tank full · bilge dry`, 2.4); return; }

    let budget = Math.max(0, this.game.save.cash), spent = 0;
    if (budget <= 0 && at.home && S.fuel < 2.5) {
      S.fuel = 2.5; S.hull = Math.max(S.hull, 25); S.engine = Math.max(S.engine, 30); S.bilge = 0;
      this.game.persist(); this.audio.pickup(); this.game.toast('Dock fuel', 'Two and a half gallons. Enough to get working again.', 3); return;
    }
    if (budget <= 0 && !at.home && this.game.reputation && this.game.reputation.extendsCredit() && S.fuel < 2) {
      S.fuel = 2; this.game.persist(); this.audio.pickup(); this.game.toast('On the camp book', 'Two gallons. Settle it when work comes in.', 3); return;
    }
    if (budget <= 0) { this.audio.warn(); this.game.toast('No credit here', `Full service is $${total}.`, 2.5); return; }

    const buy = (need, price, apply) => {
      const amount = Math.min(need, budget / price); if (amount <= 0) return;
      const cost = amount * price; budget -= cost; spent += cost; apply(amount);
    };
    // Fuel first, then stop the leak, then put full power back in the cage.
    buy(this.maxFuel - S.fuel, 5.25 * at.factor, n => { S.fuel += n; });
    buy(100 - S.hull, 2.4 * at.factor, n => { S.hull += n; });
    buy(100 - S.engine, 3.5 * at.factor, n => { S.engine += n; });
    S.bilge = 0;
    const charge = Math.min(this.game.save.cash, Math.ceil(spent)); if (charge) this.game.addCash(-charge);
    this.game.persist(); this.warned = {}; this.audio.checkpoint();
    const complete = this.estimate(at) <= 2;
    this.game.toast(complete ? 'Boat serviced' : 'Partial service', `${at.name} · $${charge} · ${S.fuel.toFixed(1)} gal`, 3);
    this.render();
  }

  needsTow() { const S = this.state; return S.fuel <= 0.03 || S.engine <= 4 || S.bilge >= 0.96 || S.hull <= 2; }

  tow() {
    if (this.towPending || !this.needsTow()) return;
    this.towPending = true; this.audio.warn(); this.game.toast('Tow on the radio', 'Hold position. They are coming from the tower.', 2.8);
    this.game.fadeTo(() => {
      const S = this.state, charge = Math.min(120, Math.max(0, this.game.save.cash));
      this.phys.reset(this.startX, this.startZ, 0); this.phys.y = this.water.waveHeight(this.startX, this.startZ, 0);
      S.fuel = Math.max(S.fuel, 4); S.hull = Math.max(S.hull, 55); S.engine = Math.max(S.engine, 50); S.bilge = 0;
      if (charge) this.game.addCash(-charge); this.game.persist(); this.towPending = false; this.warned = {};
      this.game.toast('Back at the tower', charge ? `Tow and emergency work · $${charge}` : 'They will settle up with you later.', 3.2);
    });
  }

  damage(hull, engine = 0) {
    const S = this.state; S.hull = Math.max(0, S.hull - hull); S.engine = Math.max(0, S.engine - engine);
    S.bilge = clamp(S.bilge + hull * 0.0018); this.persistT = Math.min(this.persistT, 1.5);
  }

  processDamage(dt) {
    const p = this.phys, S = this.state; this.damageCd = Math.max(0, this.damageCd - dt);
    if (p.hit > 3 && this.damageCd <= 0) {
      const hit = Math.pow(p.hit - 2.4, 1.28) * 0.48, prop = p.hitTag === 'log' || p.hitTag === 'snag' || p.hitTag === 'storm-debris';
      this.damage(hit, prop ? hit * 0.46 : p.hitTag === 'boat' ? hit * 0.08 : 0); this.damageCd = 0.38;
      if (hit > 5.5) this.game.toast(prop ? 'Prop strike' : 'Hard strike', prop ? `Engine ${Math.round(S.engine)}% · hull ${Math.round(S.hull)}%` : `Hull ${Math.round(S.hull)}%`, 2.4);
    }
    if (p.impact > 4.5 && this.damageCd <= 0) {
      const hit = Math.pow(p.impact - 3.8, 1.22) * 0.24; this.damage(hit, hit * 0.08); this.damageCd = 0.25;
    }
    // An exposed prop and engine do not enjoy a hail core, but this is wear, not arcade hit-point rain.
    if (this.environment.values.hail > 0.55) { S.engine = Math.max(0, S.engine - this.environment.values.hail * dt * 0.0015); this.persistT = Math.min(this.persistT, 3); }
  }

  updateWarnings() {
    const S = this.state;
    const once = (key, on, title, line) => { if (on && !this.warned[key]) { this.warned[key] = true; this.audio.warn(); this.game.toast(title, line, 2.7); } else if (!on) this.warned[key] = false; };
    once('fuel20', S.fuel < 3.6, 'Fuel reserve', `${S.fuel.toFixed(1)} gallons. Find a marked camp.`);
    once('fuel5', S.fuel < 0.9, 'Running on fumes', 'The tower dock can get you moving even if you are broke.');
    once('hull50', S.hull < 50, 'Hull taking water', `Hull ${Math.round(S.hull)}% · bilge ${Math.round(S.bilge * 100)}%`);
    once('engine35', S.engine < 35, 'Engine hurt', `${Math.round(S.engine)}% · full power is gone`);
    once('bilge70', S.bilge > 0.7, 'Bilge high', 'The stern is getting heavy. Get to a dock.');
    once('dead', this.needsTow(), 'Boat disabled', 'Press T to call a tow back to the tower.');
  }

  updatePower(dt) {
    const S = this.state, p = this.phys;
    this.powerCut = Math.max(0, this.powerCut - dt); this.misfireT -= dt;
    if (S.engine < 48 && this.misfireT <= 0 && S.fuel > 0.03) {
      this.misfireT = 3 + Math.random() * 8;
      if (Math.random() < (48 - S.engine) / 62) { this.powerCut = 0.25 + Math.random() * 0.45; this.audio.knock(0.16); }
    }
    const disabled = this.needsTow(), health = clamp(S.engine / 100);
    const engine = disabled ? 0 : (0.38 + 0.62 * health) * (this.powerCut > 0 ? 0.34 : 1) * (1 - S.bilge * 0.28);
    p.powerScale = clamp(engine); p.steerScale = clamp(0.55 + health * 0.45); p.damageLoad = S.bilge * 0.65;
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; const S = this.state, p = this.phys;
    this.serviceHere = enabled && !this.game.paused ? this.serviceLocation() : null;
    if (enabled && !this.game.paused) {
      const gph = 0.55 + p.rpm * p.rpm * 13.2 + Math.max(0, p.throttle) * 1.1;
      S.fuel = Math.max(0, S.fuel - gph * dt / 3600);
      this.processDamage(dt);
      const leak = p.wet > 0.2 && S.hull < 55 ? (55 - S.hull) / 55 * 0.0015 : 0;
      const pump = S.fuel > 0.03 && S.engine > 8 ? (S.hull > 70 ? 0.001 : 0.00048) : 0.00005;
      S.bilge = clamp(S.bilge + (leak - pump) * dt);
      this.persistT -= dt; if (this.persistT <= 0) { this.persistT = 8; this.game.persist(); }
      this.updateWarnings();
    }
    this.updatePower(dt);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.2; this.render(); }
  }

  render() {
    if (!this.el || !this.promptEl) return;
    const S = this.state;
    const row = (name, text, pct) => `<div class="condition-row"><span>${name}</span><b>${text}</b><i><em style="width:${clamp(pct) * 100}%"></em></i></div>`;
    this.el.innerHTML = row('Fuel', `${S.fuel.toFixed(1)} gal`, S.fuel / this.maxFuel) + row('Hull', `${Math.round(S.hull)}%`, S.hull / 100) + row('Engine', `${Math.round(S.engine)}%`, S.engine / 100) + (S.bilge > 0.035 ? row('Bilge', `${Math.round(S.bilge * 100)}%`, 1 - S.bilge) : '');
    this.el.classList.toggle('warn', S.fuel < 3.6 || S.hull < 50 || S.engine < 40 || S.bilge > 0.55);
    if (!this.enabled || this.game.paused) { this.promptEl.classList.remove('on'); return; }
    if (this.serviceHere) {
      const cost = this.estimate(this.serviceHere), note = this.serviceHere.note ? ` · ${this.serviceHere.note}` : '';
      this.promptEl.innerHTML = `<b>F</b> ${cost > 1 || S.bilge > 0.01 ? `service at ${this.serviceHere.name} · $${cost}${note}` : `boat ready · ${this.serviceHere.name}${note}`}`; this.promptEl.classList.add('on');
    } else if (this.needsTow()) { this.promptEl.innerHTML = '<b>T</b> call a tow to the tower · up to $120'; this.promptEl.classList.add('on'); }
    else this.promptEl.classList.remove('on');
  }
}
