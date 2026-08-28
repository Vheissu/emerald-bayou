const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = list => list[Math.floor(Math.random() * list.length)];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const WEATHER_CALLS = {
  fair: ['MARINE WX-3', 'Small-craft advisory cancelled. Storm water may still be high in the back cuts.'],
  overcast: ['MARINE WX-3', 'Pressure falling across the backcountry. Patchy rain and visibility below two miles.'],
  squall: ['MARINE WX-3', 'Fast squall crossing west to east. Gusts near thirty knots on open water.'],
  thunderstorm: ['MARINE WX-3', 'Severe thunderstorm warning. Frequent lightning and waterspouts possible in the river mouths.'],
  hail: ['MARINE WX-3', 'Hail core moving through the bayou. All small craft seek covered water now.'],
  tropical: ['MARINE WX-3', 'Tropical-storm bands are inside the backcountry. Channels are rising and markers may be off station.'],
  hurricane: ['MARINE WX-3', 'Hurricane warning. Life-threatening surge is entering the backwater. No safe open crossing remains.'],
};

const REGION_ENTRY = {
  blackwater: 'Blackwater eats a radio signal. Mark every turn and call if the cypress closes behind you.',
  sawgrass: 'Sawgrass is thin water and a long walk from help. Keep the tower in range.',
  mangrove: 'Mangrove Reach is running hard with the tide. Floating timber in both cuts.',
  cypress: 'Old timber narrows Cypress Reach. Sound before the blind bends.',
  emerald: 'You are back in tower water. Dock lights are on until the weather takes them.',
  broad: 'Broad River carries working traffic. Stay right of the marked channel.',
  rookery: 'Rookery Lakes quiet zone is active. Idle between the white stakes.',
  prairie: 'No shade on Ten Mile Prairie. Watch the west sky and your fuel.',
  'dead-river': 'Dead River has no dock lights tonight. Do not trust the old red marker.',
};

const REGION_TRAFFIC = {
  blackwater: [
    ['CH 68', 'JUNE BELL · SPLIT PINE', 'Cypress crown down below Split Pine. East cut still carries if you keep tight to the roots.'],
    ['CH 16', 'LOCAL SKIFF', 'Northbound in Blackwater with no lights. Sounding at the next two bends.'],
    ['CH 68', 'LEON DOSS · OLD MILL', 'Water is black over the old fence posts. Do not cut that corner just because it looks deep.'],
  ],
  sawgrass: [
    ['FWC TAC', 'FWC AIR 2', 'Two airboats westbound over the grass, half a mile south of Pump Four.'],
    ['CH 68', 'PUMP FOUR', 'South gate is open. The grass will gain six inches before dark.'],
    ['CH 16', 'LOCAL SKIFF', 'Skin-shallow west of the old pump. Props are already chewing mud out there.'],
  ],
  mangrove: [
    ['CH 72', 'CAL ROOK · LOST KEY', 'Incoming tide has the mangrove cut moving. Anything loose is coming out with it.'],
    ['CH 16', 'SHRIMP SKIFF 4', 'Outbound Mangrove Reach, taking the north fork slow.'],
    ['CH 68', 'LOST KEY CAMP', 'The green marker is gone again. Use the leaning mangrove, not the post.'],
  ],
  cypress: [
    ['CH 68', 'LEON DOSS · OLD MILL', 'One hull at a time through Old Mill. I have a work boat coming south.'],
    ['CH 16', 'CAMP RADIO', 'Fresh deadhead in Cypress Reach, just under the skin by the west bank.'],
    ['CH 68', 'JUNE BELL · SPLIT PINE', 'Fog is holding under the domes. If you lose the sky, slow down.'],
  ],
  emerald: [
    ['CH 68', 'MARA KEENE · TOWER', 'Fuel dock stays open until lightning gets inside five miles.'],
    ['CH 16', 'BENT PINE CAMP', 'Small skiff leaving the tower lagoon. Northbound and slow.'],
    ['CH 09', 'FUEL DOCK', 'Anybody coming in dry, say how many gallons before you tie up.'],
  ],
  broad: [
    ['CH 16', 'TUG MARCEL', 'Commercial skiff downbound Broad River. Taking the outside of marker twelve.'],
    ['FWC TAC', 'WARDEN SOTO · FWC 27', 'Patrol twenty-seven northbound Broad. No-wake checks at the camps.'],
    ['CH 68', 'NET BOAT 9', 'Net boat turning across the river at the power line. I see the airboat.'],
  ],
  rookery: [
    ['FWC TAC', 'WARDEN SOTO · FWC 27', 'Rookery Lakes idle zone is active. Chicks are still on the low nests.'],
    ['CH 68', 'BIRD CREW', 'White stakes shifted in the night. Give the west rookery another fifty yards.'],
    ['CH 16', 'LOCAL SKIFF', 'Manatees on the warm edge south of Rookery. Three adults and a calf.'],
  ],
  prairie: [
    ['CH 68', 'PUMP FOUR', 'Pump Four is releasing south. Current will turn in the grass before the river turns.'],
    ['FWC TAC', 'FWC AIR 2', 'Open-water lightning west of Ten Mile Prairie. Nothing tall out there but you.'],
    ['CH 16', 'LOCAL SKIFF', 'Eastbound over Ten Mile. Running the darker grass where the water holds.'],
  ],
  'dead-river': [
    ['CH 16', 'UNKNOWN SKIFF', 'Dead River southbound. No name, no dock call.'],
    ['CH 68', 'JUNE BELL · SPLIT PINE', 'Somebody stripped the batteries off the Dead River dock again. Bring your own light.'],
    ['CH 72', 'CAL ROOK · LOST KEY', 'If the old red marker is blinking, somebody wants you in the wrong cut.'],
  ],
};

export class RadioDirector {
  constructor(o) {
    Object.assign(this, o); // game, audio, environment, regions, encounters, law, reputation, condition, phys
    this.el = document.getElementById('radioState');
    this.queue = []; this.current = null; this.history = []; this.recent = new Map();
    this.clock = 0; this.airT = 0; this.gapT = 0; this.bootT = 2.3; this.ambientT = 15 + Math.random() * 8;
    this.enabled = false; this.started = false; this.lastAmbient = '';
    this.lastWeather = this.environment.key; this.lastRegion = null;
    this.lastEncounter = null; this.lastEncounterKnown = false; this.lastEncounterState = '';
    this.lastLawBand = 0; this.lastPursuit = false; this.lastCargo = false; this.lastDisabled = false;
  }

  intro() {
    const locals = this.reputation ? this.reputation.score('locals') : 0;
    if (locals >= 3) return ['CH 16', 'MARA KEENE · TOWER', 'Tower Boat, Mara here. Sixteen is open. The camps know your hull if you need them.'];
    if (locals <= -3) return ['CH 16', 'MARA KEENE · TOWER', 'Tower Boat, radio check. Keep sixteen clear, and do not make anybody come looking.'];
    return ['CH 16', 'MARA KEENE · TOWER', 'Tower Boat, this is Mara at the tower. Radio check. Channel sixteen stays open out here.'];
  }

  ambientPool() {
    const region = this.regions.current;
    const pool = region ? [...(REGION_TRAFFIC[region.id] || [])] : [];
    const hour = this.environment.hour, night = hour < 5.5 || hour > 20.5;
    const locals = this.reputation ? this.reputation.score('locals') : 0;
    const fwc = this.reputation ? this.reputation.score('fwc') : 0;
    const runners = this.reputation ? this.reputation.score('runners') : 0;
    const flow = this.environment.tideRate >= 0 ? 'Flood is building' : 'Ebb is running';
    pool.push(['CH 68', 'MARA KEENE · TOWER', `${flow}. Set a second line if you stop in a narrow cut.`]);
    if (night) pool.push(['CH 16', 'MARA KEENE · TOWER', 'Dock lights are sparse tonight. Call the camp before you enter its basin.']);
    if (locals >= 3) pool.push(['CH 68', 'JUNE BELL · SPLIT PINE', 'Tower Boat, Split Pine heard what you did. Coffee is on if you pass this way.']);
    else if (locals <= -3) pool.push(['CH 68', 'CAMP RADIO', 'That tower airboat is in the district. Nobody give out a private cut.']);
    if (fwc >= 3) pool.push(['FWC TAC', 'WARDEN SOTO · FWC 27', 'Tower airboat is a known clean operator. No need to hold them unless something changes.']);
    else if (fwc <= -3) pool.push(['FWC TAC', 'WARDEN SOTO · FWC 27', 'All units, tower airboat is a flagged hull. Log location and direction of travel.']);
    if (runners >= 3) pool.push(['CH 72', 'CAL ROOK · LOST KEY', 'Tower Boat, the back line is clear. You can answer on seventy-two.']);
    else if (runners <= -3) pool.push(['CH 72', 'CAL ROOK · LOST KEY', 'Tower Boat, this is not your channel anymore.']);
    return pool;
  }

  transmit({ channel = 'CH 16', speaker = 'RADIO', text, priority = 1, duration, key, cooldown = 45 } = {}) {
    if (!text) return false;
    const id = key || `${speaker}:${text}`;
    const heard = this.recent.get(id);
    if (heard != null && this.clock - heard < cooldown) return false;
    this.recent.set(id, this.clock);
    const msg = { channel, speaker, text, priority, key: id, queuedAt: this.clock, duration: duration || clamp(3.4 + text.length * 0.028, 4.4, 7.6) };
    if (this.current && priority >= 3 && priority > this.current.priority) {
      this.audio.radio(false, this.current.priority); this.current = null; this.airT = 0; this.gapT = 0; this.el && this.el.classList.remove('on');
      this.begin(msg); return true;
    }
    if (priority <= 0 && (this.current || this.queue.some(q => q.priority <= 0))) return false;
    this.queue.push(msg); this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    if (this.queue.length > 6) this.queue.length = 6;
    if (!this.current && this.gapT <= 0) this.next();
    return true;
  }

  begin(msg) {
    this.current = msg; this.airT = msg.duration;
    this.history.push({ ...msg, at: this.clock }); if (this.history.length > 24) this.history.shift();
    if (this.audio && this.audio.radio) this.audio.radio(true, msg.priority);
    if (!this.el) return;
    this.el.innerHTML = `<div class="radio-meta"><span>${esc(msg.channel)}</span><i>receiving</i></div><b>${esc(msg.speaker)}</b><p>${esc(msg.text)}</p>`;
    this.el.classList.toggle('urgent', msg.priority >= 3); this.el.classList.toggle('weather', msg.channel.startsWith('WX'));
    this.el.classList.add('on');
  }

  end() {
    if (!this.current) return;
    if (this.audio && this.audio.radio) this.audio.radio(false, this.current.priority);
    this.current = null; this.airT = 0; this.gapT = 0.85;
    if (this.el) this.el.classList.remove('on', 'urgent', 'weather');
  }

  next() {
    while (this.queue.length) {
      const msg = this.queue.shift();
      if (msg.priority < 3 && this.clock - msg.queuedAt > 28) continue;
      this.begin(msg); return;
    }
  }

  weatherCall(key) {
    const call = WEATHER_CALLS[key]; if (!call) return;
    const priority = key === 'hurricane' ? 4 : ['thunderstorm', 'hail', 'tropical'].includes(key) ? 3 : key === 'squall' ? 2 : 1;
    this.transmit({ channel: 'WX-3', speaker: call[0], text: call[1], priority, duration: priority >= 3 ? 7 : undefined, key: `weather:${key}`, cooldown: 90 });
  }

  regionCall(region) {
    const text = REGION_ENTRY[region.id]; if (!text) return;
    this.transmit({ channel: 'CH 68', speaker: 'MARA KEENE · TOWER', text, priority: 1, key: `region:${region.id}`, cooldown: 150 });
  }

  encounterCall(e) {
    if (e.type === 'distress') this.transmit({ channel: 'CH 16', speaker: e.recognized ? 'ELI · SKIFF 6' : 'DISTRESS SKIFF', text: e.recognized ? 'Tower Boat, if that is you by the flare, I have a dead motor and I am drifting.' : 'Any vessel near the flare, dead motor and no steerage. One person aboard.', priority: 3, key: `encounter:${e.type}:${Math.floor(e.t)}`, cooldown: 20 });
    else if (e.type === 'patrol') this.transmit({ channel: 'CH 16', speaker: 'WARDEN SOTO · FWC 27', text: e.wanted ? 'Emerald airboat, reduce speed and hold your line. This is a directed stop.' : e.recognized ? 'Tower Boat, Soto on twenty-seven. Bring the prop to idle for a quick check.' : 'Airboat ahead, this is FWC twenty-seven. Idle and maintain your heading.', priority: e.wanted ? 4 : 3, key: `encounter:${e.type}:${Math.floor(e.t)}`, cooldown: 20 });
    else if (e.type === 'smuggler') this.transmit({ channel: 'CH 72', speaker: 'CAL ROOK · LOST KEY', text: e.hostile ? 'Tower Boat. You know why that bundle is sitting where you can see it.' : e.trusted ? 'Tower Boat, Lost Key. The crew nearby knows your hull. Give them a clean signal.' : 'Somebody lost a parcel in your cut. Somebody else is still watching it.', priority: e.hostile ? 3 : 2, key: `encounter:${e.type}:${Math.floor(e.t)}`, cooldown: 20 });
    else if (e.type === 'salvage') this.transmit({ channel: 'CH 16', speaker: 'JUNE BELL · SPLIT PINE', text: 'Skiff went down in that weather. Three fuel drums broke loose—pick them up before a root opens one.', priority: 2, key: `encounter:${e.type}:${Math.floor(e.t)}`, cooldown: 20 });
  }

  encounterStateCall(e, state) {
    if (e.type === 'patrol' && state === 'pursuit') this.transmit({ channel: 'CH 16', speaker: 'WARDEN SOTO · FWC 27', text: 'Tower airboat, you are failing to stop. Patrol units switch to the back channels.', priority: 4, key: 'patrol:pursuit', cooldown: 50 });
    else if (e.type === 'smuggler' && state === 'chase') this.transmit({ channel: 'CH 72', speaker: 'UNKNOWN SKIFF', text: 'You picked up the wrong parcel. Put it in the water and turn away.', priority: 4, key: 'runners:chase', cooldown: 50 });
    else if (e.type === 'distress' && state === 'repair') this.transmit({ channel: 'CH 16', speaker: 'ELI · SKIFF 6', text: 'Hold her steady there. Fuel line is fouled; I need half a minute.', priority: 2, key: 'distress:repair', cooldown: 40 });
  }

  observe() {
    const weather = this.environment.key;
    if (weather !== this.lastWeather) { this.weatherCall(weather); this.lastWeather = weather; }

    const region = this.regions.current;
    if (region && this.lastRegion && region.id !== this.lastRegion) this.regionCall(region);
    if (region) this.lastRegion = region.id;

    const e = this.encounters.active;
    if (e !== this.lastEncounter) {
      this.lastEncounter = e; this.lastEncounterKnown = Boolean(e && e.known); this.lastEncounterState = e ? e.state : '';
      if (e && e.known) this.encounterCall(e);
    } else if (e) {
      if (e.known && !this.lastEncounterKnown) this.encounterCall(e);
      if (e.state !== this.lastEncounterState) this.encounterStateCall(e, e.state);
      this.lastEncounterKnown = Boolean(e.known); this.lastEncounterState = e.state;
    }

    const cargo = this.law.hasContraband(), cargoFresh = cargo && !this.lastCargo;
    const band = this.law.attention > 0.04 ? Math.ceil(this.law.attention) : 0;
    if (band > this.lastLawBand && band >= 2 && !this.law.pursuit && !cargoFresh) {
      this.transmit({ channel: 'FWC TAC', speaker: 'WARDEN SOTO · FWC 27', text: `All units, log the tower airboat. Last report: ${this.law.lastReason || 'unconfirmed activity in the backcountry'}.`, priority: band >= 4 ? 4 : 3, key: `law:${band}:${this.law.lastReason}`, cooldown: 35 });
    }
    this.lastLawBand = band;
    if (this.law.pursuit && !this.lastPursuit) this.transmit({ channel: 'FWC TAC', speaker: 'FWC DISPATCH', text: 'Twenty-seven is in pursuit of the tower airboat. Backcountry units hold the river exits.', priority: 4, key: 'law:pursuit', cooldown: 60 });
    this.lastPursuit = this.law.pursuit;

    if (cargoFresh) this.transmit({ channel: 'CH 72', speaker: 'CAL ROOK · LOST KEY', text: 'Keep that package off sixteen. Too many uniforms have their radios open.', priority: 3, key: 'cargo:hot', cooldown: 90 });
    this.lastCargo = cargo;

    const disabled = this.condition.needsTow();
    if (disabled && !this.lastDisabled) this.transmit({ channel: 'CH 16', speaker: 'MARA KEENE · TOWER', text: 'Tower Boat, copy disabled hull. Kill the battery, stay with the boat, and give me water around you.', priority: 4, key: 'boat:disabled', cooldown: 90 });
    this.lastDisabled = disabled;
  }

  sample(kind = 'ambient') {
    if (kind === 'weather') { this.weatherCall(this.environment.key); return; }
    if (kind === 'emergency') { this.transmit({ channel: 'CH 16', speaker: 'MARA KEENE · TOWER', text: 'Tower Boat, break traffic. Waterspout reported in your cut. Turn away from the dark water.', priority: 4, key: `debug:emergency:${this.clock}`, cooldown: 0 }); return; }
    const list = this.ambientPool(); if (list.length) { const [channel, speaker, text] = pick(list); this.transmit({ channel, speaker, text, priority: 0, key: `debug:${this.clock}`, cooldown: 0 }); }
  }

  update(dt, enabled = true) {
    if (!enabled) { this.enabled = false; return; }
    if (!this.enabled) {
      this.enabled = true; this.lastWeather = this.environment.key; this.lastRegion = this.regions.current ? this.regions.current.id : null;
      this.lastLawBand = this.law.attention > 0.04 ? Math.ceil(this.law.attention) : 0; this.lastPursuit = this.law.pursuit;
      this.lastCargo = this.law.hasContraband(); this.lastDisabled = this.condition.needsTow();
    }
    this.clock += dt; this.observe();

    if (this.bootT > 0) {
      this.bootT -= dt;
      if (this.bootT <= 0 && !this.started) {
        this.started = true; const [channel, speaker, text] = this.intro();
        this.transmit({ channel, speaker, text, priority: 2, key: 'radio:intro', cooldown: 99999 });
      }
    }

    this.ambientT -= dt;
    if (this.ambientT <= 0 && !this.game.state && !this.encounters.active && !this.incidents?.active && !this.story?.busy()) {
      const pool = this.ambientPool(); let call = pool.length ? pick(pool) : null;
      if (pool.length > 1 && call && `${call[1]}:${call[2]}` === this.lastAmbient) call = pool[(pool.indexOf(call) + 1) % pool.length];
      if (call) {
        const [channel, speaker, text] = call; this.lastAmbient = `${speaker}:${text}`;
        this.transmit({ channel, speaker, text, priority: 0, key: `ambient:${speaker}:${text}`, cooldown: 180 });
      }
      const storm = this.environment.values.storm || 0;
      this.ambientT = (storm > 0.7 ? 25 : 38) + Math.random() * (storm > 0.7 ? 20 : 34);
    }

    if (this.current) { this.airT -= dt; if (this.airT <= 0) this.end(); }
    else if (this.gapT > 0) { this.gapT -= dt; if (this.gapT <= 0) this.next(); }
    else this.next();
  }
}
