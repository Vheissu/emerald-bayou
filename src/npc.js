import * as THREE from 'three';
import { loadDriver } from './airboat.js';
import { person } from './folk.js';
import { mulberry32 } from './noise.js';

function skiffHullGeometry() {
  const stations = [
    { z: -2.36, top: 0.05, y: 0.17, chine: 0.015, cy: -0.2 },
    { z: -1.72, top: 0.54, y: 0.38, chine: 0.31, cy: -0.37 },
    { z: -0.55, top: 0.77, y: 0.44, chine: 0.56, cy: -0.47 },
    { z: 0.75, top: 0.85, y: 0.44, chine: 0.63, cy: -0.46 },
    { z: 1.92, top: 0.86, y: 0.41, chine: 0.64, cy: -0.41 },
  ];
  const p = [], tri = (a, b, c) => p.push(...a, ...b, ...c), quad = (a, b, c, d) => { tri(a, b, d); tri(b, c, d); };
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    quad([-a.top, a.y, a.z], [-a.chine, a.cy, a.z], [-b.chine, b.cy, b.z], [-b.top, b.y, b.z]);
    quad([a.chine, a.cy, a.z], [a.top, a.y, a.z], [b.top, b.y, b.z], [b.chine, b.cy, b.z]);
    quad([-a.chine, a.cy, a.z], [a.chine, a.cy, a.z], [b.chine, b.cy, b.z], [-b.chine, b.cy, b.z]);
  }
  const stern = stations[stations.length - 1];
  quad([-stern.top, stern.y, stern.z], [-stern.chine, stern.cy, stern.z], [stern.chine, stern.cy, stern.z], [stern.top, stern.y, stern.z]);
  const bow = stations[0];
  quad([-bow.top, bow.y, bow.z], [bow.top, bow.y, bow.z], [bow.chine, bow.cy, bow.z], [-bow.chine, bow.cy, bow.z]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.computeVertexNormals(); geo.computeBoundingSphere(); return geo;
}

const SKIFF_GEO = {
  hull: skiffHullGeometry(), floor: new THREE.BoxGeometry(1.16, 0.055, 3.28), rail: new THREE.BoxGeometry(0.075, 0.075, 3.43),
  bowRail: new THREE.BoxGeometry(1.0, 0.07, 0.08), rib: new THREE.BoxGeometry(1.38, 0.045, 0.075), bench: new THREE.BoxGeometry(1.43, 0.09, 0.34),
  cowl: new THREE.CapsuleGeometry(0.22, 0.28, 4, 8), stripe: new THREE.BoxGeometry(0.455, 0.055, 0.46), leg: new THREE.BoxGeometry(0.12, 0.86, 0.18),
  tiller: new THREE.CylinderGeometry(0.02, 0.02, 0.74, 6), hub: new THREE.CylinderGeometry(0.045, 0.045, 0.24, 8), blade: new THREE.BoxGeometry(0.04, 0.34, 0.075),
  torso: new THREE.CapsuleGeometry(0.17, 0.4, 4, 8), head: new THREE.SphereGeometry(0.11, 10, 8), nose: new THREE.SphereGeometry(0.026, 6, 5), hat: new THREE.CylinderGeometry(0.12, 0.13, 0.1, 10), brim: new THREE.BoxGeometry(0.15, 0.018, 0.12),
  legBody: new THREE.CapsuleGeometry(0.06, 0.3, 4, 6), arm: new THREE.CapsuleGeometry(0.048, 0.32, 4, 6), net: new THREE.SphereGeometry(0.4, 10, 7),
  netCoil: new THREE.TorusGeometry(0.25, 0.028, 5, 14), fuel: new THREE.BoxGeometry(0.35, 0.3, 0.25), cleat: new THREE.BoxGeometry(0.14, 0.055, 0.045),
};
const SKIFF_MAT = {
  hull: new THREE.MeshStandardMaterial({ color: 0x6f7570, roughness: 0.48, metalness: 0.74, side: THREE.DoubleSide }),
  aluminum: new THREE.MeshStandardMaterial({ color: 0x969c96, roughness: 0.5, metalness: 0.68 }), floor: new THREE.MeshStandardMaterial({ color: 0x252a28, roughness: 0.86, metalness: 0.22 }),
  motor: new THREE.MeshStandardMaterial({ color: 0x161918, roughness: 0.46, metalness: 0.42 }), stripe: new THREE.MeshStandardMaterial({ color: 0xc3c8c3, roughness: 0.45, metalness: 0.52 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.85 }), shirt: new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.9 }), pants: new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9 }),
  capRed: new THREE.MeshStandardMaterial({ color: 0xc8442c, roughness: 0.9 }), capDark: new THREE.MeshStandardMaterial({ color: 0x303332, roughness: 0.9 }),
  net: new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 1, wireframe: true }), rope: new THREE.MeshStandardMaterial({ color: 0xa58e59, roughness: 1 }), fuel: new THREE.MeshStandardMaterial({ color: 0xc03a2b, roughness: 0.6 }),
};
const skiffPart = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
let skiffSerial = 0;
function skiffCrew(x, z, cap, driver = false) {
  const p = new THREE.Group(); p.position.set(x, 0.5, z);
  const torso = skiffPart(SKIFF_GEO.torso, SKIFF_MAT.shirt); torso.position.y = 0.42; p.add(torso);
  const headPivot = new THREE.Group(); headPivot.position.y = 0.82; p.add(headPivot);
  const head = skiffPart(SKIFF_GEO.head, SKIFF_MAT.skin); headPivot.add(head);
  const nose = skiffPart(SKIFF_GEO.nose, SKIFF_MAT.skin); nose.position.set(0, 0, -0.104); headPivot.add(nose);
  const hat = skiffPart(SKIFF_GEO.hat, cap); hat.position.y = 0.1; headPivot.add(hat);
  const brim = skiffPart(SKIFF_GEO.brim, cap); brim.position.set(0, 0.105, -0.085); brim.rotation.x = 0.12; headPivot.add(brim);
  const arms = [];
  for (const sx of [-1, 1]) {
    const leg = skiffPart(SKIFF_GEO.legBody, SKIFF_MAT.pants); leg.position.set(sx * 0.1, 0.12, -0.15); leg.rotation.x = -1.1; p.add(leg);
    const arm = skiffPart(SKIFF_GEO.arm, SKIFF_MAT.skin); arm.position.set(sx * 0.19, 0.48, driver ? 0.06 : -0.03); arm.rotation.x = driver ? -1.22 : -0.72; arm.rotation.z = sx * (driver ? -0.35 : -0.18); p.add(arm);
    arms.push(arm);
  }
  p.userData.skiffCrew = { driver, torso, head: headPivot, arms, baseX: arms.map(a => a.rotation.x), baseZ: arms.map(a => a.rotation.z), phase: driver ? 0.4 : 2.1 };
  return p;
}

// A shallow-draft, open aluminium johnboat shared by traffic, residents, incidents and shoreline sets.
export function buildSkiff({ crew = true } = {}) {
  const g = new THREE.Group(); g.name = 'aluminum johnboat';
  const hull = skiffPart(SKIFF_GEO.hull, SKIFF_MAT.hull); g.add(hull);
  const floor = skiffPart(SKIFF_GEO.floor, SKIFF_MAT.floor); floor.position.set(0, 0.07, 0.16); g.add(floor);
  for (const side of [-1, 1]) { const rail = skiffPart(SKIFF_GEO.rail, SKIFF_MAT.aluminum); rail.position.set(side * 0.69, 0.46, 0.2); rail.rotation.y = side * 0.082; g.add(rail); }
  const bowRail = skiffPart(SKIFF_GEO.bowRail, SKIFF_MAT.aluminum); bowRail.position.set(0, 0.43, -1.7); g.add(bowRail);
  const ribs = new THREE.InstancedMesh(SKIFF_GEO.rib, SKIFF_MAT.aluminum, 4); const matrix = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) { matrix.makeTranslation(0, 0.22, -1.28 + i * 0.82); ribs.setMatrixAt(i, matrix); } ribs.instanceMatrix.needsUpdate = true; ribs.castShadow = ribs.receiveShadow = true; g.add(ribs);
  for (const z of [-0.95, 0.45]) { const bench = skiffPart(SKIFF_GEO.bench, SKIFF_MAT.aluminum); bench.position.set(0, 0.49, z); g.add(bench); }
  const cleats = new THREE.InstancedMesh(SKIFF_GEO.cleat, SKIFF_MAT.aluminum, 4);
  for (let i = 0; i < 4; i++) { matrix.makeTranslation(i % 2 ? 0.69 : -0.69, 0.53, i < 2 ? -1.38 : 1.34); cleats.setMatrixAt(i, matrix); } cleats.instanceMatrix.needsUpdate = true; cleats.castShadow = true; g.add(cleats);
  const motor = new THREE.Group(); motor.position.set(0, 0.51, 1.97);
  const cowl = skiffPart(SKIFF_GEO.cowl, SKIFF_MAT.motor); cowl.scale.set(1, 0.78, 1.12); cowl.position.y = 0.29; motor.add(cowl);
  const stripe = skiffPart(SKIFF_GEO.stripe, SKIFF_MAT.stripe); stripe.position.set(0, 0.31, -0.02); motor.add(stripe);
  const leg = skiffPart(SKIFF_GEO.leg, SKIFF_MAT.motor); leg.position.set(0, -0.37, 0.05); motor.add(leg);
  const tiller = skiffPart(SKIFF_GEO.tiller, SKIFF_MAT.aluminum); tiller.rotation.x = Math.PI / 2; tiller.position.set(-0.16, 0.22, -0.49); motor.add(tiller);
  const prop = new THREE.Group(); prop.position.set(0, -0.72, 0.26);
  const hub = skiffPart(SKIFF_GEO.hub, SKIFF_MAT.motor); hub.rotation.x = Math.PI / 2; prop.add(hub);
  for (const r of [0, Math.PI / 2]) { const blade = skiffPart(SKIFF_GEO.blade, SKIFF_MAT.motor); blade.position.z = 0.07; blade.rotation.z = r; prop.add(blade); }
  motor.add(prop); motor.userData.prop = prop;
  g.add(motor);
  const crewList = [], people = [];
  if (crew) {
    const driver = skiffCrew(0.16, 1.18, SKIFF_MAT.capRed, true); g.add(driver); crewList.push(driver);
    const rr = mulberry32(0x51cf2d + skiffSerial++ * 977); const deckhand = person(rr, { pose: 'sit', hat: true, vest: rr() < 0.55 }); deckhand.scale.setScalar(0.74); deckhand.position.set(-0.1, 0.142, -0.68); deckhand.rotation.y = Math.PI; g.add(deckhand); people.push(deckhand);
    loadDriver(g, { scale: 0.48, position: [0.16, 0.49, 1.16] }).then(model => { driver.visible = false; g.userData.driverModel = model; }).catch(() => {});
  }
  const net = skiffPart(SKIFF_GEO.net, SKIFF_MAT.net); net.scale.set(1.32, 0.42, 0.8); net.position.set(0, 0.42, -1.52); g.add(net);
  for (const x of [-0.24, 0.22]) { const coil = skiffPart(SKIFF_GEO.netCoil, SKIFF_MAT.rope); coil.rotation.x = Math.PI / 2; coil.position.set(x, 0.5, -1.48); g.add(coil); }
  const fuel = skiffPart(SKIFF_GEO.fuel, SKIFF_MAT.fuel); fuel.position.set(0.5, 0.32, 1.16); g.add(fuel);
  g.userData.motor = motor; g.userData.crew = crewList; g.userData.people = people;
  return g;
}

// A boat that runs a list of waypoints with a pure-pursuit steer and slows for the bends.
export class SkiffAI {
  constructor(waveFn) {
    this.mesh = buildSkiff();
    this.pos = new THREE.Vector2(); this.vel = new THREE.Vector2(); this.heading = 0; this.speed = 0;
    this.maxSpeed = 11.6; this.path = []; this.i = 0; this.active = false; this.done = false; this.waveFn = waveFn;
    this.roll = 0; this.pitch = 0; this.dist = 0;
    this.lookAhead = 14; this._flow = new THREE.Vector2();
  }
  start(path, speed) {
    this.path = path; this.i = 0; this.maxSpeed = speed || 11.6;
    this.pos.set(path[0].x, path[0].z); this.heading = Math.atan2(-(path[1].x - path[0].x), -(path[1].z - path[0].z));
    this.vel.set(0, 0); this.speed = 0; this.active = true; this.done = false; this.mesh.visible = true; this.dist = 0;
  }
  stop() { this.active = false; this.mesh.visible = false; }
  forward(out = new THREE.Vector2()) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); }
  update(dt, t, hold = 0) {
    if (!this.active) return;
    // advance the target index past waypoints we are within reach of, then steer at a point a little ahead
    while (this.i < this.path.length - 1 && Math.hypot(this.path[this.i].x - this.pos.x, this.path[this.i].z - this.pos.y) < this.lookAhead) this.i++;
    const tgt = this.path[this.i];
    const want = Math.atan2(-(tgt.x - this.pos.x), -(tgt.z - this.pos.y));
    let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turnRate = 1.6;
    const turn = Math.max(-turnRate, Math.min(turnRate, dh * 3.0));
    this.heading += turn * dt;
    // slow for the bends, and if told to (a boat alongside)
    const bend = Math.min(1, Math.abs(dh) / 0.8);
    const tgtSpeed = this.maxSpeed * (1 - bend * 0.3) * (1 - hold * 0.8);
    this.speed += (tgtSpeed - this.speed) * (1 - Math.exp(-dt * (tgtSpeed > this.speed ? 0.6 : 2.0)));
    const f = this.forward();
    this.vel.set(f.x * this.speed, f.y * this.speed);
    if (this.currents) this.vel.add(this.currents.flowAt(this.pos.x, this.pos.y, this._flow));
    this.pos.addScaledVector(this.vel, dt); this.dist += this.speed * dt;
    this.roll += ((-turn * this.speed * 0.02) - this.roll) * (1 - Math.exp(-dt * 4));
    this.pitch += ((this.speed * 0.006) - this.pitch) * (1 - Math.exp(-dt * 3));
    const y = this.waveFn(this.pos.x, this.pos.y, t);
    this.mesh.position.set(this.pos.x, y - 0.05, this.pos.y);
    this.mesh.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
    this.mesh.userData.motor.rotation.y = -turn * 0.4; this.mesh.userData.motor.userData.prop.rotation.z += dt * (6 + this.speed * 5);
    if (this.i >= this.path.length - 1 && Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.y) < 6) this.done = true;
  }
  // wake stamps for the water sim (only worth pushing when inside the sim window)
  stamps(out) {
    if (!this.active || this.speed < 2) return;
    const f = this.forward(); const sp = Math.min(1, this.speed / 11);
    out.push({ x: this.pos.x - f.x * 1.8, z: this.pos.y - f.y * 1.8, radius: 1.1, height: 0.5 * sp, foam: 1.6 * sp, foamRadius: 1.0 });
    out.push({ x: this.pos.x + f.x * 1.8, z: this.pos.y + f.y * 1.8, radius: 1.0, height: -0.7 * sp, foam: 0.1 * sp, foamRadius: 0.7 });
  }
}
