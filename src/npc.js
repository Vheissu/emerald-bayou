import * as THREE from 'three';

// The poacher's johnboat: flat aluminium skiff, outboard on the transom, two men and a pile of net.
export function buildSkiff({ crew = true } = {}) {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0x6f7570, roughness: 0.55, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2120, roughness: 0.7, metalness: 0.3 });
  const shape = new THREE.Shape();
  const pts = [[0, -2.3], [0.5, -2.0], [0.8, -1.2], [0.85, 1.9], [-0.85, 1.9], [-0.8, -1.2], [-0.5, -2.0]];
  shape.moveTo(pts[0][0], -pts[0][1]); for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1]); shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }); hullGeo.rotateX(-Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, alu); hull.castShadow = true; g.add(hull);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.04, 3.9), dark); inner.position.set(0, 0.12, -0.1); g.add(inner);
  for (const z of [-1.0, 0.4]) { const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.3), alu); bench.position.set(0, 0.42, z); g.add(bench); }
  // outboard
  const motor = new THREE.Group(); motor.position.set(0, 0.55, 2.0);
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.5), dark); cowl.position.y = 0.3; motor.add(cowl);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.2), dark); leg.position.set(0, -0.35, 0.05); motor.add(leg);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), alu); tiller.rotation.x = Math.PI / 2; tiller.position.set(-0.15, 0.25, -0.5); motor.add(tiller);
  g.add(motor);
  // two poachers: camo shirts, one at the tiller, one on the front bench
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.9 });
  const person = (x, z, cap) => {
    const p = new THREE.Group(); p.position.set(x, 0.45, z);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 8), shirt); torso.position.y = 0.42; p.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skin); head.position.y = 0.82; p.add(head);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.1, 10), new THREE.MeshStandardMaterial({ color: cap, roughness: 0.9 })); hat.position.y = 0.92; p.add(hat);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 6), new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9 })); leg.position.set(sx * 0.1, 0.12, -0.15); leg.rotation.x = -1.1; p.add(leg); }
    p.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return p;
  };
  if (crew) { g.add(person(0.15, 1.3, 0xc8442c)); g.add(person(-0.1, -0.7, 0x3a3a3a)); }
  const net = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 1 })); net.scale.set(1.4, 0.5, 1); net.position.set(0, 0.35, -1.6); g.add(net);
  const fuel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.25), new THREE.MeshStandardMaterial({ color: 0xc03a2b, roughness: 0.6 })); fuel.position.set(0.5, 0.3, 1.2); g.add(fuel);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.motor = motor;
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
    this.mesh.userData.motor.rotation.y = -turn * 0.4;
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
