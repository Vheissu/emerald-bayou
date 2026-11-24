import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { person, animatePerson, wave } from './folk.js';
import { mulberry32 } from './noise.js';
import { loadAuthoredLanding } from './mulletlanding.js';

export const isRiverCall = type => type === 'sounder' || type === 'photoboat';

// Locally dispatched patrols skip the draw. Ordinary sightings sit out the next draw,
// and the two before that remain possible at a reduced weight.
export function drawEncounter(weights, recent = [], random = Math.random) {
  if (!Array.isArray(recent)) recent = [];
  const candidates = Object.entries(weights).filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  const weighted = candidates.map(([type, weight]) => {
    const since = recent.lastIndexOf(type);
    const age = since < 0 ? Infinity : recent.length - 1 - since;
    return [type, weight * (age === 0 && candidates.length > 1 ? 0 : age === 1 ? 0.23 : age === 2 ? 0.55 : 1)];
  });
  let draw = random() * weighted.reduce((sum, entry) => sum + entry[1], 0);
  for (const [type, weight] of weighted) {
    draw -= weight;
    if (draw < 0) return type;
  }
  return weighted.filter(entry => entry[1] > 0).at(-1)?.[0] || 'distress';
}

export function makeRiverCallRig(scene) {
  const skiff = buildSkiff({ crew: false });
  skiff.name = 'Channel workboat';
  const crew = person(mulberry32(426), { pose: 'stand', hat: true, vest: true });
  crew.position.set(0.18, 0.50, -0.6);
  const camera = new THREE.Group(), sensor = new THREE.Group();
  const oxide = new THREE.MeshStandardMaterial({ color: 0xbe623b, roughness: 0.61 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x687477, metalness: 0.55, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202627, roughness: 0.63 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffe6b3 });
  function piece(group, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    return mesh;
  }
  // Three folded steel legs, a tilt head and a long lens over the bow.
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const foot = new THREE.Vector3(Math.cos(angle) * 0.32, 0, Math.sin(angle) * 0.32);
    const top = new THREE.Vector3(0, 0.93, 0), axis = top.clone().sub(foot);
    const leg = piece(camera, new THREE.CylinderGeometry(0.018, 0.012, axis.length(), 6), metal, 0, 0, 0);
    leg.position.copy(foot).lerp(top, 0.5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  }
  const head = new THREE.Group(); head.position.y = 0.98; camera.add(head);
  piece(head, new THREE.BoxGeometry(0.27, 0.18, 0.16), dark, 0, 0.05, 0);
  piece(head, new THREE.CylinderGeometry(0.085, 0.064, 0.30, 14), dark, 0, 0.05, 0.20).rotation.x = Math.PI / 2;
  const flash = piece(head, new THREE.BoxGeometry(0.12, 0.075, 0.06), lamp, 0, 0.19, 0.05);
  camera.position.set(-0.32, 0.52, -0.82);
  // A salvaged steel drum supports the logger, its solar cells and the whip antenna.
  const float = piece(sensor, new THREE.CylinderGeometry(0.34, 0.33, 0.76, 24), metal, 0, -0.10, 0);
  loadAuthoredLanding()?.then(art => {
    const drum = art?.fuelDrums[0]?.clone(true);
    if (!drum) return;
    drum.position.set(0, -0.46, 0); drum.quaternion.identity(); drum.scale.set(1.10, 0.85, 1.10);
    sensor.add(drum); float.visible = false;
  });
  piece(sensor, new THREE.CylinderGeometry(0.365, 0.365, 0.09, 28), oxide, 0, 0.15, 0);
  piece(sensor, new THREE.CylinderGeometry(0.035, 0.052, 0.90, 10), metal, 0, 0.71, 0);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2, base = new THREE.Vector3(0.26 * Math.cos(angle), 0.29, 0.26 * Math.sin(angle));
    const apex = new THREE.Vector3(0, 0.82, 0), axis = apex.clone().sub(base);
    const strut = piece(sensor, new THREE.CylinderGeometry(0.014, 0.014, axis.length(), 6), metal, 0, 0, 0);
    strut.position.copy(base).lerp(apex, 0.5); strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  }
  const panel = new THREE.Group(); panel.position.set(0, 0.62, 0.12); panel.rotation.x = 0.28; sensor.add(panel);
  piece(panel, new THREE.BoxGeometry(0.45, 0.028, 0.28), metal, 0, 0, 0);
  const cell = new THREE.MeshStandardMaterial({ color: 0x203447, roughness: 0.27, metalness: 0.38 });
  for (const x of [-0.14, 0, 0.14]) piece(panel, new THREE.BoxGeometry(0.13, 0.008, 0.254), cell, x, 0.018, 0);
  piece(sensor, new THREE.CylinderGeometry(0.065, 0.076, 0.06, 14), oxide, 0, 1.16, 0);
  const lens = new THREE.MeshStandardMaterial({ color: 0xffb657, emissive: 0xff8428, emissiveIntensity: 0.16 });
  const blink = piece(sensor, new THREE.CylinderGeometry(0.059, 0.059, 0.11, 14), lens, 0, 1.24, 0);
  piece(sensor, new THREE.CylinderGeometry(0.043, 0.061, 0.023, 14), metal, 0, 1.305, 0);
  skiff.add(crew, camera); scene.add(skiff, sensor);
  skiff.visible = sensor.visible = flash.visible = false;
  return { skiff, crew, camera, head, flash, sensor, blink };
}

export function startRiverCall(d, type, at) {
  // Keep the working area in the same navigable reach as the anchored skiff.
  let lane;
  for (let i = 0; i < 16; i++) {
    const angle = at.heading + i * Math.PI / 8;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    if ([6, 12, 18, 24, 30, 36, 42, 48].some(r => {
      const x = at.x + dx * r, z = at.z + dz * r;
      return d.terrain.heightAt(x, z) > d.environment.waterLevel - 0.8 || d.world?.blockedAt(x, z);
    })) continue;
    lane = { x: at.x + dx * 45, z: at.z + dz * 45, dx, dz };
    break;
  }
  if (!lane) return false;
  const R = d.rigs.riverCall ??= makeRiverCallRig(d.scene);
  R.skiff.visible = true; R.camera.visible = type === 'photoboat'; R.sensor.visible = type === 'sounder'; R.flash.visible = false;
  R.sensor.scale.setScalar(1); R.skiff.rotation.y = at.heading;
  wave(R.crew);
  d.active = { type, ...at, lane, tx: lane.x, tz: lane.z, known: false, state: 'offer', t: 0, shotAt: 0,
    prize: type === 'sounder' ? 135 + Math.floor(Math.random() * 6) * 10 : 100 + Math.floor(Math.random() * 5) * 10 };
  updateRiverCall(d, d.active, 0, 0);
  return true;
}

export function riverCallObjective(e) {
  if (!e?.known || !isRiverCall(e.type) || e.state === 'offer') return null;
  if (e.type === 'sounder') return { title: 'Loose sounder', obj: e.state === 'recover' ? 'Idle alongside the flashing buoy.' : 'Return the recorder to the survey boat.' };
  return { title: 'Cover shot', obj: e.state === 'lineup' ? 'Run out to the photographer’s mark.' : 'Pass the camera at 18 mph or faster. Leave a boat length of room.' };
}

export function updateRiverCall(d, e, dt, t) {
  const R = d.rigs.riverCall, p = d.phys, offsetX = p.pos.x - e.x, offsetZ = p.pos.y - e.z;
  const range = Math.hypot(offsetX, offsetZ), survey = e.type === 'sounder';
  R.skiff.position.set(e.x, d.water.waveHeight(e.x, e.z, t) - 0.06, e.z);
  R.skiff.rotation.z = Math.sin(t * 0.8) * 0.025;
  Object.assign(d._personBoat, { x: p.pos.x, z: p.pos.y, speed: p.speed });
  animatePerson(R.crew, t, dt, d._personBoat);
  R.head.rotation.y = Math.atan2(offsetX, offsetZ) - e.heading;
  if (range < 70) {
    const o = d.fixedObs; o.x = e.x; o.z = e.z; o.r = 2.15; o.tag = 'work skiff'; d.obs.push(o);
  }
  if (survey && R.sensor.visible) {
    const flow = d.currents?.flowAt(e.tx, e.tz, d._flow);
    const x = e.tx + (flow?.x || 0) * dt * 0.48, z = e.tz + (flow?.y || 0) * dt * 0.48;
    if (d.terrain.heightAt(x, z) < d.environment.waterLevel - 0.75 && !d.world?.blockedAt(x, z)) { e.tx = x; e.tz = z; }
    R.sensor.position.set(e.tx, d.water.waveHeight(e.tx, e.tz, t), e.tz);
    R.sensor.rotation.z = Math.sin(t * 1.8) * 0.11; R.blink.material.emissiveIntensity = t % 1.3 < 0.38 ? 3.5 : 0.15;
  }
  if (!e.known && range < 108) d.known(e, survey ? 'Loose sounder' : 'Cover shot', survey ? 'A surveyor points downstream at a flashing float.' : 'A photographer waves from a skiff.');
  if (!e.known) return;
  if (e.state === 'offer') {
    d.point(e.x, e.z, survey ? 'Survey skiff' : 'Camera boat', '#e5c063');
    if (range > 14 || Math.abs(p.speed) > 2.8 || !d.canInteract()) return;
    d.setPrompt(survey ? 'Recover the sounder · $' + e.prize : 'Make a camera pass · $' + e.prize);
    if (d.interact) e.state = survey ? 'recover' : 'lineup';
    return;
  }
  const targetDistance = Math.hypot(p.pos.x - e.tx, p.pos.y - e.tz);
  if (e.state === 'recover' || e.state === 'lineup') {
    d.point(e.tx, e.tz, survey ? 'Drifting recorder' : 'Turnaround mark', '#e5c063');
    if (!survey && targetDistance < 11) { e.state = 'pass'; e.closestPass = Infinity; }
    if (survey && targetDistance < 6 && Math.abs(p.speed) < 1.8 && d.canInteract()) {
      d.setPrompt('Lift the recorder aboard');
      if (d.interact) { R.sensor.visible = false; e.state = 'return'; d.audio.pickup(); }
    }
  } else if (e.state === 'return') {
    d.point(e.x, e.z, 'Survey skiff', '#e5c063');
    if (range < 12 && Math.abs(p.speed) < 2 && d.canInteract()) {
      d.setPrompt('Hand over the recorder');
      if (d.interact) d.complete('Sounder returned', 'The surveyor dries the contacts and takes a reading.', e.prize, 1, 'Retrieved a lost survey instrument.', 'sounder-returned');
    }
  } else if (e.state === 'pass') {
    d.point(e.x + e.lane.dx * 12, e.z + e.lane.dz * 12, 'Camera pass', '#e5c063');
    if (range < 7) { e.state = 'lineup'; d.game.toast('Too close', 'Circle back to the mark and give the camera boat room.'); }
    else if (range < 26 && Math.abs(p.speed) >= 8.05) {
      e.closestPass = Math.min(e.closestPass, range);
      // The camera gets a side-on hull as the boat comes abeam and starts opening the gap.
      if (e.closestPass < 23 && range > e.closestPass + 1.1) {
        R.flash.visible = true; e.shotAt = e.t; e.state = 'exposed'; d.audio.pickup();
      }
    }
  } else if (e.t - e.shotAt > 0.23) {
    d.complete('Cover shot', 'The photographer lowers the camera and gives you a thumbs-up.', e.prize, 0, '', 'cover-shot');
  }
}
