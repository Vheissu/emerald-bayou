// Trick / style scoring: air, spins, drifts, near misses, mud runs. Chains into combos.
export class Tricks {
  constructor(phys) {
    this.phys = phys;
    this.events = []; // {text, points, t}
    this.chain = []; this.chainT = 0; this.mult = 1; this.chainPts = 0;
    this.total = 0; this.session = 0;
    this.airHeadStart = 0; this.drift = 0; this.driftT = 0; this.mud = 0; this.mudT = 0;
    // Trunks belong to streamed terrain chunks. Weak keys let an evicted chunk and its collider objects be collected
    // instead of retaining every tree that has ever produced a near miss during a long crossing of the map.
    this.nearSeen = new WeakMap();
    this.onBank = null; this.onEvent = null;
  }
  award(text, pts, kind = '', value = 0) {
    this.chain.push({ text, pts }); this.chainPts += pts; this.chainT = 3.2;
    this.mult = Math.min(5, 1 + Math.floor((this.chain.length - 1) / 2));
    this.events.push({ text, points: pts, t: 0, mult: this.mult });
    this.bestChainLen = Math.max(this.bestChainLen || 0, this.chain.length);
    if (this.onEvent) this.onEvent(text, pts, kind || text.toLowerCase(), value);
  }
  bank() {
    if (!this.chain.length) return;
    const pts = Math.round(this.chainPts * this.mult);
    this.total += pts; this.session += pts;
    if (this.onBank) this.onBank(pts, this.mult, this.chain.length);
    this.chain.length = 0; this.chainPts = 0; this.mult = 1;
  }
  bust(reason) {
    if (this.chain.length) { this.events.push({ text: reason, points: 0, t: 0, bust: true }); }
    this.chain.length = 0; this.chainPts = 0; this.mult = 1; this.chainT = 0;
  }
  update(dt, t) {
    const p = this.phys;
    for (const e of this.events) e.t += dt;
    this.events = this.events.filter(e => e.t < 2.4);
    if (this.chain.length) { this.chainT -= dt; if (this.chainT <= 0) this.bank(); }

    // ---- air ----
    if (p.airborne && p.airTime <= dt * 1.5) this.airHeadStart = p.heading;
    if (p.landedFrame) {
      const air = p.airTime, peak = p.airPeak, q = p.landQuality;
      this.lastLanding = { air, peak, q, spin: 0, pts: 0 };
      if (q === 'wipeout') this.bust('WIPEOUT');
      else if (q === 'stuffed') this.bust('NOSE DIVE');
      else if (air > 0.35) {
        let spin = Math.abs(p.heading - this.airHeadStart) * 180 / Math.PI;
        const dist = air * p.speed;
        const big = air > 1.1 || peak > 2.2;
        const huge = air > 1.7 || peak > 3.6;
        const airPts = Math.round(80 + air * 220 + peak * 60 + dist * 3);
        this.award(huge ? 'HUGE AIR' : big ? 'BIG AIR' : 'AIR', airPts, 'air', air);
        this.lastLanding.pts += airPts; this.lastLanding.spin = spin;
        if (spin >= 150) {
          const qs = Math.round(spin / 180) * 180;
          const sp = qs >= 900 ? 1600 : qs >= 720 ? 900 : qs >= 540 ? 600 : qs >= 360 ? 420 : 150;
          this.award(qs >= 540 ? `${qs} SPIN` : qs >= 360 ? '360 SPIN' : 'HALF SPIN', sp, 'spin', qs);
          this.lastLanding.pts += sp;
        }
        if (q === 'clean') { const cp = p.tailIn > 0.12 && p.wet > 0.3 ? 90 : 60; this.award(p.tailIn > 0.12 && p.wet > 0.3 ? 'TAIL SLAP' : 'CLEAN LANDING', cp, 'clean', 1); this.lastLanding.pts += cp; }
        else if (q === 'hard') { this.events.push({ text: 'HARD LANDING', points: 0, t: 0, bust: true }); }
      }
    }
    // ---- drift ----
    if (!p.airborne && p.speed > 7) {
      const fwd = p.forward(); const vAng = Math.atan2(-p.vel.x, -p.vel.y);
      let skid = Math.abs(((p.heading - vAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (skid > Math.PI / 2) skid = Math.PI - skid; // reversing counts as skid too
      if (skid > 0.45) { this.driftT += dt; this.drift += dt * (35 + skid * 40) * (p.speed / 10); }
      else if (this.driftT > 0) { if (this.driftT > 0.6) this.award(this.driftT > 2.5 ? 'LONG DRIFT' : 'DRIFT', Math.round(this.drift), 'drift', this.driftT); this.driftT = 0; this.drift = 0; }
    } else if (this.driftT > 0.6 && !p.airborne) { this.award('DRIFT', Math.round(this.drift), 'drift', this.driftT); this.driftT = 0; this.drift = 0; }
    else { this.driftT = 0; this.drift = 0; }
    // ---- mud run: riding over land at speed ----
    if (p.landFac > 0.5 && p.speed > 6) { this.mudT += dt; this.mud += dt * 45 * (p.speed / 10); }
    else if (this.mudT > 0) { if (this.mudT > 0.8) this.award(this.mudT > 3 ? 'SWAMP CROSSING' : 'MUD RUN', Math.round(this.mud), 'mud', this.mudT); this.mudT = 0; this.mud = 0; }
    // ---- near misses ----
    if (p.speed > 9 && !p.airborne) {
      for (const tr of p.nearTrunks) {
        const d = Math.hypot(tr.x - p.pos.x, tr.z - p.pos.y) - tr.r;
        if (d < 2.6 && d > 0.2) {
          const last = this.nearSeen.get(tr) || -99;
          if (t - last > 4) { this.nearSeen.set(tr, t); this.award('NEAR MISS', 70, 'nearmiss', 1); }
        }
      }
    }
    // ---- crashes bust the chain ----
    if (p.hit > 4) this.bust('CRASH');
    this.driftNow = this.driftT;
  }
}
