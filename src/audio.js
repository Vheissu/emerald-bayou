export class EngineAudio {
  constructor() { this.ctx = null; this.windLevel = 0; this.rainLevel = 0; this.nightLevel = 0; this.stormLevel = 0; }
  start() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); this.master = master;
    // engine: two detuned saws through a lowpass
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 40;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 80.5;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 300; this.engLP.Q.value = 2;
    this.osc1.connect(this.engLP); this.osc2.connect(this.engLP); this.engLP.connect(this.engGain); this.engGain.connect(master);
    this.osc1.start(); this.osc2.start();
    // prop wash: filtered noise
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.noiseBP = ctx.createBiquadFilter(); this.noiseBP.type = 'bandpass'; this.noiseBP.frequency.value = 900; this.noiseBP.Q.value = 0.6;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0.0;
    this.noise.connect(this.noiseBP); this.noiseBP.connect(this.noiseGain); this.noiseGain.connect(master); this.noise.start();
    // ambient: soft wind/insects
    this.amb = ctx.createBufferSource(); this.amb.buffer = buf; this.amb.loop = true;
    const ambLP = ctx.createBiquadFilter(); ambLP.type = 'lowpass'; ambLP.frequency.value = 400;
    const ambGain = ctx.createGain(); ambGain.gain.value = 0.035; this.ambGain = ambGain;
    this.amb.connect(ambLP); ambLP.connect(ambGain); ambGain.connect(master); this.amb.start();
    // cicada-ish high shimmer
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = 8;
    const hg = ctx.createGain(); hg.gain.value = 0.012; this.amb.connect(hp); hp.connect(hg); hg.connect(master);
    this.hg = hg;
    // The same long noise bed feeds two independent weather bands. They stay phase-coherent but read as
    // wind pressure and rain hiss because their filters and gain envelopes move separately.
    const windBP = ctx.createBiquadFilter(); windBP.type = 'bandpass'; windBP.frequency.value = 420; windBP.Q.value = 0.45;
    const windGain = ctx.createGain(); windGain.gain.value = 0; this.amb.connect(windBP); windBP.connect(windGain); windGain.connect(master);
    const rainHP = ctx.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 2400;
    const rainGain = ctx.createGain(); rainGain.gain.value = 0; this.amb.connect(rainHP); rainHP.connect(rainGain); rainGain.connect(master);
    this.windBP = windBP; this.windGain = windGain; this.rainHP = rainHP; this.rainGain = rainGain;
    this.noiseBuf = buf;
    // sfx bus
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(master);
  }
  // ---- one-shot effects ----
  splash(intensity = 1, heavy = false) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime;
    // weight: a sub thump under the hiss, bigger when the hull slams or stuffs
    { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(heavy ? 70 : 55, now); o.frequency.exponentialRampToValueAtTime(26, now + 0.35);
      const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, 0.25 + intensity * 0.3 + (heavy ? 0.3 : 0)), now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.5); }
    if (heavy) { const src2 = ctx.createBufferSource(); src2.buffer = this.noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.setValueAtTime(900, now); bp.frequency.exponentialRampToValueAtTime(120, now + 1.4);
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, now); g2.gain.exponentialRampToValueAtTime(0.5, now + 0.08); g2.gain.exponentialRampToValueAtTime(0.0001, now + 1.5); src2.connect(bp); bp.connect(g2); g2.connect(this.sfx); src2.start(now); src2.stop(now + 1.6); }
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200 + intensity * 900, now); lp.frequency.exponentialRampToValueAtTime(220, now + 0.5 + intensity * 0.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(Math.min(0.9, 0.25 + intensity * 0.3), now + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6 + intensity * 0.3);
    src.connect(lp); lp.connect(g); g.connect(this.sfx); src.start(now); src.stop(now + 1.2);
  }
  thud(intensity = 1) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(32, now + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, 0.4 + intensity * 0.25), now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.35);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.8;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.3 * intensity, now); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(bp); bp.connect(g2); g2.connect(this.sfx); src.start(now); src.stop(now + 0.25);
  }
  tone(freq, dur = 0.12, vol = 0.25, type = 'triangle', when = 0) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + dur + 0.05);
  }
  checkpoint() { this.tone(880, 0.14, 0.22); this.tone(1320, 0.22, 0.2, 'triangle', 0.09); }
  trick(mult = 1) { this.tone(660 + mult * 90, 0.09, 0.12, 'square'); }
  bank() { this.tone(523, 0.1, 0.16); this.tone(659, 0.1, 0.16, 'triangle', 0.08); this.tone(784, 0.25, 0.18, 'triangle', 0.16); }
  complete() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.2, 'triangle', i * 0.13)); this.tone(1319, 0.7, 0.16, 'triangle', 0.55); }
  fail() { this.tone(330, 0.3, 0.2, 'sawtooth'); this.tone(247, 0.6, 0.2, 'sawtooth', 0.25); }
  countdown(final = false) { this.tone(final ? 1046 : 660, final ? 0.5 : 0.15, 0.22, 'square'); }
  pickup() { this.tone(988, 0.08, 0.16, 'square'); this.tone(1480, 0.16, 0.14, 'square', 0.06); }
  warn() { this.tone(440, 0.12, 0.2, 'square'); this.tone(440, 0.12, 0.2, 'square', 0.18); }
  // A VHF carrier opening or dropping: filtered static and the small relay click from the set in the boat.
  // Dialogue stays legible as captions; this cue makes it feel like radio traffic without synthetic speech.
  radio(open = true, priority = 1) {
    if (!this.ctx || !this.noiseBuf) return; const ctx = this.ctx, now = ctx.currentTime, dur = open ? 0.24 : 0.11;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 520;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = open ? 1850 : 1450; bp.Q.value = 0.55;
    const g = ctx.createGain(); const level = Math.min(0.16, 0.075 + priority * 0.017);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(level, now + 0.012); g.gain.setValueAtTime(level * 0.68, now + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.sfx); src.start(now, Math.random() * 1.5); src.stop(now + dur + 0.02);
    const click = ctx.createOscillator(); click.type = 'square'; click.frequency.setValueAtTime(open ? 920 : 620, now); click.frequency.exponentialRampToValueAtTime(open ? 310 : 240, now + 0.035);
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.045, now); cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.045); click.connect(cg); cg.connect(this.sfx); click.start(now); click.stop(now + 0.05);
  }
  frog(vol = 0.12) { this.tone(86, 0.16, vol, 'sine'); this.tone(72, 0.22, vol * 0.8, 'sine', 0.12); }
  weather(wind = 0, rain = 0, night = 0, storm = 0) { this.windLevel = wind; this.rainLevel = rain; this.nightLevel = night; this.stormLevel = storm; }
  // ---- the bayou's own voices ----
  // a mullet hitting the water: a short bright slap
  plip(vol = 0.4) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol * 0.5, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(hp); hp.connect(g); g.connect(this.sfx); src.start(now); src.stop(now + 0.2);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(520, now); o.frequency.exponentialRampToValueAtTime(180, now + 0.09);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(vol * 0.25, now); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.1); o.connect(g2); g2.connect(this.sfx); o.start(now); o.stop(now + 0.12);
  }
  // An ultrasonic animal tag is heard through the boat's receiver as a short electronic double ping. Distance drives
  // both the volume and the small pitch rise, so the player can search the cut without an arcade waypoint.
  tagPing(vol = 0.18, closeness = 0) {
    const near = Math.max(0, Math.min(1, Number(closeness) || 0));
    this.tone(910 + near * 260, 0.045, vol, 'sine');
    this.tone(1040 + near * 330, 0.035, vol * 0.72, 'sine', 0.085);
  }
  // bull gator: a chesty rumble with a rasp on top
  bellow(vol = 0.5) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(44, now); o.frequency.linearRampToValueAtTime(52, now + 0.5); o.frequency.linearRampToValueAtTime(38, now + 1.4);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11; const lg = ctx.createGain(); lg.gain.value = 6; lfo.connect(lg); lg.connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    o.connect(lp); lp.connect(g); g.connect(this.sfx); o.start(now); lfo.start(now); o.stop(now + 1.6); lfo.stop(now + 1.6);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 1.5;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, now); g2.gain.exponentialRampToValueAtTime(vol * 0.6, now + 0.3); g2.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    src.connect(bp); bp.connect(g2); g2.connect(this.sfx); src.start(now); src.stop(now + 1.5);
  }
  // a gator sliding off the bank: hiss and a slap
  hiss(vol = 0.35) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3600; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    src.connect(bp); bp.connect(g); g.connect(this.sfx); src.start(now); src.stop(now + 0.8);
  }
  hornBlast(vol, duration, when = 0) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx, now = ctx.currentTime + when;
    for (const f of [311, 392]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const release = Math.min(0.4, duration * 0.28), hold = duration - release;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol * 0.5, now + 0.03); g.gain.setValueAtTime(vol * 0.5, now + hold); g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      o.connect(lp); lp.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + duration + 0.05); }
  }
  // another boat's close-quarters warning: two-tone, a touch flat
  horn(vol = 0.3) { this.hornBlast(vol, 0.55); }
  // Rule 32 prolonged blast: held inside the four-to-six-second window.
  fogHorn(vol = 0.3) { this.hornBlast(vol, 4.5); }
  // Rule 35(c): a vessel engaged in fishing sounds one prolonged followed by two short blasts.
  fogHornFishing(vol = 0.3) { this.hornBlast(vol, 4.5); this.hornBlast(vol * 0.9, 1, 5.5); this.hornBlast(vol * 0.9, 1, 7.5); }
  // osprey: a run of thin descending whistles
  osprey(vol = 0.18) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx;
    for (let i = 0; i < 5; i++) { const now = ctx.currentTime + i * 0.17; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2900, now); o.frequency.exponentialRampToValueAtTime(2200, now + 0.11);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12); o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.14); }
  }
  // heron / egret flushed off the flat: a harsh croak
  squawk(vol = 0.25) {
    if (!this.ctx || vol < 0.02) return; const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(420, now); o.frequency.exponentialRampToValueAtTime(230, now + 0.28);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    o.connect(lp); lp.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.32);
  }
  // A close liquid-fuel fire: turbulent hiss with irregular low crackles, kept as a short one-shot so silent scenes allocate nothing.
  fire(vol = 0.24) {
    if (!this.ctx || !this.noiseBuf || vol < 0.01) return; const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150 + Math.random() * 520; bp.Q.value = 0.48;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.035); g.gain.setValueAtTime(vol * 0.72, now + 0.34); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    src.connect(bp); bp.connect(g); g.connect(this.sfx); src.start(now, Math.random() * 1.2); src.stop(now + 0.66);
    for (let i = 0; i < 2; i++) {
      const at = now + 0.08 + i * 0.21 + Math.random() * 0.08, o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(150 + Math.random() * 90, at); o.frequency.exponentialRampToValueAtTime(70, at + 0.055);
      const pop = ctx.createGain(); pop.gain.setValueAtTime(vol * (0.18 + Math.random() * 0.16), at); pop.gain.exponentialRampToValueAtTime(0.0001, at + 0.065); o.connect(pop); pop.connect(this.sfx); o.start(at); o.stop(at + 0.075);
    }
  }
  // wood on aluminium: a deadhead under the hull
  knock(vol = 0.6) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(160, now); o.frequency.exponentialRampToValueAtTime(70, now + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22); o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.25);
    this.thud(vol * 0.8);
  }
  // a shotgun somewhere off in the marsh: a crack, then the low roll of it across the water
  shot(vol = 0.3) {
    if (!this.ctx || vol < 0.01) return; const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, now); lp.frequency.exponentialRampToValueAtTime(140, now + 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(vol * 0.25, now + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    src.connect(lp); lp.connect(g); g.connect(this.sfx); src.start(now); src.stop(now + 1.5);
  }
  // an outboard somewhere near: a shared buzz whose level and pitch follow the closest other boat each frame
  outboard(level, pitch = 1) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime;
    if (!this.ob) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95; const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 190; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.5; const g = ctx.createGain(); g.gain.value = 0; o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.sfx); o.start(); o2.start(); this.ob = { o, o2, g, lp }; }
    const b = this.ob; b.g.gain.setTargetAtTime(Math.min(0.12, level * 0.12), now, 0.15); b.o.frequency.setTargetAtTime(95 * pitch, now, 0.2); b.o2.frequency.setTargetAtTime(191 * pitch, now, 0.2);
  }
  // One pooled rotor bed is created only when a rescue aircraft is actually heard. Distance drives its gain;
  // blade loading nudges the pulse rate during an approach or hover without allocating per-frame audio nodes.
  helicopter(level = 0, load = 1) {
    if (!this.ctx || (!this.heli && level <= 0.001)) return; const ctx = this.ctx, now = ctx.currentTime;
    if (!this.heli) {
      const beat = ctx.createOscillator(); beat.type = 'sawtooth'; beat.frequency.value = 18.5;
      const harmonic = ctx.createOscillator(); harmonic.type = 'square'; harmonic.frequency.value = 37;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 1.4;
      const beatGain = ctx.createGain(); beatGain.gain.value = 0; beat.connect(lp); harmonic.connect(lp); lp.connect(beatGain); beatGain.connect(this.sfx);
      const wash = ctx.createBiquadFilter(); wash.type = 'bandpass'; wash.frequency.value = 210; wash.Q.value = 0.5;
      const washGain = ctx.createGain(); washGain.gain.value = 0; this.amb.connect(wash); wash.connect(washGain); washGain.connect(this.sfx);
      beat.start(); harmonic.start(); this.heli = { beat, harmonic, lp, beatGain, wash, washGain };
    }
    const h = this.heli, audible = Math.min(1, Math.max(0, level)), pitch = Math.max(0.82, Math.min(1.22, load));
    h.beatGain.gain.setTargetAtTime(audible * 0.16, now, 0.18); h.washGain.gain.setTargetAtTime(audible * 0.12, now, 0.22);
    h.beat.frequency.setTargetAtTime(18.5 * pitch, now, 0.16); h.harmonic.frequency.setTargetAtTime(37.2 * pitch, now, 0.16);
    h.lp.frequency.setTargetAtTime(210 + audible * 180, now, 0.24); h.wash.frequency.setTargetAtTime(170 + audible * 160, now, 0.24);
  }
  // a diesel pickup idling and pulling on a ramp
  truck(level) {
    if (!this.ctx) return; const ctx = this.ctx, now = ctx.currentTime;
    if (!this.tk) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 27; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; const g = ctx.createGain(); g.gain.value = 0; o.connect(lp); lp.connect(g); g.connect(this.sfx); o.start(); this.tk = { o, g }; }
    this.tk.g.gain.setTargetAtTime(Math.min(0.2, level * 0.2), now, 0.2); this.tk.o.frequency.setTargetAtTime(27 + level * 6, now, 0.3);
  }
  update(rpm, throttle, speed, t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const f = 28 + rpm * 62;
    this.osc1.frequency.setTargetAtTime(f, now, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 2.01, now, 0.05);
    this.engLP.frequency.setTargetAtTime(180 + rpm * 900, now, 0.05);
    this.engGain.gain.setTargetAtTime(rpm > 0.01 ? 0.04 + rpm * 0.18 : 0, now, 0.05);
    this.noiseGain.gain.setTargetAtTime(rpm * rpm * 0.35, now, 0.08);
    this.noiseBP.frequency.setTargetAtTime(500 + rpm * 1400, now, 0.08);
    const rain = this.rainLevel || 0, storm = this.stormLevel || 0, night = this.nightLevel || 0, wind = this.windLevel || 0;
    this.ambGain.gain.setTargetAtTime((0.018 + night * 0.022) * (1 - rain * 0.75), now, 0.8);
    this.hg.gain.setTargetAtTime((0.006 + night * 0.012 + 0.004 * Math.sin(t * 0.7)) * (1 - rain * 0.9), now, 0.5);
    this.windGain.gain.setTargetAtTime(Math.min(0.28, Math.pow(Math.max(0, wind) / 36, 0.78) * 0.26), now, 0.35);
    this.windBP.frequency.setTargetAtTime(260 + Math.min(900, wind * 22), now, 0.6);
    this.rainGain.gain.setTargetAtTime(Math.min(0.24, rain * (0.08 + storm * 0.16)), now, 0.25);
    this.rainHP.frequency.setTargetAtTime(2900 - storm * 900, now, 0.6);
  }
}
