import { emitMapMarker } from './mapmarkers.js';

const MPH = 2.23694;

// The story boats do not disappear into a mission flag. Once they are off duty,
// their owners return to familiar water and remember which hull came alongside.
export class StoryResidents {
  constructor(parent) {
    this.P = parent;
    const saved = parent.game.save.residents || {};
    this.state = parent.game.save.residents = {
      contacts: saved.contacts && typeof saved.contacts === 'object' ? saved.contacts : {},
    };
    this.obs = [];
    parent.phys.addObs('story-residents', this.obs);
    this.away = new Set();
    this.entries = [
      {
        id: 'leon', name: 'LEON DOSS', place: 'OLD MILL', channel: 'CH 68', color: '#e4c26f',
        mesh: parent.rigs.oldMill, point: parent.state.coords.local, hours: [5.4, 19.2], present: false, inside: false,
      },
      {
        id: 'cal', name: 'CAL ROOK', place: 'LOST KEY', channel: 'CH 72', color: '#cf7e43',
        mesh: parent.rigs.lostKey, point: parent.state.coords.runner, hours: [15, 5.5], present: false, inside: false,
      },
      {
        id: 'june', name: 'JUNE BELL', place: 'SPLIT PINE', channel: 'CH 68', color: '#79a9b8',
        mesh: parent.passage.rigs.aid, point: parent.passage.state.coords.aid, hours: [6, 22], present: false, inside: false,
      },
    ];
    for (const e of this.entries) {
      e.present = this.scheduled(e);
      e.obstacle = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.08, tag: `${e.name.toLowerCase()} work skiff` };
    }
  }

  scheduled(entry) {
    const h = this.P.environment.hour, [from, to] = entry.hours;
    const onClock = from < to ? h >= from && h < to : h >= from || h < to;
    return onClock && this.P.environment.values.storm < 0.92;
  }

  departed(mesh) { if (mesh) this.away.add(mesh); }

  missionOwns(entry) {
    const P = this.P;
    if (P.departMesh === entry.mesh) return true;
    if (P.stormLine?.owns(entry.mesh)) return true;
    if (entry.id === 'leon' || entry.id === 'cal') {
      const selected = P.state.branch === 'runner' ? P.rigs.lostKey : P.rigs.oldMill;
      return P.state.stage === 'delivery' && selected === entry.mesh;
    }
    const s = P.passage.state;
    return entry.id === 'june' && s.stage === 'delivery' && s.branch === 'rescue';
  }

  syncCargo() {
    const P = this.P, S = P.state, Q = P.passage;
    if (S.stage === 'complete') {
      const owner = S.ending === 'runner' ? P.rigs.lostKey : P.rigs.oldMill;
      if (P.rigs.case.parent === owner) P.rigs.case.visible = true;
    }
    if (Q.state.stage !== 'complete') return;
    if (Q.state.ending === 'rescue') {
      if (Q.rigs.cooler.parent === Q.rigs.aid) Q.rigs.cooler.visible = true;
      if (Q.rigs.survivor.parent === Q.rigs.aid) Q.rigs.survivor.visible = true;
      return;
    }
    if (Q.state.ending === 'runner' && !P.departMesh && Q.rigs.cooler.parent !== P.rigs.lostKey) {
      P.rigs.lostKey.add(Q.rigs.cooler);
      Q.rigs.cooler.position.set(-0.48, 0.7, -1.02);
      Q.rigs.cooler.rotation.set(0, -0.15, 0);
    }
    if (Q.state.ending === 'runner' && Q.rigs.cooler.parent === P.rigs.lostKey) Q.rigs.cooler.visible = true;
    if (Q.state.ending === 'runner') Q.rigs.survivor.visible = false;
  }

  line(entry) {
    const P = this.P, base = P.state, passage = P.passage.state, high = P.stormLine?.state;
    if (entry.id === 'leon') {
      if (high?.ending === 'rescue') return 'Old Mill’s storm generator is holding. The gold berth light stays on whenever the water comes up.';
      if (high?.ending === 'runner') return 'Split Pine ran on lanterns while a generator hummed in Cal’s mangroves. People remember that.';
      if (base.stage !== 'complete') return 'Tower Boat, Old Mill. Work skiff is in the east pocket. Leave room for the line.';
      if (base.ending === 'runner') return 'I know where my controller went. Keep that hull clear of the Old Mill boat.';
      if (passage.ending === 'rescue') return 'Nolan says you held the fan down all the way to Split Pine. Good work.';
      return 'West Cut light is holding. I still check it every tide.';
    }
    if (entry.id === 'cal') {
      if (high?.ending === 'runner') return 'Storm cache is dry and the cold box is steady. Seventy-two has work for a hull that can hold a lead.';
      if (high?.ending === 'rescue') return 'Old Mill kept the generator. Do not mistake the storm for a clean slate.';
      if (passage.ending === 'runner') return 'Cooler stayed sealed. Seventy-two is open when I have another quiet run.';
      if (passage.ending === 'rescue') return 'You cost me a clean cooler and showed Soto the route. Do not crowd this boat.';
      if (base.ending === 'local') return 'Leon got his light. I remember which hull carried it home.';
      return 'Lost Key sees the tower boat. Hold outside until I call you in.';
    }
    if (high?.ending === 'rescue') return 'Nolan and the cold box made Old Mill before the core band. The refuge light is yours as much as ours.';
    if (high?.ending === 'runner') return 'Split Pine counted every hour that generator spent in the mangroves.';
    if (passage.ending === 'rescue') return 'Nolan is awake and complaining about the coffee. That means he is getting better.';
    if (passage.ending === 'runner') return 'Nolan lived. That is the only part of your wake I am grateful for.';
    if (base.ending === 'local') return 'Leon put the green back on West Cut. Split Pine heard who brought the controller.';
    return 'Split Pine aid boat is standing by. Keep the berth clear if sixteen breaks traffic.';
  }

  greet(entry) {
    const day = this.P.environment.day, c = this.state.contacts[entry.id] || { count: 0, lastDay: 0 };
    if (c.lastDay === day) return;
    c.count += 1; c.lastDay = day; this.state.contacts[entry.id] = c;
    this.P.radio.transmit({
      channel: entry.channel, speaker: `${entry.name} · ${entry.place}`, text: this.line(entry), priority: 1,
      key: `resident:${entry.id}:${day}`, cooldown: 0,
    });
    this.P.game.persist();
  }

  addObstacle(entry) {
    const selected = this.P.state.branch === 'runner' ? this.P.rigs.lostKey : this.P.rigs.oldMill;
    if (this.P.state.stage === 'complete' && selected === entry.mesh) return;
    const p = entry.point, o = entry.obstacle, fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    o.ax = p.x + fx * 2.1; o.az = p.z + fz * 2.1; o.bx = p.x - fx * 2.1; o.bz = p.z - fz * 2.1;
    this.obs.push(o);
  }

  update(dt, t, enabled = true) {
    this.obs.length = 0;
    if (!enabled) return;
    this.syncCargo();
    const P = this.P, px = P.phys.pos.x, pz = P.phys.pos.y;
    for (const entry of this.entries) {
      if (this.missionOwns(entry)) { entry.inside = false; continue; }
      const d = Math.hypot(entry.point.x - px, entry.point.z - pz), wanted = this.scheduled(entry);
      if (wanted !== entry.present && d > 240) entry.present = wanted;
      if (this.away.has(entry.mesh)) {
        if (d > 320) this.away.delete(entry.mesh);
        else { entry.mesh.visible = false; entry.inside = false; continue; }
      }
      const visible = entry.present && d < 950;
      entry.mesh.visible = visible;
      if (!visible) { entry.inside = false; continue; }
      P.placeBoat(entry.mesh, entry.point, t);
      if (d < 82) this.addObstacle(entry);
      if (d < 230) emitMapMarker(P.game, entry.point.x, entry.point.z, 'boat', entry.color, entry.point.heading);
      if (d < 68 && !entry.inside && P.phys.speed * MPH < 28 && !P.busy() && !P.game.state && !P.game.paused) this.greet(entry);
      entry.inside = d < 105;
    }
  }
}
