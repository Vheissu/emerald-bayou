const clamp = (v, lo = -10, hi = 10) => Math.max(lo, Math.min(hi, v));

const RANKS = {
  locals: [
    [6, 'one of ours'], [3, 'trusted'], [1, 'known'], [-1, 'unproven'], [-3, 'kept at arm’s length'], [-6, 'cold welcome'], [-11, 'run out'],
  ],
  fwc: [
    [6, 'trusted operator'], [3, 'cooperative'], [1, 'known clean'], [-1, 'unknown hull'], [-3, 'watched'], [-6, 'flagged'], [-11, 'priority hull'],
  ],
  runners: [
    [6, 'inside line'], [3, 'trusted'], [1, 'known'], [-1, 'unproven'], [-3, 'unwelcome'], [-6, 'marked'], [-11, 'hunted'],
  ],
};

const NOTICE = {
  locals: { up: 'Word travels', down: 'Cold water' },
  fwc: { up: 'FWC record', down: 'FWC file' },
  runners: { up: 'Backchannel', down: 'Backchannel' },
};

export class Reputation {
  constructor(o) {
    Object.assign(this, o); // game, environment, audio
    const saved = this.game.save.reputation || {}, legacy = Number(this.game.save.goodwill) || 0;
    this.values = {
      locals: clamp(Number(saved.locals ?? legacy)),
      fwc: clamp(Number(saved.fwc ?? 0)),
      runners: clamp(Number(saved.runners ?? 0)),
    };
    this.deeds = Array.isArray(saved.deeds) ? saved.deeds.slice(-12) : [];
    this.game.save.reputation = { ...this.values, deeds: this.deeds };
    this.game.save.goodwill = Math.round(this.values.locals);
    this.el = document.getElementById('memoryState'); this.noticeT = 0; this.title = ''; this.line = ''; this.enabled = false;
    this.campSeen = new Set(); this.lastCamp = ''; this.debugIndex = 0;
    this.keyHandler = e => {
      if (!import.meta.env.DEV || e.code !== 'F2' || e.repeat || !this.enabled) return;
      e.preventDefault();
      const presets = [
        { locals: 5, fwc: 4, runners: 2, title: 'Known hull', line: 'The camps, wardens and backchannel all know the boat.' },
        { locals: 0, fwc: 0, runners: 0, title: 'Unknown hull', line: 'No one has made up their mind about you.' },
        { locals: -5, fwc: -5, runners: -5, title: 'Bad name', line: 'Doors close and radios stay busy when this hull appears.' },
      ];
      const p = presets[this.debugIndex++ % presets.length];
      Object.assign(this.values, { locals: p.locals, fwc: p.fwc, runners: p.runners }); this.sync(); this.notice(p.title, p.line, 4.5);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  score(faction) { return Number(this.values[faction]) || 0; }

  rank(faction) {
    const v = this.score(faction), list = RANKS[faction] || RANKS.locals;
    for (const [floor, label] of list) if (v >= floor) return label;
    return list[list.length - 1][1];
  }

  sync() {
    this.game.save.reputation = { ...this.values, deeds: this.deeds };
    this.game.save.goodwill = Math.round(this.values.locals);
    this.game.persist();
  }

  notice(title, line, seconds = 4) {
    this.title = title; this.line = line; this.noticeT = seconds; this.render();
  }

  change(faction, amount, code, text, announce = true) {
    if (!this.values.hasOwnProperty(faction) || !Number.isFinite(amount) || Math.abs(amount) < 0.001) return 0;
    const before = this.values[faction], after = clamp(before + amount); if (after === before) return 0;
    this.values[faction] = Math.round(after * 100) / 100;
    const deed = {
      faction, delta: Math.round((after - before) * 100) / 100, code: code || 'word', text: text || 'People remember the hull.',
      day: this.environment ? this.environment.day : 1, hour: this.environment ? Math.round(this.environment.hour * 10) / 10 : 0,
    };
    const prev = this.deeds[this.deeds.length - 1];
    if (prev && prev.faction === deed.faction && prev.code === deed.code && prev.day === deed.day && Math.abs(prev.hour - deed.hour) < 0.2) {
      prev.delta = Math.round((prev.delta + deed.delta) * 100) / 100; prev.hour = deed.hour; prev.text = deed.text;
    } else { this.deeds.push(deed); if (this.deeds.length > 12) this.deeds.shift(); }
    this.sync();
    if (announce) { const n = NOTICE[faction]; this.audio.pickup(); this.notice(amount > 0 ? n.up : n.down, deed.text, 4.2); }
    return after - before;
  }

  recent(faction) {
    for (let i = this.deeds.length - 1; i >= 0; i--) if (!faction || this.deeds[i].faction === faction) return this.deeds[i];
    return null;
  }

  serviceFactor() { return clamp(1 - this.score('locals') * 0.032, 0.78, 1.22); }
  serviceNote() { const v = this.score('locals'); return v >= 3 ? 'friends’ rate' : v <= -3 ? 'cash only' : ''; }
  extendsCredit() { return this.score('locals') >= 4; }
  patrolCheckTime(base) { return base * clamp(1 - this.score('fwc') * 0.045, 0.68, 1.42); }
  fineFactor() { return clamp(1 - this.score('fwc') * 0.04, 0.76, 1.42); }
  runnerHostility() { return clamp(-this.score('runners') / 6, -1, 1); }

  mission(m, first = true) {
    if (m.isRun) {
      this.change('locals', 0.45, 'camp-run', `You got supplies through to ${m.to.name}.`, true); return;
    }
    if (!first) return;
    if (m.id === 'manatee') {
      this.change('fwc', 1.4, 'manatee-count', 'FWC logged the clean manatee count.', true);
      this.change('locals', 0.35, 'manatee-count', 'You idled through the manatee water.', false);
    } else if (m.id === 'chase') {
      this.change('locals', 1, 'poacher-chase', 'You ran the gill-net boat out of the refuge.', true);
      this.change('fwc', 1.25, 'poacher-chase', 'FWC logged the poacher boat recovery.', false);
      this.change('runners', -2, 'poacher-chase', 'The backchannel heard who stopped the poacher boat.', false);
    } else if (m.id === 'cargo') {
      this.change('locals', 1.25, 'supply-run', 'The fuel reached the creek camp intact.', true);
    } else if (m.id === 'rescue') {
      this.change('locals', 2, 'kayaker-rescue', 'You brought the lost kayaker back alive.', true);
      this.change('fwc', 0.4, 'kayaker-rescue', 'The rescue went into the incident log.', false);
    } else if (m.id === 'gator') {
      this.change('locals', 0.8, 'gator-move', 'You moved the old bull off the tower dock.', true);
      this.change('fwc', 0.45, 'gator-move', 'The nuisance-gator move was done clean.', false);
    } else if (m.id === 'sonar') {
      this.change('locals', 0.55, 'wreck-recovery', 'You put two storm wrecks back on the chart.', true);
    } else if (m.id === 'traps') {
      this.change('locals', 0.45, 'trap-line', 'You worked the missing trap line clean.', true);
    }
  }

  campLine() {
    const v = this.score('locals');
    if (v >= 6) return '“Tie up. We saved you a clean can of gas.”';
    if (v >= 3) return '“We know the hull. Come alongside.”';
    if (v <= -6) return '“Do not step off that boat.”';
    if (v <= -3) return '“Cash where I can see it.”';
    return '';
  }

  update(dt, enabled = true) {
    this.enabled = enabled;
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) this.render(); }
    const camp = enabled && !this.game.paused ? this.game.dockCamp : null, key = camp ? camp.key : '';
    if (key && key !== this.lastCamp && !this.campSeen.has(key)) {
      this.campSeen.add(key); const line = this.campLine(); if (line) this.game.toast(line, camp.name, 2.8);
    }
    this.lastCamp = key;
  }

  render() {
    if (!this.el) return;
    const on = this.noticeT > 0;
    this.el.classList.toggle('on', on); this.el.innerHTML = on ? `<span>${this.title}</span><small>${this.line}</small>` : '';
  }
}
