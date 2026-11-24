import { raceCourseDistances, raceCourseProgress, racePositionLabel } from './raceformats.js';
import { RegattaMarks } from './regattamarks.js';

const RACES = [
  {
    id: 'north-reach', title: 'North Reach Sprint', type: 'Head to head', rival: 'Mud Hen',
    reward: 340, second: 155, speed: 12.2, gold: 40, silver: 54, bronze: 70, timeLimit: 104,
    desc: 'Eleven marks through the north bends. Keep an eye out for the sandbars.',
    course: [[40,90],[15,143],[25,215],[30,240],[20,268],[20,320],[15,373],[30,430],[60,495],[45,520],[35,555],[35,610]],
  },
  {
    id: 'tower-circuit', title: 'Tower Circuit', type: 'Two laps', rival: 'Tin Lizzie',
    reward: 690, second: 275, speed: 14.1, gold: 74, silver: 96, bronze: 130, timeLimit: 175,
    desc: 'Two laps around the fire tower island. Open water and long bends.',
    course: [[53,-145],[120,-145],[145,-180],[160,-220],[145,-270],[105,-305],[60,-315],[10,-280],[0,-225],[10,-180],[53,-145]],
    laps: 2,
  },
  {
    id: 'red-bend', title: 'Red Bend Time Trial', type: 'Solo time trial',
    reward: 410, gold: 27, silver: 38, bronze: 52, timeLimit: 76,
    desc: 'Run south through the narrow cuts. Beat 1:16 to collect the purse.',
    course: [[-70,-275],[-65,-280],[-65,-315],[-70,-335],[-58,-354],[-25,-415],[-30,-475],[-5,-520],[-5,-585],[15,-645]],
  },
];

function entryFraction(ax, az, bx, bz, gate) {
  const x = ax - gate.x, z = az - gate.z, dx = bx - ax, dz = bz - az;
  const c = x * x + z * z - gate.r * gate.r;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return Infinity;
  const b = x * dx + z * dz, disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const entry = (-b - Math.sqrt(disc)) / a;
  return entry >= 0 && entry <= 1 ? entry : Infinity;
}

export function buildRegatta(game) {
  return RACES.map(race => {
    const [start, ...course] = race.course.map(([x, z]) => ({ x, z }));
    const laps = race.laps || 1;
    const gates = Array.from({ length: laps }, (_, lap) => course.map((point, i) => ({
      ...point, r: race.id === 'red-bend' && i === 0 ? 6 : 10,
      label: i === course.length - 1 ? (lap + 1 === laps ? 'Finish line' : 'Lap line') : `Checkpoint ${i + 1}`,
    }))).flat();
    const head = game.headingTo(start.x, start.z, course[0].x, course[0].z);
    const lane = sign => ({ x: start.x - sign * 3.1 * Math.cos(head), z: start.z + sign * 3.1 * Math.sin(head), heading: head });
    const line = race.rival ? lane(-1) : { ...start, heading: head };
    const rivalStart = lane(1);
    const path = [rivalStart, ...gates];
    const distances = raceCourseDistances(start, gates);
    const final = gates[gates.length - 1];
    const showGate = (state, G) => {
      const gate = gates[state.i], next = gates[state.i + 1];
      const level = G.environment?.waterLevel || 0;
      G.beacon.set(gate.x, level, gate.z, next ? 0xf07a2e : 0x7be08a, false);
      G.beacon2.hide();
      state.marks?.place(state.i, start, gates, G.T, level);
      G.wpTarget = gate;
    };
    return {
      ...race, gates, laps, distance: distances.at(-1), countdown: true, isRegatta: true,
      start: () => line,
      setup(state, G) {
        state.i = 0;
        state.previousX = line.x; state.previousZ = line.z;
        state.rivalRams = 0; state.rivalHitCd = 0; state.rivalFinish = Infinity;
        state.racePosition = race.rival ? `Alongside ${race.rival}` : '';
        if (G.scene && G.T) state.marks = new RegattaMarks(G.scene);
        if (race.rival) {
          state.rivalRace = true;
          G.skiff.start(path, race.speed, 6);
          G.beginMissionRival();
        }
        showGate(state, G);
      },
      update(state, G, dt, time) {
        const p = G.phys.pos;
        state.marks?.update(G.environment?.waterLevel || 0, time, G.world?.waveFn);
        if (state.rivalRace && !Number.isFinite(state.rivalFinish)) {
          state.rivalHitCd = Math.max(0, state.rivalHitCd - dt);
          const skiff = G.skiff, ax = skiff.pos.x, az = skiff.pos.y;
          G.skiff.update(dt, time);
          G.syncMissionRival();
          const fraction = skiff.i === path.length - 1 ? entryFraction(ax, az, skiff.pos.x, skiff.pos.y, final) : Infinity;
          if (Number.isFinite(fraction)) {
            state.rivalFinish = state.t - dt + dt * fraction;
            state.racePosition = `${race.rival} finished`;
            G.endMissionRival(); skiff.stop();
          } else {
            const ahead = raceCourseProgress(start, gates, distances, state.i, p.x, p.y);
            const opponent = raceCourseProgress(start, gates, distances, skiff.i - 1, skiff.pos.x, skiff.pos.y);
            state.racePosition = racePositionLabel(ahead, opponent, race.rival);
          }
        }
        const gate = gates[state.i];
        const fraction = entryFraction(state.previousX, state.previousZ, p.x, p.y, gate);
        state.previousX = p.x; state.previousZ = p.y;
        if (Number.isFinite(fraction)) {
          G.audio.checkpoint();
          if (++state.i >= gates.length) {
            state.t -= dt * (1 - fraction);
            if (state.t <= race.timeLimit) {
              state.place = state.t <= state.rivalFinish ? 1 : 2;
              return 'done';
            }
          } else {
            showGate(state, G);
            if (laps > 1 && state.i % course.length === 0) G.toast('Final lap', '', 1.5);
          }
        }
        if (state.t >= race.timeLimit) return { fail: 'The course closed before you finished.' };
        return null;
      },
      cleanup(state, G) {
        state.marks?.group.removeFromParent();
        if (state.rivalRace) { G.endMissionRival(); G.skiff.stop(); }
      },
      hud(state) {
        const checkpoint = state.i % course.length + 1;
        const lap = Math.min(laps, Math.floor(state.i / course.length) + 1);
        const split = `Gate ${checkpoint}/${course.length}`;
        return { obj: laps > 1 ? `Lap ${lap}/${laps} · ${split}` : split, sub: state.racePosition };
      },
      markers(state, G, out) {
        const count = Math.min(gates.length, state.i + 3);
        for (let i = state.i; i < count; i++) out.push({ ...gates[i], color: i === state.i ? '#f07a2e' : '#f3ede0', r: i === state.i ? 5 : 3 });
        if (race.rival && G.skiff.active) out.push({ x: G.skiff.pos.x, z: G.skiff.pos.y, color: '#e5c063', r: 3.5, heading: G.skiff.heading });
      },
    };
  });
}

export function recordRegattaFinish(save, race, time, place, rams = 0) {
  if (!Number.isFinite(time) || time < 0 || time > race.timeLimit || (place !== 1 && place !== 2) || (place === 2 && !race.rival)) return null;
  const prior = save.regatta?.[race.id];
  const clean = rams < 2;
  const purse = Math.round((place === 1 ? race.reward : race.second) * (clean ? 1 : 0.8));
  const record = {
    time: Number(prior?.time) > 0 ? Math.min(time, prior.time) : time,
    startsFinished: Math.max(0, Math.floor(Number(prior?.startsFinished) || 0)) + 1,
    wins: Math.max(0, Math.floor(Number(prior?.wins) || 0)) + Number(place === 1),
  };
  save.regatta = { ...save.regatta, [race.id]: record };
  return { purse, newBest: !prior || time < prior.time, clean };
}
