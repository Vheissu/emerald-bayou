import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { person, animatePerson, wave, aim } from './folk.js';
import { crabFloat, fuelDrum, wreck } from './markers.js';
import { gatorMesh, manateeMesh } from './wildlife.js';
import { mulberry32 } from './noise.js';
import { fmtDist } from './game.js';
import { findGroundingSite } from './grounding.js';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const STEER_PROBES = [-0.65, -0.3, 0, 0.3, 0.65];
const MANATEE_PROBES = [0, -0.42, 0.42, -0.86, 0.86, -1.32, 1.32];
const DEBUG_ORDER = ['distress', 'grounding', 'fire', 'manatee', 'spotlight', 'patrol', 'smuggler', 'salvage', 'netline'];
const ENCOUNTER_MEMORY_LIMIT = 10;
const SPILL_POOL_SIZE = 3;

const SPILL_VS = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;
const SPILL_FS = `
  precision highp float;
  uniform float uTime, uAlpha, uPhase, uThin, uAgitation;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p), a = atan(p.y, p.x);
    float edge = 0.87 + sin(a * 5.0 + uPhase) * 0.055 + sin(a * 11.0 - uPhase * 1.7) * 0.028 + sin(a * 19.0 + uTime * 0.025) * 0.015;
    float shape = 1.0 - smoothstep(edge - 0.13, edge, r);
    float grain = sin(p.x * 19.0 + p.y * 12.0 + uPhase * 3.0 + sin(p.y * 8.0 - uTime * 0.04));
    float broken = mix(0.82 + grain * 0.08, smoothstep(-0.72, 0.48, grain), clamp(uAgitation, 0.0, 1.0));
    float film = smoothstep(0.98, 0.10, r) * (0.58 + 0.42 * sin(r * 13.0 - a * 2.0 + uPhase));
    float hue = r * 17.0 + a * 1.8 + uPhase * 4.0 + grain * 0.55;
    vec3 spectral = 0.5 + 0.5 * cos(vec3(0.15, 2.25, 4.25) + hue);
    spectral = mix(vec3(0.28, 0.24, 0.17), spectral, 0.58);
    vec3 silver = mix(vec3(0.105, 0.135, 0.125), vec3(0.31, 0.34, 0.31), 0.5 + grain * 0.28);
    float rainbow = (1.0 - uThin * 0.82) * (0.18 + film * 0.34);
    vec3 color = mix(silver, spectral, rainbow);
    float alpha = shape * broken * (0.085 + film * 0.105) * uAlpha * (1.0 - uThin * 0.38);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
  }`;

function recolor(group, color) {
  let first = true;
  group.traverse(o => {
    if (!first || !o.isMesh || !o.material || !o.material.color || o.material.metalness < 0.5) return;
    o.material = o.material.clone(); o.material.color.setHex(color); first = false;
  });
}

function signalLight(parent, color, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const light = new THREE.PointLight(color, 0, 30, 2); g.add(bulb, light); parent.add(g);
  return { group: g, bulb, light };
}

function makePackage() {
  const g = new THREE.Group();
  const wrap = new THREE.MeshStandardMaterial({ color: 0x30423a, roughness: 0.9 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xc2a168, roughness: 1 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.65), wrap); b.castShadow = true; g.add(b);
  for (const x of [-0.27, 0.27]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.018, 5, 16), rope); r.rotation.y = Math.PI / 2; r.position.x = x; g.add(r); }
  return g;
}

function makeGillNet() {
  const root = new THREE.Group(); root.name = 'illegal monofilament net';
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4d5650, roughness: 0.92 });
  const netMat = new THREE.LineBasicMaterial({ color: 0xaab4aa, transparent: true, opacity: 0.46, depthWrite: false });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 22, 6), ropeMat);
  top.rotation.z = Math.PI / 2; top.position.y = 0.04; root.add(top);
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 22, 5), ropeMat);
  lead.rotation.z = Math.PI / 2; lead.position.y = -1.3; root.add(lead);

  const points = [];
  for (let i = 0; i <= 22; i++) {
    const x = -11 + i;
    points.push(x, 0.02, 0, x, -1.3, 0);
  }
  for (let i = 1; i < 7; i++) {
    const y = -i * 0.185;
    points.push(-11, y, 0, 11, y, 0);
  }
  const netGeo = new THREE.BufferGeometry(); netGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const net = new THREE.LineSegments(netGeo, netMat); net.renderOrder = 3; root.add(net);

  const floatGeo = new THREE.SphereGeometry(0.17, 9, 7);
  const floatMat = new THREE.MeshStandardMaterial({ color: 0xf0e7cf, roughness: 0.72, emissive: 0x21180b, emissiveIntensity: 0.16 });
  const floats = new THREE.InstancedMesh(floatGeo, floatMat, 12), matrix = new THREE.Matrix4(), color = new THREE.Color();
  for (let i = 0; i < 12; i++) {
    matrix.makeScale(i % 4 === 0 ? 1.18 : 0.9, 0.72, i % 4 === 0 ? 1.18 : 0.9); matrix.setPosition(-10.5 + i * 1.91, 0.1, 0); floats.setMatrixAt(i, matrix);
    floats.setColorAt(i, color.setHex(i === 2 || i === 9 ? 0xe9682e : i % 3 === 0 ? 0xd6c34d : 0xe8e4d7));
  }
  floats.instanceMatrix.needsUpdate = true; floats.instanceColor.needsUpdate = true; floats.castShadow = true; root.add(floats);

  const fishBody = new THREE.SphereGeometry(0.32, 8, 6), fishTail = new THREE.ConeGeometry(0.2, 0.38, 3);
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x788b87, roughness: 0.72, metalness: 0.12 });
  for (const [x, y, yaw] of [[-3.2, -0.48, 0.25], [4.4, -0.86, -0.4]]) {
    const fish = new THREE.Group(), body = new THREE.Mesh(fishBody, fishMat), tail = new THREE.Mesh(fishTail, fishMat);
    body.scale.set(1.45, 0.42, 0.68); tail.rotation.z = Math.PI / 2; tail.position.x = 0.55; fish.add(body, tail);
    fish.position.set(x, y, -0.03); fish.rotation.y = yaw; root.add(fish);
  }
  root.visible = false; root.userData.net = net; root.userData.floats = floats;
  return root;
}

function makeEngineFire() {
  const group = new THREE.Group(); group.name = 'outboard fire'; group.visible = false;
  const geometry = new THREE.ConeGeometry(0.22, 1.15, 7, 2, true); geometry.translate(0, 0.575, 0);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4b12, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const outer = new THREE.InstancedMesh(geometry, outerMaterial, 5), core = new THREE.InstancedMesh(geometry, coreMaterial, 5);
  outer.name = 'pooled outer flames'; core.name = 'pooled flame cores'; outer.frustumCulled = core.frustumCulled = false;
  const light = new THREE.PointLight(0xff5a18, 0, 32, 2); light.position.set(0, 0.9, 0);
  group.add(outer, core, light);
  group.userData.fire = { outer, core, light, dummy: new THREE.Object3D() };
  return group;
}

function animateEngineFire(group, t, strength, flash = 0) {
  const fire = group.userData.fire, visible = strength > 0.015 || flash > 0.015;
  group.visible = visible; if (!visible) { fire.light.intensity = 0; return; }
  const d = fire.dummy, force = Math.max(strength, flash * 1.45);
  for (let i = 0; i < 5; i++) {
    const phase = t * (5.1 + i * 0.37) + i * 1.73, pulse = 0.78 + Math.sin(phase) * 0.19 + Math.sin(phase * 0.47) * 0.1;
    const x = (i - 2) * 0.16 + Math.sin(phase * 0.61) * 0.08, z = Math.cos(phase * 0.43 + i) * 0.1;
    d.position.set(x, i % 2 ? 0.04 : 0, z); d.rotation.set(Math.sin(phase * 0.53) * 0.14, phase * 0.17, Math.cos(phase * 0.41) * 0.16);
    d.scale.set((0.72 + i * 0.07) * force, pulse * (0.72 + i * 0.08) * force, (0.72 + i * 0.07) * force); d.updateMatrix(); fire.outer.setMatrixAt(i, d.matrix);
    d.position.y += 0.04; d.scale.multiplyScalar(0.52); d.updateMatrix(); fire.core.setMatrixAt(i, d.matrix);
  }
  fire.outer.instanceMatrix.needsUpdate = true; fire.core.instanceMatrix.needsUpdate = true;
  fire.outer.material.opacity = clamp(0.48 + strength * 0.34 + flash * 0.25, 0, 1);
  fire.core.material.opacity = clamp(0.64 + strength * 0.25 + flash * 0.22, 0, 1);
  fire.light.intensity = 45 * strength + 280 * flash; fire.light.distance = 22 + strength * 18 + flash * 20;
}

function makeEntangledManatee() {
  const animal = manateeMesh(); animal.name = 'entangled manatee'; animal.visible = false;
  const buoy = crabFloat(); buoy.name = 'towed crab float'; buoy.scale.setScalar(0.72); buoy.visible = false;
  const ropeGeometry = new THREE.BufferGeometry();
  ropeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
  const rope = new THREE.Line(ropeGeometry, new THREE.LineBasicMaterial({ color: 0xc49b54, transparent: true, opacity: 0.86, depthWrite: false }));
  rope.name = 'crab trap line'; rope.frustumCulled = false; rope.visible = false;
  return { animal, buoy, rope };
}

function makeGroundingRig(rr, scene) {
  const boat = buildSkiff({ crew: false }); boat.name = 'grounded working skiff'; boat.visible = false;
  recolor(boat, 0x7a6749);
  const operator = person(rr, { pose: 'stand', hat: true, vest: true });
  operator.name = 'grounded skiff operator'; operator.position.set(-0.12, 0.5, -0.52); operator.rotation.y = Math.PI; boat.add(operator);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.7, 6), new THREE.MeshStandardMaterial({ color: 0x8a7657, roughness: 1 }));
  pole.name = 'shallow-water push pole'; pole.rotation.z = Math.PI / 2; pole.rotation.y = -0.2; pole.position.set(0, 0.58, -0.15); pole.castShadow = true; boat.add(pole);
  const lamp = signalLight(boat, 0xffa52f, 0.58, 1.23, -0.54);
  scene.add(boat);

  const ropeGeometry = new THREE.BufferGeometry();
  ropeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
  const ropeMaterial = new THREE.LineBasicMaterial({ color: 0xd2b174, transparent: true, opacity: 0.9, depthWrite: false });
  const rope = new THREE.Line(ropeGeometry, ropeMaterial); rope.name = 'grounded skiff tow line'; rope.frustumCulled = false; rope.visible = false; scene.add(rope);
  return { boat, operator, pole, lamp, rope, agent: boatAgent(boat) };
}

function makeSpotlightRig(rr, boat, scene) {
  const gunner = person(rr, { pose: 'stand', hat: true, gun: true });
  gunner.name = 'unlicensed alligator gunner'; gunner.position.set(-0.44, 0.48, -0.52); gunner.rotation.y = Math.PI; gunner.visible = false; boat.add(gunner);
  const gator = gatorMesh(1.04); gator.name = 'spotlighted alligator'; gator.visible = false;
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff4428, transparent: true, opacity: 0.9, toneMapped: false });
  const eyeGeometry = new THREE.SphereGeometry(0.027, 7, 5), eyes = new THREE.Group();
  for (const x of [-0.12, 0.12]) { const eye = new THREE.Mesh(eyeGeometry, eyeMaterial); eye.position.set(x, 0.2, -0.58); eyes.add(eye); }
  eyes.visible = false; gator.add(eyes);

  const target = new THREE.Object3D(); target.name = 'spotlight target';
  const light = new THREE.SpotLight(0xffe4ae, 0, 115, 0.19, 0.62, 1.45); light.name = 'poacher spotlight'; light.position.set(0.42, 1.18, -0.72); light.target = target; boat.add(light);
  const geometry = new THREE.CircleGeometry(1, 28); geometry.rotateX(-Math.PI / 2);
  const uniforms = { uOpacity: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'precision highp float; uniform float uOpacity; varying vec2 vUv; void main(){ float r=length((vUv-.5)*2.); float a=(1.-smoothstep(.18,1.,r))*(.72+.28*cos(r*9.)); if(a<.01) discard; gl_FragColor=vec4(1.,.83,.48,a*uOpacity); }',
  });
  const pool = new THREE.Mesh(geometry, material); pool.name = 'spotlight pool'; pool.visible = false; pool.renderOrder = 43;
  scene.add(gator, target, pool);
  return { gunner, gator, eyes, target, light, pool, uniforms };
}

function boatAgent(mesh) {
  return { mesh, x: 0, z: 0, heading: 0, speed: 0, want: 0, turn: 0, targetX: 0, targetZ: 0, decisionT: 0, active: false };
}

export class EncounterDirector {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, boat, game, audio, environment, plume, spray, law, reputation
    this.next = 48; this.active = null; this.seenT = 0; this.interact = false; this.alternate = false; this.enabled = false; this.debugIndex = 0;
    this.obs = []; this.boatObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'boat' }; this.boatObs2 = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'boat' }; this.echoObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'skiff' }; this.fixedObs = { x: 0, z: 0, r: 2.1, tag: 'wreck' };
    this.netObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 0.32, tag: 'monofilament net', onHit: (into) => {
      const e = this.active; if (!e || e.type !== 'netline' || e.state === 'recovering' || e.state === 'secured' || e.hitCd > 0 || into < 1.8) return;
      e.hitCd = 3.5; e.snag = clamp((e.snag || 0) + into * 0.035, 0, 0.65);
      this.game.toast(into > 5 ? 'Monofilament across the hull' : 'Float line struck', into > 5 ? 'Back off. The net is pulling tight under the stern.' : 'There is a net stretched across the cut.', 2.8);
      if (into > 4.5) { this.audio.warn(); this.game.shake = Math.max(this.game.shake, 0.22); }
    } };
    this.fireObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'burning skiff', onHit: (into) => {
      const e = this.active; if (!e || e.type !== 'fire' || e.burned || e.hitCd > 0 || into < 2.5) return;
      e.hitCd = 2.2; e.burn = Math.min(e.limit, e.burn + into * 0.9); this.game.shake = Math.max(this.game.shake, Math.min(0.34, into * 0.035));
      this.game.toast('Contact with the burning skiff', 'The fuel tank shifted. Back off and come alongside at idle.', 2.8);
    } };
    this.groundingObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 1.05, tag: 'boat', onHit: (into) => {
      const e = this.active; if (!e || e.type !== 'grounding' || e.hitCd > 0 || into < 2.2) return;
      e.hitCd = 2.8; e.scour += into * 0.18; this.game.shake = Math.max(this.game.shake, Math.min(0.28, into * 0.03));
      this.game.toast('Contact with the grounded skiff', 'Back into the deep water and pass the line at idle.', 2.8);
    } };
    this.manateeObs = { x: 0, z: 0, r: 2.15, tag: 'entangled manatee', onHit: into => this.hitEntangledManatee(into) };
    this.manateeLineObs = { ax: 0, az: 0, bx: 0, bz: 0, r: 0.16, tag: 'crab trap line', onHit: into => this.hitManateeLine(into) };
    this.phys.addObs('encounters', this.obs);
    this.rigs = this.makeRigs(); this.agents = [this.rigs.patrol.agent, this.rigs.smuggler.agent, this.rigs.distress.echoAgent, this.rigs.grounding.agent];
    this.salvagePieces = this.rigs.salvage.drums.map((mesh, index) => ({ mesh, index, x: 0, z: 0, vx: 0, vz: 0, found: false, ruptured: false, resolved: false, hitCd: 0, sinkT: 0, ph: index * 2.3 }));
    this.drumObs = this.salvagePieces.map((q, index) => ({ x: 0, z: 0, r: 0.52, tag: 'fuel drum', onHit: (into, nx, nz) => this.hitDrum(index, into, nx, nz) }));
    this.spills = this.makeSpills();
    this.keyHandler = e => {
      if (e.code === 'KeyE' && !e.repeat) this.interact = true;
      if (e.code === 'KeyF' && !e.repeat) this.alternate = true;
      if (import.meta.env.DEV && e.code === 'F9' && !e.shiftKey && !e.repeat && this.enabled && !this.game.state) { e.preventDefault(); this.start(DEBUG_ORDER[this.debugIndex++ % DEBUG_ORDER.length], true); }
      if (import.meta.env.DEV && e.code === 'F10' && !e.repeat && this.enabled && this.active) { e.preventDefault(); this.debugApproach(); }
      if (import.meta.env.DEV && e.code === 'F11' && !e.repeat && this.enabled && this.active) {
        if (this.active.type === 'fire' && !this.active.fireOut && !this.active.burned) { e.preventDefault(); this.active.burn = this.active.limit; }
        else if (this.active.type === 'manatee') { e.preventDefault(); this.debugAdvanceManatee(); }
        else if (this.active.type === 'spotlight') { e.preventDefault(); this.debugAdvanceSpotlight(); }
        else if (this.active.type === 'grounding') { e.preventDefault(); this.debugAdvanceGrounding(); }
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    this.game.save.encounters ??= {};
    this.game.save.goodwill ??= 0;
    if (!Array.isArray(this.game.save.encounterMemory)) this.game.save.encounterMemory = [];
    else if (this.game.save.encounterMemory.length > ENCOUNTER_MEMORY_LIMIT) this.game.save.encounterMemory.splice(0, this.game.save.encounterMemory.length - ENCOUNTER_MEMORY_LIMIT);
    this.game.save.encounterMemorySeq = Math.max(0, Number(this.game.save.encounterMemorySeq) || 0);
    this.distressEcho = null;
    this._f = new THREE.Vector2(); this._r = new THREE.Vector2(); this._flow = new THREE.Vector2(); this._personBoat = { x: 0, z: 0, speed: 0 };
  }

  makeRigs() {
    const rr = mulberry32(7117);

    const distressBoat = buildSkiff({ crew: false }); distressBoat.visible = false; this.scene.add(distressBoat);
    const survivor = person(rr, { pose: 'stand', hat: true }); survivor.position.set(0, 0.5, -0.55); survivor.rotation.y = Math.PI; distressBoat.add(survivor);
    const passenger = person(rr, { pose: 'sit', hat: true, vest: true }); passenger.position.set(0.52, 1.08, -0.76); passenger.rotation.y = Math.PI; passenger.visible = false; this.boat.add(passenger);
    const flare = signalLight(distressBoat, 0xff3b20, 0, 3.2, -0.9);

    const patrolBoat = buildSkiff({ crew: true }); recolor(patrolBoat, 0x2d5c4b); patrolBoat.visible = false; this.scene.add(patrolBoat);
    const blue = signalLight(patrolBoat, 0x267cff, -0.25, 1.35, -0.2), red = signalLight(patrolBoat, 0xff2f25, 0.25, 1.35, -0.2);
    const patrol = { boat: patrolBoat, blue, red, agent: boatAgent(patrolBoat) };

    const smugglerBoat = buildSkiff({ crew: true }); recolor(smugglerBoat, 0x4b3527); smugglerBoat.visible = false; this.scene.add(smugglerBoat);
    const smuggler = { boat: smugglerBoat, agent: boatAgent(smugglerBoat), pack: makePackage() }; smuggler.pack.visible = false; this.scene.add(smuggler.pack);
    const spotlight = makeSpotlightRig(rr, smugglerBoat, this.scene);

    const salvage = { wreck: wreck(), drums: [fuelDrum(), fuelDrum(), fuelDrum()] };
    salvage.wreck.visible = false; this.scene.add(salvage.wreck);
    for (const d of salvage.drums) { d.visible = false; this.scene.add(d); }

    const netline = makeGillNet(); this.scene.add(netline);

    const fireBoat = buildSkiff({ crew: false }); fireBoat.name = 'burning fishing skiff'; fireBoat.visible = false; this.scene.add(fireBoat);
    const fireOperator = person(rr, { pose: 'stand', hat: false, vest: true }); fireOperator.position.set(-0.08, 0.5, -0.8); fireOperator.rotation.y = Math.PI; fireBoat.add(fireOperator);
    const fire = makeEngineFire(); fire.position.set(0.34, 0.52, 1.5); fireBoat.add(fire);
    const swimmer = person(rr, { pose: 'sitEdge', hat: false, vest: true }); swimmer.visible = false; this.scene.add(swimmer);
    const manatee = makeEntangledManatee(); this.scene.add(manatee.animal, manatee.buoy, manatee.rope);
    const grounding = makeGroundingRig(rr, this.scene);

    return { distress: { boat: distressBoat, survivor, passenger, flare, echoAgent: boatAgent(distressBoat) }, grounding, patrol, smuggler, salvage, netline, fire: { boat: fireBoat, operator: fireOperator, swimmer, fire }, manatee, spotlight };
  }

  spot(min = 160, max = 300, sideMax = 170) {
    const p = this.phys, f = p.forward(this._f), r = p.right(this._r);
    for (let i = 0; i < 80; i++) {
      const ahead = min + Math.random() * (max - min), side = (Math.random() - 0.5) * sideMax * 2;
      const x = p.pos.x + f.x * ahead + r.x * side, z = p.pos.y + f.y * ahead + r.y * side;
      const h = this.terrain.heightAt(x, z); if (h > -1.05 || h < -5.5) continue;
      if (this.world && this.world.blockedAt(x, z)) continue;
      return { x, z, heading: Math.atan2(-f.x, -f.y) + (Math.random() - 0.5) * 1.2 };
    }
    return null;
  }

  groundingSpot(nearby = false) {
    return findGroundingSite({
      terrain: this.terrain, isBlocked: (x, z) => Boolean(this.world?.blockedAt(x, z)), waterLevel: this.environment.waterLevel,
      deepSpot: (min, max, side) => this.spot(min, max, side), nearby,
    });
  }

  pickType() {
    const weather = this.environment.key, night = this.environment.hour < 5.5 || this.environment.hour > 20.5;
    const heat = this.law ? this.law.attention : 0;
    const runners = this.reputation ? this.reputation.score('runners') : 0, fwc = this.reputation ? this.reputation.score('fwc') : 0;
    const region = this.regions && this.regions.current ? this.regions.current.encounters : {};
    const weights = { distress: 0.24, grounding: 0.1, fire: 0.1, manatee: 0.1, spotlight: 0.08, patrol: 0.2, salvage: 0.1, smuggler: 0.1, netline: 0.07 };
    weights.patrol *= (region.law ?? 1) * (1 + heat * 1.75) * (1 + Math.max(0, -fwc) * 0.16);
    weights.smuggler *= (region.runners ?? 1) * (night ? 1.9 : 1) * (1 + Math.max(0, -runners) * 0.2);
    weights.netline *= (0.72 + (region.runners ?? 1) * 0.38) * (night ? 1.24 : 1);
    weights.distress *= region.danger ?? 1;
    const falling = clamp((-this.environment.tideRate - 0.025) / 0.24), lowWater = clamp((-this.environment.waterLevel - 0.08) / 0.3);
    weights.grounding *= (falling > 0 ? 0.72 + falling * 2.15 : lowWater * 0.75) * (0.82 + this.environment.tideRange * 0.28) * (region.danger ?? 1);
    weights.fire *= (region.danger ?? 1) * (0.82 + Math.min(1.25, (this.environment.values.wind || 0) * 0.045));
    weights.manatee *= (night ? 0.42 : 1) * (1 - clamp((this.environment.values.storm || 0) - 0.45, 0, 0.86));
    weights.spotlight *= (region.runners ?? 1) * (night ? 1.9 : 0) * (1 + Math.max(0, -runners) * 0.12) * (1 - clamp((this.environment.values.storm || 0) - 0.34, 0, 0.94));
    weights.salvage *= 0.7 + (region.danger ?? 1) * 0.45;
    if (weather === 'hurricane' || weather === 'tropical' || weather === 'thunderstorm') {
      weights.distress *= 1.8; weights.grounding *= 0.12; weights.fire *= 1.35; weights.manatee *= 0.08; weights.spotlight *= 0.04; weights.salvage *= 3.4; weights.patrol *= 0.18; weights.smuggler *= 0.12; weights.netline *= 0.28;
    } else if (weather === 'squall' || weather === 'hail') {
      weights.distress *= 1.4; weights.grounding *= 0.55; weights.fire *= 1.2; weights.manatee *= 0.35; weights.spotlight *= 0.22; weights.salvage *= 2; weights.patrol *= 0.55; weights.smuggler *= 0.45; weights.netline *= 0.62;
    }
    if (heat >= 3) weights.patrol *= 2.1;
    let roll = Math.random() * Object.values(weights).reduce((a, n) => a + n, 0);
    for (const type of ['distress', 'grounding', 'fire', 'manatee', 'spotlight', 'patrol', 'salvage', 'smuggler', 'netline']) { roll -= weights[type]; if (roll <= 0) return type; }
    return 'distress';
  }

  start(type = this.pickType(), nearby = false) {
    if (this.active) this.finish(false, true);
    const at = type === 'grounding' ? this.groundingSpot(nearby) : nearby ? this.spot(42, 62, 38) : this.spot(); if (!at) { this.next = 20; return false; }
    if (type === 'distress') this.startDistress(at);
    else if (type === 'grounding') this.startGrounding(at);
    else if (type === 'fire') this.startFire(at);
    else if (type === 'manatee') this.startManatee(at);
    else if (type === 'spotlight') this.startSpotlight(at);
    else if (type === 'patrol') this.startPatrol(at);
    else if (type === 'smuggler') this.startSmuggler(at);
    else if (type === 'netline') this.startNetline(at);
    else this.startSalvage(at);
    return true;
  }

  clearDistressEcho() {
    const R = this.rigs.distress;
    this.distressEcho = null; R.echoAgent.active = false; R.boat.visible = false; R.survivor.visible = true;
    R.flare.group.visible = false; R.flare.light.intensity = 0; R.flare.bulb.scale.setScalar(1);
  }

  departureHeading(x, z, original) {
    let best = original, bestDepth = -Infinity;
    for (let i = 0; i < 16; i++) {
      const h = original + (i ? Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 8 : 0);
      const fx = -Math.sin(h), fz = -Math.cos(h);
      const near = -this.terrain.heightAt(x + fx * 34, z + fz * 34), far = -this.terrain.heightAt(x + fx * 72, z + fz * 72);
      const depth = Math.min(near, far) - (this.world.blockedAt(x + fx * 34, z + fz * 34) ? 5 : 0);
      if (depth > bestDepth) { bestDepth = depth; best = h; }
    }
    return best;
  }

  startDistress(at) {
    this.clearDistressEcho();
    const R = this.rigs.distress; R.boat.visible = true; R.survivor.visible = true; R.passenger.visible = false;
    R.flare.group.visible = true;
    R.boat.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.05, at.z); R.boat.rotation.y = at.heading;
    wave(R.survivor);
    this.active = { type: 'distress', x: at.x, z: at.z, heading: at.heading, state: 'waiting', t: 0, hold: 0, known: false, leave: 0, recognized: Boolean(this.reputation && this.reputation.score('locals') >= 3) };
  }

  distressDrop(x, z) {
    const options = [], berth = (baseX, baseZ, name, preferred = 0) => {
      for (let i = 0; i < 16; i++) {
        const a = preferred + (i ? Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 8 : 0), r = 21 + (i % 3) * 3;
        const px = baseX + Math.cos(a) * r, pz = baseZ + Math.sin(a) * r;
        if (this.terrain.heightAt(px, pz) < -0.72 && !this.world.blockedAt(px, pz)) return { x: px, z: pz, name };
      }
      return { x: baseX, z: baseZ, name };
    };
    const nc = this.world.nearestCamp(x, z, 4200);
    if (nc) {
      const c = nc.camp, dx = c.tie.x - c.bank.x, dz = c.tie.z - c.bank.z;
      options.push(berth(c.tie.x, c.tie.z, c.name, Math.atan2(dz, dx)));
    }
    const home = this.game.dockTie;
    options.push(berth(home.x, home.z, 'tower dock', Math.atan2(home.z - z, home.x - x)));
    options.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return options[0];
  }

  boardDistress(e) {
    if (e.state !== 'waiting') return;
    const R = this.rigs.distress; e.state = 'aboard'; e.drop = this.distressDrop(e.x, e.z); e.boardedAt = e.t;
    R.survivor.visible = false; R.passenger.visible = true; this.clearPrompt(); this.audio.checkpoint();
    this.game.toast('Operator aboard', `Run him to ${e.drop.name}. Keep the front bench dry.`, 3.2);
  }

  startGrounding(at) {
    const R = this.rigs.grounding, h = at.ground ?? this.terrain.heightAt(at.x, at.z);
    R.agent.active = false; R.boat.visible = true; R.operator.visible = true; R.rope.visible = false; R.lamp.group.visible = true;
    R.boat.userData.motor.rotation.x = 0.58; R.boat.userData.motor.userData.prop.rotation.z = 0;
    wave(R.operator);
    const fx = -Math.sin(at.heading), fz = -Math.cos(at.heading), rx = -Math.cos(at.heading), rz = Math.sin(at.heading);
    const bow = this.terrain.heightAt(at.x + fx * 2, at.z + fz * 2), stern = this.terrain.heightAt(at.x - fx * 2, at.z - fz * 2);
    const right = this.terrain.heightAt(at.x + rx * 0.75, at.z + rz * 0.75), left = this.terrain.heightAt(at.x - rx * 0.75, at.z - rz * 0.75);
    this.active = {
      type: 'grounding', x: at.x, z: at.z, startX: at.x, startZ: at.z, heading: at.heading,
      clearX: at.clearX, clearZ: at.clearZ, approachX: at.approachX, approachZ: at.approachZ,
      state: 'waiting', t: 0, known: false, hitCd: 0, vx: 0, vz: 0, ropeLength: 9, strain: 0, scour: 0, lineParts: 0,
      pitch: clamp(Math.atan2(bow - stern, 4), -0.14, 0.14), roll: clamp(Math.atan2(right - left, 1.5), -0.18, 0.18),
      clearance: this.environment.waterLevel - h, falling: this.environment.tideRate < 0,
      recognized: Boolean(this.reputation && this.reputation.score('locals') >= 3),
    };
    this.updateGroundingTransform(this.active, 0, 0);
  }

  updateGroundingTransform(e, dt, t) {
    const R = this.rigs.grounding, waveY = this.water.waveHeight(e.x, e.z, t), ground = this.terrain.heightAt(e.x, e.z);
    e.clearance = this.environment.waterLevel - ground;
    const grounded = clamp((0.52 - e.clearance) / 0.44), follow = dt > 0 ? 1 - Math.exp(-dt * 3.2) : 1;
    e.pitch = lerp(e.pitch, e.pitch * grounded, follow * (1 - grounded)); e.roll = lerp(e.roll, e.roll * grounded, follow * (1 - grounded));
    R.boat.position.set(e.x, Math.max(waveY - 0.05, ground + 0.43), e.z);
    R.boat.rotation.set(e.pitch * grounded + Math.sin(t * 0.61 + e.t) * 0.012 * (1 - grounded), e.heading, e.roll * grounded + Math.sin(t * 0.77) * 0.016 * (1 - grounded), 'YXZ');
    R.boat.userData.motor.rotation.x = lerp(R.boat.userData.motor.rotation.x, e.state === 'depart' ? 0 : 0.58, follow);
    const night = this.environment.hour < 5.5 || this.environment.hour > 20.5, pulse = 0.5 + 0.5 * Math.sin(t * 4.6);
    R.lamp.light.intensity = night || this.environment.restrictedVisibility > 0.25 ? 8 + pulse * 24 : 0; R.lamp.bulb.scale.setScalar(0.75 + pulse * 0.3);
  }

  attachGroundingTow(e, force = false) {
    if (e.state !== 'waiting') return;
    const p = this.phys, pf = p.forward(this._f), sfx = -Math.sin(e.heading), sfz = -Math.cos(e.heading);
    const px = p.pos.x - pf.x * 2.6, pz = p.pos.y - pf.y * 2.6, sx = e.x - sfx * 1.85, sz = e.z - sfz * 1.85;
    const d = Math.hypot(px - sx, pz - sz); if (!force && d > 15) return;
    e.state = 'tow'; e.ropeLength = clamp(d + 0.45, 5.5, 15); e.strain = 0; this.rigs.grounding.rope.visible = true;
    this.game.wpTarget = { x: e.clearX, z: e.clearZ, label: 'deep water', color: '#7db8d8', encounter: true };
    this.clearPrompt(); this.audio.checkpoint(); this.game.toast('Stern line fast', 'Motor stays trimmed. Ease her toward blue water; F drops the line.', 3.4);
  }

  dropGroundingTow(e, parted = false) {
    if (e.state !== 'tow') return;
    e.state = 'waiting'; e.strain = 0; e.lineParts += parted ? 1 : 0; this.rigs.grounding.rope.visible = false; this.phys.towDrag = 0;
    if (this.game.wpTarget?.encounter) this.game.wpTarget = null;
    if (parted) { this.audio.warn(); this.game.shake = Math.max(this.game.shake, 0.18); }
    this.game.toast(parted ? 'Tow line parted' : 'Tow line dropped', parted ? 'Too much shock load. Come back at idle and reset it.' : 'The skiff is still pinned on the bank.', 3);
  }

  waitForGroundingFlood(e) {
    if (e.state !== 'waiting') return;
    e.state = 'secured'; e.resolveT = 5.5; this.clearPrompt();
    if (this.reputation) this.reputation.change('fwc', 0.45, 'grounding-held-for-tide', 'You kept a grounded skiff from powering across a shallow bank and relayed its position.', true);
    this.audio.checkpoint(); this.game.toast('Position and hull relayed', 'Outboard stays trimmed. The operator will hold aboard for the flood tide.', 3.5);
  }

  floatGrounding(e, assisted = true) {
    if (!['waiting', 'tow'].includes(e.state)) return;
    const R = this.rigs.grounding, dx = e.clearX - e.x, dz = e.clearZ - e.z, d = Math.hypot(dx, dz) || 1;
    e.state = 'depart'; e.departT = 7.5; e.assisted = assisted; e.cleanTow = e.scour < 1.8; R.rope.visible = false; this.phys.towDrag = 0;
    if (this.game.wpTarget?.encounter) this.game.wpTarget = null;
    const heading = Math.atan2(-dx, -dz), A = R.agent;
    Object.assign(A, { x: e.x, z: e.z, heading, speed: 0.25, want: 5.2, turn: 0, decisionT: 0, targetX: e.x + dx / d * 320, targetZ: e.z + dz / d * 320, active: true });
    R.boat.userData.motor.rotation.x = 0.18; this.audio.checkpoint();
    this.game.toast(assisted ? 'Skiff floating clear' : 'Flood tide lifted the skiff', assisted ? 'Line is off. Let the outboard open a safe gap.' : 'The operator waited it out with the motor trimmed.', 3.2);
  }

  updateGroundingRope(e, dt, t) {
    const R = this.rigs.grounding, p = this.phys, pf = p.forward(this._f), sfx = -Math.sin(e.heading), sfz = -Math.cos(e.heading);
    const px = p.pos.x - pf.x * 2.6, pz = p.pos.y - pf.y * 2.6, sx = e.x - sfx * 1.85, sz = e.z - sfz * 1.85;
    const dx = px - sx, dz = pz - sz, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d, tension = Math.max(0, d - e.ropeLength);
    const grounded = clamp((0.52 - e.clearance) / 0.44), force = tension * lerp(1.55, 0.78, grounded);
    if (tension > 0) {
      e.vx += nx * force * dt; e.vz += nz * force * dt;
      p.vel.x -= nx * tension * 0.13 * dt; p.vel.y -= nz * tension * 0.13 * dt;
    }
    e.strain = tension > 4.2 ? e.strain + (tension - 4.2) * 0.34 * dt : Math.max(0, e.strain - dt * 0.8);
    p.towDrag = Math.max(p.towDrag, 0.035 + grounded * 0.025);
    const skiffSpeed = Math.hypot(e.vx, e.vz);
    if (grounded > 0.2 && skiffSpeed > 0.55) {
      e.scour += (skiffSpeed - 0.55) * grounded * dt * 0.42;
      if (e.scour > 1.05 && !e.scourWarned) { e.scourWarned = true; this.game.toast('Mud boiling under the skiff', 'Ease off. A hard pull will carve the bank and part the line.', 3.1); }
    }
    const arr = R.rope.geometry.attributes.position.array;
    for (let i = 0; i < 18; i++) {
      const k = i / 17, x = px + (sx - px) * k, z = pz + (sz - pz) * k;
      arr[i * 3] = x; arr[i * 3 + 1] = this.water.waveHeight(x, z, t) + 0.2 - Math.sin(k * Math.PI) * Math.max(0.08, 0.3 - tension * 0.035); arr[i * 3 + 2] = z;
    }
    R.rope.geometry.attributes.position.needsUpdate = true; R.rope.material.opacity = lerp(0.76, 1, clamp(tension / 5)); R.rope.visible = true;
    if (d > e.ropeLength + 9 || e.strain > 1.35) this.dropGroundingTow(e, true);
  }

  debugAdvanceGrounding() {
    const e = this.active; if (!e || e.type !== 'grounding') return;
    if (e.state === 'waiting') { this.phys.reset(e.approachX, e.approachZ, e.heading); this.phys.y = this.water.waveHeight(e.approachX, e.approachZ, 0); this.attachGroundingTow(e, true); }
    else if (e.state === 'tow') { e.x = e.clearX; e.z = e.clearZ; e.clearance = 1; this.floatGrounding(e, true); }
    else if (e.state === 'secured') e.resolveT = 0;
    else if (e.state === 'depart') e.departT = 0;
  }

  startFire(at) {
    const R = this.rigs.fire;
    R.boat.visible = true; R.operator.visible = true; R.swimmer.visible = false; this.rigs.distress.passenger.visible = false;
    R.boat.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.05, at.z); R.boat.rotation.set(0, at.heading, 0);
    wave(R.operator); animateEngineFire(R.fire, 0, 0.72);
    this.active = {
      type: 'fire', x: at.x, z: at.z, heading: at.heading, state: 'burning', t: 0, known: false,
      burn: 0, limit: 78 + Math.random() * 14, flame: 0.72, flash: 0, sink: 0, suppression: 0, suppressing: false,
      powderCarry: 0, smokeCarry: 0, soundT: 0.4, hitCd: 0, aboard: false, overboard: false, burned: false, fireOut: false,
      swimmerX: at.x, swimmerZ: at.z, drop: null, ph: Math.random() * Math.PI * 2,
    };
  }

  boardFireOperator(e) {
    if (e.aboard) return;
    const R = this.rigs.fire; e.aboard = true; e.overboard = false; e.drop = this.distressDrop(e.x, e.z);
    R.operator.visible = false; R.swimmer.visible = false; this.rigs.distress.passenger.visible = true;
    this.phys.loaded = Math.max(this.phys.loaded, 0.32); e.state = e.fireOut ? 'contained-aboard' : e.burned ? 'rescued' : 'aboard';
    this.clearPrompt(); this.audio.checkpoint();
    this.game.toast('Operator aboard', e.fireOut ? `Fire is down. Run him to ${e.drop.name}.` : e.burned ? `He is out of the water. Run him to ${e.drop.name}.` : 'The fuel tank is still heating. Fight it or get clear.', 3.4);
  }

  containFire(e) {
    if (e.fireOut || e.burned) return;
    e.fireOut = true; e.suppressing = false; e.flame = Math.min(e.flame, 0.34); e.state = e.aboard ? 'contained-aboard' : 'contained';
    this.audio.checkpoint(); this.game.toast('Fire knocked down', e.aboard ? 'No flame at the tank. Take the operator to a safe berth.' : 'No flame at the tank. Bring the operator off the disabled skiff.', 3.4);
  }

  flashFire(e) {
    if (e.burned || e.fireOut) return;
    const R = this.rigs.fire, p = this.phys; e.burned = true; e.suppressing = false; e.flash = 1; e.flame = Math.max(e.flame, 1.2); e.sink = 0;
    const sideX = Math.cos(e.heading), sideZ = -Math.sin(e.heading);
    if (!e.aboard) {
      e.overboard = true; e.swimmerX = e.x + sideX * 2.2; e.swimmerZ = e.z + sideZ * 2.2; e.state = 'overboard';
      R.operator.visible = false; R.swimmer.visible = true; R.swimmer.position.set(e.swimmerX, this.water.waveHeight(e.swimmerX, e.swimmerZ, 0) - 0.08, e.swimmerZ);
    } else e.state = 'rescued';
    this.spawnSpill(e.x, e.z); this.audio.shot(0.9); this.audio.thud(1.15);
    const d = Math.hypot(p.pos.x - e.x, p.pos.y - e.z), shock = clamp(1 - d / 30);
    if (shock > 0) {
      const dx = p.pos.x - e.x, dz = p.pos.y - e.z, n = Math.hypot(dx, dz) || 1;
      p.vel.x += dx / n * shock * 5.5; p.vel.y += dz / n * shock * 5.5; this.game.shake = Math.max(this.game.shake, shock * 0.8);
      if (this.condition) this.condition.damage(shock * 6.5, shock * 3.2);
    }
    const fireY = this.water.waveHeight(e.x, e.z, 0) + 0.75;
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, speed = 0.7 + Math.random() * 3.8;
      this.plume.emit(e.x + Math.cos(a) * 0.5, fireY + Math.random() * 0.5, e.z + Math.sin(a) * 0.5, Math.cos(a) * speed, 1.2 + Math.random() * 3.2, Math.sin(a) * speed, 0.26 + Math.random() * 0.38, 0.32, 1.5 + Math.random(), 0.68, true);
    }
    for (let i = 0; i < 52; i++) {
      const a = Math.random() * Math.PI * 2, speed = 1 + Math.random() * 5;
      this.spray.emit(e.x + Math.cos(a) * 0.7, this.water.level + 0.08, e.z + Math.sin(a) * 0.7, Math.cos(a) * speed, 1 + Math.random() * 4.5, Math.sin(a) * speed, 0.014 + Math.random() * 0.028, 0.4 + Math.random() * 0.4, 0.68);
    }
    this.game.toast(e.aboard ? 'Fuel tank let go' : 'Fuel flash — operator overboard', e.aboard ? 'You have him. Keep clear of the burning sheen.' : 'PFD in the water off the skiff. Approach at idle.', 3.8);
  }

  emitExtinguisher(e, dt) {
    const p = this.phys, forward = p.forward(this._f); e.powderCarry += dt * 30;
    const count = Math.min(5, Math.floor(e.powderCarry)); if (!count) return; e.powderCarry -= count;
    const sx = p.pos.x + forward.x * 2.3, sz = p.pos.y + forward.y * 2.3, sy = this.water.waveHeight(sx, sz, 0) + 1.16;
    const dx = e.x - sx, dz = e.z - sz, n = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < count; i++) this.plume.emit(
      sx + (Math.random() - 0.5) * 0.22, sy + (Math.random() - 0.5) * 0.18, sz + (Math.random() - 0.5) * 0.22,
      dx / n * (6.8 + Math.random() * 1.8) + p.vel.x * 0.12, 0.35 + Math.random() * 0.55, dz / n * (6.8 + Math.random() * 1.8) + p.vel.y * 0.12,
      0.13 + Math.random() * 0.08, 0.24 + Math.random() * 0.14, 0.78 + Math.random() * 0.25, 0.78,
    );
  }

  startManatee(at) {
    const R = this.rigs.manatee, heading = at.heading + (Math.random() - 0.5) * 0.7;
    R.animal.visible = true; R.buoy.visible = true; R.rope.visible = true; R.rope.material.opacity = 0.86;
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.patrol.blue.light.intensity = 0; this.rigs.patrol.red.light.intensity = 0;
    this.active = {
      type: 'manatee', x: at.x, z: at.z, heading, navHeading: heading, speed: 0.46, state: 'waiting', t: 0, known: false,
      navT: 0, ph: Math.random() * Math.PI * 2, surfaced: false, spook: 0, warnT: 0, hitCd: 0, lineHitCd: 0,
      buoyX: at.x, buoyZ: at.z, fixX: at.x, fixZ: at.z, fixAge: 0, visualT: 0, lostT: 0,
      cutT: 0, rescueT: 0, resolveT: 0, releaseT: 0, struck: false,
    };
    this.updateManateeRig(this.active, 0, 0);
  }

  updateManateeRig(e, dt, t) {
    const R = this.rigs.manatee;
    e.spook = Math.max(0, e.spook - dt); e.warnT = Math.max(0, e.warnT - dt); e.hitCd = Math.max(0, e.hitCd - dt); e.lineHitCd = Math.max(0, e.lineHitCd - dt);
    e.navT -= dt;
    if (e.navT <= 0) {
      e.navT = 0.55 + Math.random() * 0.35; let best = e.heading, bestScore = -1e9;
      for (const da of MANATEE_PROBES) {
        const h = e.heading + da, fx = -Math.sin(h), fz = -Math.cos(h);
        const x1 = e.x + fx * 13, z1 = e.z + fz * 13, x2 = e.x + fx * 28, z2 = e.z + fz * 28;
        const d1 = -this.terrain.heightAt(x1, z1), d2 = -this.terrain.heightAt(x2, z2);
        if (d1 < 0.72 || d2 < 0.72 || d1 > 6.2 || d2 > 6.2 || this.world.blockedAt(x1, z1)) continue;
        const score = Math.min(d1, d2) - Math.abs(d1 - 2.2) * 0.16 - Math.abs(da) * 0.3 + Math.random() * 0.08;
        if (score > bestScore) { bestScore = score; best = h; }
      }
      e.navHeading = bestScore > -1e8 ? best : e.heading + Math.PI * 0.7;
    }
    const dh = Math.atan2(Math.sin(e.navHeading - e.heading), Math.cos(e.navHeading - e.heading));
    e.heading += clamp(dh, -dt * 0.48, dt * 0.48);
    const targetSpeed = e.spook > 0 ? 1.45 : e.state === 'rescue' ? 0.08 : e.state === 'released' ? 1.05 : e.state === 'struck' ? 0.8 : e.state === 'cutting' ? 0.3 : 0.48;
    e.speed += (targetSpeed - e.speed) * (1 - Math.exp(-dt * (e.spook > 0 ? 2.4 : 0.8)));
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), flow = this.currents ? this.currents.flowAt(e.x, e.z, this._flow) : null;
    e.x += (fx * e.speed + (flow ? flow.x * 0.45 : 0)) * dt; e.z += (fz * e.speed + (flow ? flow.y * 0.45 : 0)) * dt;

    const wave = this.water.waveHeight(e.x, e.z, t), breath = Math.sin(t * 0.72 + e.ph), lift = Math.max(0, breath - 0.35) * 0.24;
    R.animal.position.set(e.x, wave - 0.66 + lift - (e.spook > 0 ? 0.22 : 0), e.z);
    R.animal.rotation.set(-0.04 + Math.sin(t * 0.46 + e.ph) * 0.035, e.heading, Math.sin(t * 0.61 + e.ph) * 0.025, 'YXZ');
    const surfaced = breath > 0.78 && e.spook <= 0;
    if (surfaced && !e.surfaced && dt > 0) {
      this.audio.splash(0.18);
      for (let i = 0; i < 7; i++) this.spray.emit(e.x + (Math.random() - 0.5) * 1.2, wave + 0.04, e.z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.4, 0.35 + Math.random() * 1.2, (Math.random() - 0.5) * 1.4, 0.012 + Math.random() * 0.014, 0.3 + Math.random() * 0.25, 0.55);
    }
    e.surfaced = surfaced;

    if (R.buoy.visible) {
      const trail = 5.7 + Math.sin(t * 0.37 + e.ph) * 0.35;
      e.buoyX = e.x + Math.sin(e.heading) * trail; e.buoyZ = e.z + Math.cos(e.heading) * trail;
      const buoyY = this.water.waveHeight(e.buoyX, e.buoyZ, t) - 0.16;
      R.buoy.position.set(e.buoyX, buoyY, e.buoyZ); R.buoy.rotation.set(Math.sin(t * 1.12 + e.ph) * 0.08, e.heading, Math.cos(t * 0.83 + e.ph) * 0.1, 'YXZ');
      const sideX = Math.cos(e.heading) * 0.38, sideZ = -Math.sin(e.heading) * 0.38;
      const sx = e.x + sideX, sz = e.z + sideZ, sy = wave - 0.32, arr = R.rope.geometry.attributes.position.array;
      for (let i = 0; i < 6; i++) {
        const k = i / 5, q = i * 3; arr[q] = lerp(sx, e.buoyX, k); arr[q + 1] = lerp(sy, buoyY + 0.18, k) - Math.sin(k * Math.PI) * 0.42; arr[q + 2] = lerp(sz, e.buoyZ, k);
      }
      R.rope.geometry.attributes.position.needsUpdate = true;
    }
  }

  reportManatee(e) {
    if (!e || e.type !== 'manatee' || !['waiting', 'cutting'].includes(e.state)) return;
    const at = this.spot(135, 205, 150) || { x: e.x + 170, z: e.z + 40 }, A = this.rigs.patrol.agent;
    const heading = Math.atan2(-(e.x - at.x), -(e.z - at.z));
    Object.assign(A, { x: at.x, z: at.z, heading, speed: 5.2, want: 8, turn: 0, decisionT: 0, active: true });
    A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.set(0, heading, 0); A.mesh.visible = true;
    e.state = 'reported'; e.fixX = e.x; e.fixZ = e.z; e.fixAge = 0; e.visualT = 0; e.lostT = 0; e.cutT = 0;
    this.clearPrompt(); this.audio.checkpoint(); this.game.toast('Wildlife Alert notified', 'Keep visual, update the exact position, and do not touch the gear.', 3.5);
  }

  beginManateeCut(e) {
    if (e.state !== 'waiting') return;
    e.state = 'cutting'; e.cutT = 0; this.clearPrompt(); this.audio.warn();
    this.game.toast('Cutting the float line', 'The wrap may be embedded. FWC says leave the gear in place.', 3.2);
  }

  improperManateeCut(e) {
    const R = this.rigs.manatee; R.buoy.visible = false; R.rope.visible = false;
    e.state = 'cut'; e.resolveT = 4.8; e.spook = 9; e.navHeading = e.heading + (Math.random() < 0.5 ? -1 : 1) * 0.75;
    this.game.save.manateeBadCuts = (this.game.save.manateeBadCuts || 0) + 1;
    if (this.law) this.law.add(0.55, 'interfering with an entangled manatee', false);
    if (this.reputation) {
      this.reputation.change('fwc', -0.9, 'manatee-line-cut', 'You cut away the locator float before trained rescuers could remove the embedded wrap.', true);
      this.reputation.change('locals', -0.25, 'manatee-line-cut', 'The camps heard the entangled manatee lost its float before the rescue boat arrived.', false);
    }
    this.game.persist(); this.audio.warn(); this.game.toast('Only the float came free', 'The line is still around the flipper and the animal is now harder to find.', 3.8);
  }

  releaseManatee(e) {
    if (e.state === 'released') return;
    const R = this.rigs.manatee; R.buoy.visible = false; R.rope.visible = false; e.state = 'released'; e.releaseT = 0; e.spook = 0;
    this.game.save.manateeRescues = (this.game.save.manateeRescues || 0) + 1;
    if (this.reputation) {
      this.reputation.change('fwc', 1.45, 'manatee-rescue', 'Your location updates kept an entangled manatee in sight until trained rescuers removed the wrap.', true);
      this.reputation.change('locals', 0.45, 'manatee-rescue', 'The camps heard the tower boat held visual for a manatee rescue.', false);
    }
    if (this.law) this.law.cool(0.35);
    this.game.persist(); this.audio.checkpoint(); this.game.toast('Wrap removed', 'The flipper is clear. The biologist is releasing the animal on site.', 3.8);
  }

  hitManateeLine(into) {
    const e = this.active; if (!e || e.type !== 'manatee' || !this.rigs.manatee.rope.visible || e.lineHitCd > 0 || into < 1.4) return;
    e.lineHitCd = 2.4; e.spook = Math.max(e.spook, 5.5); e.navHeading = Math.atan2(-(e.x - this.phys.pos.x), -(e.z - this.phys.pos.y));
    if (this.condition) this.condition.damage(0.2 + Math.min(0.8, into * 0.08), 0.7 + Math.min(2.8, into * 0.25));
    this.audio.warn(); this.game.shake = Math.max(this.game.shake, Math.min(0.28, into * 0.035));
    this.game.toast('Crab line under the hull', 'Kill the throttle. The float line is pulling tight against the animal.', 3.1);
  }

  hitEntangledManatee(into) {
    const e = this.active; if (!e || e.type !== 'manatee' || e.hitCd > 0 || e.state === 'released' || e.state === 'cut' || e.state === 'struck' || into < 1.1) return;
    e.hitCd = 3; e.spook = Math.max(e.spook, 7); e.navHeading = Math.atan2(-(e.x - this.phys.pos.x), -(e.z - this.phys.pos.y));
    this.audio.thud(Math.min(1.2, 0.35 + into * 0.1)); this.game.shake = Math.max(this.game.shake, Math.min(0.58, 0.16 + into * 0.06));
    if (into < 3.4) { this.game.toast('Manatee under the chine', 'Prop to idle. Let it move clear before you turn.', 3); return; }
    if (!this.rigs.patrol.agent.active) this.reportManatee(e);
    e.state = 'struck'; e.struck = true; e.resolveT = 4.2;
    this.game.save.manateeEntanglementStrikes = (this.game.save.manateeEntanglementStrikes || 0) + 1;
    if (this.law) { this.law.stats.manateeStrikes = (this.law.stats.manateeStrikes || 0) + 1; this.law.add(1.65, 'protected manatee strike', false); }
    if (this.reputation) {
      this.reputation.change('fwc', -1.15, 'manatee-strike', 'FWC logged a strike on the entangled manatee before the rescue boat reached it.', true);
      this.reputation.change('locals', -0.4, 'manatee-strike', 'The tower hull hit the animal it was meant to protect.', false);
    }
    this.game.persist(); this.game.toast('Protected animal struck', 'Hold position. The rescue team is now responding to an injured manatee.', 3.8);
  }

  debugAdvanceManatee() {
    const e = this.active; if (!e || e.type !== 'manatee') return;
    if (e.state === 'waiting' || e.state === 'cutting') this.reportManatee(e);
    else if (e.state === 'reported') {
      const A = this.rigs.patrol.agent; Object.assign(A, { x: e.x + 10, z: e.z + 2, heading: e.heading, speed: 0.5, active: true });
      A.mesh.visible = true; e.fixX = e.x; e.fixZ = e.z; e.visualT = 10; e.lostT = 0;
    } else if (e.state === 'rescue') e.rescueT = 8.8;
  }

  startSpotlight(at) {
    const S = this.rigs.spotlight, A = this.rigs.smuggler.agent, heading = at.heading + (Math.random() - 0.5) * 0.45;
    let gatorX = at.x - Math.sin(heading) * 17, gatorZ = at.z - Math.cos(heading) * 17;
    if (this.terrain.heightAt(gatorX, gatorZ) > -0.48 || this.world.blockedAt(gatorX, gatorZ)) {
      gatorX = at.x + Math.cos(heading) * 13; gatorZ = at.z - Math.sin(heading) * 13;
    }
    Object.assign(A, { x: at.x, z: at.z, heading, speed: 0.18, want: 0, turn: 0, decisionT: 0, active: true });
    A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.set(0, heading, 0); A.mesh.visible = true;
    this.rigs.smuggler.pack.visible = false; S.gunner.visible = true; S.gator.visible = true; S.eyes.visible = false;
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.patrol.blue.light.intensity = 0; this.rigs.patrol.red.light.intensity = 0;
    this.active = {
      type: 'spotlight', state: 'waiting', x: A.x, z: A.z, heading, t: 0, known: false, ph: Math.random() * Math.PI * 2,
      gatorX, gatorZ, takeT: 27 + Math.random() * 7, resolveT: 0, chaseT: 0, visualT: 0, lostT: 0,
      fixX: A.x, fixZ: A.z, escapeX: A.x, escapeZ: A.z, choice: '', paid: 0,
    };
    this.updateSpotlightRig(this.active, 0, 0);
  }

  updateSpotlightRig(e, dt, t) {
    const S = this.rigs.spotlight, A = this.rigs.smuggler.agent;
    if (e.state === 'waiting') {
      A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, t) - 0.05, A.z);
      A.mesh.rotation.set(0, A.heading, Math.sin(t * 0.72 + e.ph) * 0.025, 'YXZ');
      if (A.mesh.userData.motor) A.mesh.userData.motor.userData.prop.rotation.z += dt * 8;
    }
    if (S.gator.visible) {
      const waveY = this.water.waveHeight(e.gatorX, e.gatorZ, t);
      S.gator.position.set(e.gatorX, waveY - 0.36 + Math.sin(t * 0.5 + e.ph) * 0.025, e.gatorZ);
      S.gator.rotation.set(0, e.heading + 0.2, Math.sin(t * 0.43 + e.ph) * 0.018, 'YXZ');
    }
    const scanning = e.state === 'waiting' && S.gator.visible;
    if (scanning) {
      const sweep = Math.sin(t * 0.63 + e.ph) * 8.5, sideX = Math.cos(e.heading), sideZ = -Math.sin(e.heading);
      const x = e.gatorX + sideX * sweep, z = e.gatorZ + sideZ * sweep, y = this.water.waveHeight(x, z, t) + 0.035;
      S.target.position.set(x, y, z); S.pool.position.set(x, y, z); S.pool.scale.set(4.3 + Math.sin(t * 1.1) * 0.25, 1, 3.4);
      S.light.intensity = 620 + Math.sin(t * 7.4) * 35; S.uniforms.uOpacity.value = 0.28; S.pool.visible = true;
      S.eyes.visible = Math.hypot(x - e.gatorX, z - e.gatorZ) < 4.1;
      if (e.known && e.takeT < 7.2) aim(S.gunner, 3.2);
    } else {
      S.light.intensity = 0; S.uniforms.uOpacity.value = 0; S.pool.visible = false; S.eyes.visible = false;
    }
    if (S.gunner.visible) animatePerson(S.gunner, t, dt, A);
  }

  setSpotlightEscape(e) {
    const A = this.rigs.smuggler.agent, dx = A.x - this.phys.pos.x, dz = A.z - this.phys.pos.y, d = Math.hypot(dx, dz);
    const vx = d > 0.1 ? dx / d : -Math.sin(A.heading), vz = d > 0.1 ? dz / d : -Math.cos(A.heading); A.heading = Math.atan2(-vx, -vz); A.active = true; A.decisionT = 0;
    e.escapeX = A.x + vx * 560; e.escapeZ = A.z + vz * 560; e.x = A.x; e.z = A.z;
  }

  reportSpotlight(e) {
    if (!e || e.type !== 'spotlight' || e.state !== 'waiting') return;
    const A = this.rigs.smuggler.agent, P = this.rigs.patrol.agent;
    const at = this.spot(105, 155, 95) || { x: this.phys.pos.x - 125, z: this.phys.pos.y - 80 };
    const heading = Math.atan2(-(A.x - at.x), -(A.z - at.z));
    Object.assign(P, { x: at.x, z: at.z, heading, speed: 5.4, want: 9, turn: 0, decisionT: 0, active: true });
    P.mesh.position.set(P.x, this.water.waveHeight(P.x, P.z, 0) - 0.05, P.z); P.mesh.rotation.set(0, heading, 0); P.mesh.visible = true;
    e.state = 'reported'; e.choice = 'fwc'; e.chaseT = 0; e.visualT = 0; e.lostT = 0; e.fixX = A.x; e.fixZ = A.z;
    this.setSpotlightEscape(e); this.rigs.spotlight.gator.visible = false; this.clearPrompt(); this.audio.checkpoint();
    this.game.toast('Hull and position relayed', 'Keep the blacked-out skiff in sight. FWC twenty-seven is coming dark.', 3.5);
  }

  warnSpotlight(e) {
    if (!e || e.type !== 'spotlight' || e.state !== 'waiting') return;
    const standing = this.reputation ? this.reputation.score('runners') : 0;
    e.state = 'warned'; e.choice = 'runners'; e.resolveT = 7.5; e.paid = standing >= 3 ? 260 : standing >= 0 ? 180 : 100;
    this.setSpotlightEscape(e); this.rigs.spotlight.gator.visible = false; this.clearPrompt();
    this.game.save.spotlightWarnings = (this.game.save.spotlightWarnings || 0) + 1;
    if (this.reputation) {
      this.reputation.change('runners', 0.9, 'spotlight-warning', 'The blackout crew remembers who warned them off the refuge cut.', true);
      this.reputation.change('fwc', -0.75, 'spotlight-warning', 'FWC heard the tower hull warn an unlicensed harvest crew.', false);
      this.reputation.change('locals', -0.3, 'spotlight-warning', 'The camps heard an untagged crew got a clean exit.', false);
    }
    this.pay(e.paid, 'Backchannel credit'); this.game.persist(); this.audio.pickup();
    this.game.toast('Warning sent on seventy-two', 'Their light went black. The skiff is leaving before twenty-seven gets a hull number.', 3.6);
  }

  spookSpotlight(e) {
    if (!e || e.type !== 'spotlight' || e.state !== 'waiting') return;
    e.state = 'spooked'; e.choice = 'spooked'; e.resolveT = 8; this.setSpotlightEscape(e); this.rigs.spotlight.gator.visible = false;
    this.game.save.spotlightCrewsSpooked = (this.game.save.spotlightCrewsSpooked || 0) + 1;
    if (this.reputation) {
      this.reputation.change('fwc', 0.18, 'spotlight-spooked', 'Your approach broke up an unlicensed alligator take.', true);
      this.reputation.change('runners', -0.45, 'spotlight-spooked', 'The blackout crew knows which hull drove through its setup.', false);
    }
    const f = this.phys.forward(this._f), x = this.phys.pos.x + f.x * 5 + (Math.random() - 0.5) * 3, z = this.phys.pos.y + f.y * 5 + (Math.random() - 0.5) * 3;
    this.audio.shot(0.55); for (let i = 0; i < 18; i++) this.spray.emit(x + (Math.random() - 0.5), this.water.waveHeight(x, z, 0) + 0.04, z + (Math.random() - 0.5), (Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 2.8, (Math.random() - 0.5) * 2.2, 0.014 + Math.random() * 0.02, 0.35 + Math.random() * 0.3, 0.58);
    this.game.persist(); this.audio.warn(); this.game.shake = Math.max(this.game.shake, 0.24);
    this.game.toast('Warning shot off the bow', 'The gator went under. The blacked-out skiff is running for the narrow water.', 3.5);
  }

  takeSpotlightGator(e) {
    if (!e || e.type !== 'spotlight' || e.state !== 'waiting') return;
    e.state = 'taken'; e.choice = 'none'; e.resolveT = 6; this.setSpotlightEscape(e); this.rigs.spotlight.gator.visible = false;
    this.game.save.untaggedAlligatorsTaken = (this.game.save.untaggedAlligatorsTaken || 0) + 1;
    const y = this.water.waveHeight(e.gatorX, e.gatorZ, 0) + 0.04;
    this.audio.shot(0.7); for (let i = 0; i < 24; i++) this.spray.emit(e.gatorX + (Math.random() - 0.5) * 1.5, y, e.gatorZ + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2.8, 0.7 + Math.random() * 2.4, (Math.random() - 0.5) * 2.8, 0.014 + Math.random() * 0.022, 0.35 + Math.random() * 0.32, 0.58);
    this.game.persist(); this.audio.warn(); this.game.toast('Single shot in the refuge cut', 'The light went out. The untagged crew is leaving with the animal.', 3.7);
  }

  seizeSpotlight(e) {
    if (e.state === 'seized') return;
    const A = this.rigs.smuggler.agent, P = this.rigs.patrol.agent;
    e.state = 'seized'; e.resolveT = 5; A.speed = 0; P.speed = 0; A.active = false; P.active = false;
    this.game.save.spotlightSeizures = (this.game.save.spotlightSeizures || 0) + 1;
    if (this.reputation) {
      this.reputation.change('fwc', 1.35, 'spotlight-seizure', 'Your moving fixes put FWC alongside an unlicensed alligator crew.', true);
      this.reputation.change('locals', 0.45, 'spotlight-seizure', 'The camps heard the closed refuge cut stayed intact.', false);
      this.reputation.change('runners', -1.1, 'spotlight-seizure', 'The backchannel tied the seized blackout skiff to your radio calls.', false);
    }
    if (this.law) this.law.cool(0.3); this.game.persist(); this.audio.checkpoint();
    this.game.toast('FWC alongside the blackout skiff', 'Long gun, no restraint line, no harvest tags. The gator stayed in the cut.', 3.8);
  }

  escapeSpotlight(e) {
    if (e.state === 'escaped') return;
    e.state = 'escaped'; e.resolveT = 4.8; this.audio.warn();
    this.game.toast('FWC lost the blacked-out skiff', 'The last moving fix went stale where the channels split.', 3.4);
  }

  debugAdvanceSpotlight() {
    const e = this.active; if (!e || e.type !== 'spotlight') return;
    if (e.state === 'waiting') this.reportSpotlight(e);
    else if (e.state === 'reported') {
      const A = this.rigs.smuggler.agent, P = this.rigs.patrol.agent;
      Object.assign(P, { x: A.x + 9, z: A.z + 2, heading: A.heading, speed: 1.2, active: true });
      P.mesh.position.set(P.x, this.water.waveHeight(P.x, P.z, 0) - 0.05, P.z); P.mesh.visible = true;
      e.visualT = 12; e.lostT = 0; e.fixX = A.x; e.fixZ = A.z;
    } else if (['warned', 'spooked', 'taken', 'seized', 'escaped'].includes(e.state)) e.resolveT = 0.1;
  }

  startPatrol(at) {
    const A = this.rigs.patrol.agent; Object.assign(A, { x: at.x, z: at.z, heading: at.heading, speed: 4, want: 8, active: true });
    A.decisionT = 0; A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.y = A.heading;
    A.mesh.visible = true;
    const goodwill = Number(this.game.save.goodwill) || 0, fwcStanding = this.reputation ? this.reputation.score('fwc') : 0;
    this.active = {
      type: 'patrol', x: at.x, z: at.z, state: 'approach', t: 0, comply: 0, warned: false, pursuit: 0, known: false,
      wanted: Boolean((this.law && this.law.attention >= 1.2) || fwcStanding <= -4), recognized: fwcStanding >= 2 || goodwill >= 4,
    };
  }

  startSmuggler(at) {
    const R = this.rigs.smuggler; R.pack.visible = true; R.pack.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) + 0.05, at.z);
    const a = at.heading + Math.PI * 0.6, A = R.agent;
    Object.assign(A, { x: at.x + Math.cos(a) * 115, z: at.z + Math.sin(a) * 115, heading: at.heading, speed: 4, want: 6, active: true });
    A.decisionT = 0; A.mesh.position.set(A.x, this.water.waveHeight(A.x, A.z, 0) - 0.05, A.z); A.mesh.rotation.y = A.heading; A.mesh.visible = true;
    const standing = this.reputation ? this.reputation.score('runners') : 0;
    this.active = { type: 'smuggler', x: at.x, z: at.z, state: 'waiting', t: 0, known: false, chase: 0, originX: at.x, originZ: at.z, trusted: standing >= 3, hostile: standing <= -3 };
  }

  makeSpills() {
    const geometry = new THREE.CircleGeometry(1, 48); geometry.rotateX(-Math.PI / 2); this.spillGeometry = geometry;
    const spills = [];
    for (let i = 0; i < SPILL_POOL_SIZE; i++) {
      const uniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uPhase: { value: i * 1.7 }, uThin: { value: 0 }, uAgitation: { value: 0 } };
      const material = new THREE.ShaderMaterial({
        name: 'fuel-sheen', uniforms, vertexShader: SPILL_VS, fragmentShader: SPILL_FS,
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `fuel-sheen-${i + 1}`; mesh.visible = false; mesh.renderOrder = 74;
      this.water.scene.add(mesh);
      spills.push({ mesh, material, uniforms, active: false, x: 0, z: 0, age: 0, maxLife: 180, startRadius: 2, targetRadius: 38, radius: 0, phase: i * 1.7, churn: 0 });
    }
    return spills;
  }

  spawnSpill(x, z) {
    let spill = null, oldest = -1;
    for (const candidate of this.spills) {
      if (!candidate.active) { spill = candidate; break; }
      const age = candidate.age / candidate.maxLife; if (age > oldest) { oldest = age; spill = candidate; }
    }
    spill.active = true; spill.x = x; spill.z = z; spill.age = 0; spill.churn = 0; spill.radius = 2.2;
    spill.startRadius = 2.2 + Math.random() * 0.8; spill.targetRadius = 34 + Math.random() * 12; spill.maxLife = 165 + Math.random() * 45; spill.phase = Math.random() * Math.PI * 2;
    spill.mesh.visible = true; spill.mesh.position.set(x, this.water.level + 0.055, z); spill.mesh.rotation.y = spill.phase;
    spill.mesh.scale.set(spill.radius * 1.18, 1, spill.radius * 0.72);
    spill.uniforms.uTime.value = 0; spill.uniforms.uAlpha.value = 0; spill.uniforms.uPhase.value = spill.phase; spill.uniforms.uThin.value = 0; spill.uniforms.uAgitation.value = 0;
    return spill;
  }

  updateSpills(dt) {
    const V = this.environment.values, wind = V.wind || 0, sea = V.sea || 0;
    for (const spill of this.spills) {
      if (!spill.active) continue;
      const playerD = Math.hypot(spill.x - this.phys.pos.x, spill.z - this.phys.pos.y);
      if (dt > 0 && playerD < spill.radius * 0.92 && this.phys.speed > 2.2) spill.churn = clamp(spill.churn + dt * this.phys.speed * 0.045);
      else spill.churn *= Math.exp(-dt * 0.18);
      const breakup = 1 + Math.max(0, wind - 3.6) * 0.035 + sea * 0.25 + spill.churn * 0.65;
      spill.age += dt * breakup;
      if (spill.age >= spill.maxLife) { spill.active = false; spill.mesh.visible = false; spill.uniforms.uAlpha.value = 0; continue; }
      if (dt > 0 && this.currents) {
        const flow = this.currents.flowAt(spill.x, spill.z, this._flow); spill.x += flow.x * dt * 0.88; spill.z += flow.y * dt * 0.88;
      }
      const spread = 1 - Math.exp(-spill.age / 7.5), life = spill.age / spill.maxLife;
      spill.radius = lerp(spill.startRadius, spill.targetRadius, spread);
      spill.mesh.position.set(spill.x, this.water.level + 0.055, spill.z); spill.mesh.rotation.y += dt * (0.002 + sea * 0.002);
      spill.mesh.scale.set(spill.radius * 1.18, 1, spill.radius * 0.72);
      spill.uniforms.uTime.value = spill.age; spill.uniforms.uAlpha.value = smooth(0, 1.4, spill.age) * (1 - smooth(0.56, 1, life));
      spill.uniforms.uThin.value = clamp(life); spill.uniforms.uAgitation.value = clamp(sea * 0.28 + spill.churn * 0.72);
    }
  }

  hitDrum(index, into, nx, nz) {
    const e = this.active, q = e && e.type === 'salvage' ? e.pieces[index] : null;
    if (!q || q.resolved || q.hitCd > 0 || into < 0.7) return;
    q.hitCd = 0.45; q.vx -= nx * into * 0.24; q.vz -= nz * into * 0.24;
    if (into < 4.2) return;
    q.ruptured = true; q.resolved = true; q.sinkT = 0; e.ruptured++; e.handled++; e.state = 'spill'; e.lastSpillX = q.x; e.lastSpillZ = q.z;
    this.spawnSpill(q.x, q.z); this.audio.splash(Math.min(1.5, into / 5)); this.audio.warn(); this.game.shake = Math.max(this.game.shake, 0.28);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, speed = 0.8 + Math.random() * 3.2;
      this.spray.emit(q.x + Math.cos(a) * 0.4, this.water.level + 0.04, q.z + Math.sin(a) * 0.4, Math.cos(a) * speed, 0.8 + Math.random() * 2.8, Math.sin(a) * speed, 0.015 + Math.random() * 0.025, 0.35 + Math.random() * 0.35, 0.65);
    }
    this.game.save.salvageRuptures = (this.game.save.salvageRuptures || 0) + 1;
    if (this.law) { this.law.stats.fuelSpills = (this.law.stats.fuelSpills || 0) + 1; this.law.add(0.6, 'fuel sheen from ruptured salvage drum', false); }
    if (this.reputation) {
      this.reputation.change('fwc', -0.65, 'fuel-spill', 'FWC logged a fuel sheen after your hull struck loose salvage.', true);
      this.reputation.change('locals', -0.25, 'fuel-spill', 'The camps heard a recovery drum split under the tower boat.', false);
    }
    this.game.persist(); this.game.toast('Fuel drum ruptured', 'Visible sheen on the water. Back clear and mark the position.', 3.4);
  }

  recoverDrum(e, q) {
    q.found = true; q.resolved = true; q.mesh.visible = false; e.found++; e.handled++;
    this.audio.pickup(); this.pay(45, `Fuel drum ${e.found} of ${e.pieces.length - e.ruptured}`);
  }

  startSalvage(at) {
    const R = this.rigs.salvage; R.wreck.visible = true; R.wreck.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) - 0.35, at.z); R.wreck.rotation.y = at.heading;
    for (let i = 0; i < this.salvagePieces.length; i++) {
      const a = at.heading + 0.8 + i * 2.1, r = 7 + i * 4, q = this.salvagePieces[i], x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      Object.assign(q, { x, z, vx: 0, vz: 0, found: false, ruptured: false, resolved: false, hitCd: 0, sinkT: 0, ph: i * 2.3 });
      q.mesh.visible = true; q.mesh.position.set(x, this.water.waveHeight(x, z, 0) - 0.1, z); q.mesh.rotation.set(1.2, a, 0.2);
    }
    this.active = { type: 'salvage', x: at.x, z: at.z, state: 'waiting', t: 0, known: false, pieces: this.salvagePieces, found: 0, ruptured: 0, handled: 0, resolveT: 0, lastSpillX: at.x, lastSpillZ: at.z, ph: Math.random() * 6 };
  }

  startNetline(at) {
    const R = this.rigs.netline, rx = Math.cos(at.heading), rz = -Math.sin(at.heading), half = 11;
    R.visible = true; R.position.set(at.x, this.water.waveHeight(at.x, at.z, 0) + 0.02, at.z); R.rotation.set(0, at.heading, 0); R.scale.set(1, 1, 1);
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.smuggler.boat.visible = false; this.rigs.smuggler.agent.active = false; this.rigs.smuggler.pack.visible = false;
    this.active = {
      type: 'netline', x: at.x, z: at.z, heading: at.heading, state: 'waiting', t: 0, known: false, choice: '',
      recoveryT: 0, resolveT: 0, hitCd: 0, snag: 0, ax: at.x - rx * half, az: at.z - rz * half, bx: at.x + rx * half, bz: at.z + rz * half,
    };
  }

  debugApproach() {
    const e = this.active, p = this.phys; if (!e) return;
    let target = e;
    if (e.type === 'grounding') target = { x: e.approachX, z: e.approachZ };
    if (e.type === 'patrol') target = this.rigs.patrol.agent;
    else if (e.type === 'spotlight') target = this.rigs.smuggler.agent;
    else if (e.type === 'smuggler' && e.state === 'chase') target = this.rigs.smuggler.agent;
    else if (e.type === 'salvage') target = e.pieces.find(q => !q.resolved) || e;
    else if (e.type === 'fire' && e.aboard && (e.fireOut || e.burned) && e.drop) target = e.drop;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.y, d = Math.hypot(dx, dz) || 1;
    const gap = e.type === 'patrol' ? 18 : e.type === 'distress' ? 9 : e.type === 'fire' ? (e.aboard && (e.fireOut || e.burned) ? 8 : e.overboard ? 5 : 11) : e.type === 'manatee' ? (e.state === 'cutting' ? 5.5 : 19) : e.type === 'spotlight' ? 38 : e.type === 'smuggler' && e.state === 'waiting' ? 5 : e.type === 'netline' ? 15 : 0;
    const x = target.x - dx / d * gap, z = target.z - dz / d * gap;
    p.reset(x, z, p.heading); p.y = this.water.waveHeight(x, z, 0);
  }

  setPrompt(text, key = 'E') {
    if (this.game.dockCamp) return;
    this.game.el.prompt.innerHTML = `<b>${key}</b> ${text}`; this.game.el.prompt.classList.add('on'); this.prompting = true;
  }
  clearPrompt() { if (this.prompting && !this.game.dockCamp) this.game.el.prompt.classList.remove('on'); this.prompting = false; }

  point(x, z, label, color) {
    this.game.wpTarget = { x, z, label, color, encounter: true };
    this.game.el.wp.innerHTML = `${label} <b>${fmtDist(this.game.dist(x, z))}</b>`;
  }

  known(e, title, line) {
    if (e.known) return; e.known = true; this.audio.horn(0.18); this.game.toast(title, line, 3.2);
  }

  pay(amount, text) {
    this.game.addCash(amount); this.game.bountyToast(`${text} <b>${amount >= 0 ? '+' : '-'}$${Math.abs(amount)}</b>`);
  }
  goodwill(n, deed = 'People around the camps remember what you did.') {
    if (this.reputation) this.reputation.change('locals', n, 'bayou-help', deed, true);
    else { this.game.save.goodwill += n; this.game.persist(); }
  }

  remember(outcome, place = '') {
    if (!outcome) return null;
    const save = this.game.save, log = save.encounterMemory;
    const id = ++save.encounterMemorySeq;
    const entry = { id, type: this.active?.type || '', outcome, place, day: this.environment.day, hour: Math.round(this.environment.hour * 10) / 10, followed: false };
    log.push(entry); if (log.length > ENCOUNTER_MEMORY_LIMIT) log.splice(0, log.length - ENCOUNTER_MEMORY_LIMIT);
    return entry;
  }

  complete(title, line, amount = 0, goodwill = 0, deed = '', outcome = '', place = '') {
    if (amount) this.pay(amount, title); else this.game.bountyToast(title);
    if (goodwill) this.goodwill(goodwill, deed || title);
    this.game.toast(title, line, 3.4);
    const type = this.active.type; this.game.save.encounters[type] = (this.game.save.encounters[type] || 0) + 1; this.remember(outcome, place); this.game.persist();
    this.finish(true);
  }

  beginDistressEcho(e) {
    if (e.type !== 'distress' || (e.state !== 'repair' && e.state !== 'aboard')) return false;
    const R = this.rigs.distress, mode = e.state === 'repair' ? 'depart' : 'adrift';
    const heading = mode === 'depart' ? this.departureHeading(e.x, e.z, e.heading) : e.heading;
    this.distressEcho = { mode, x: e.x, z: e.z, heading, t: mode === 'depart' ? 34 : 80, ph: e.t || 0 };
    R.boat.position.set(e.x, this.water.waveHeight(e.x, e.z, 0) - 0.05, e.z); R.boat.rotation.set(0, heading, 0); R.boat.visible = true;
    R.survivor.visible = mode === 'depart'; R.passenger.visible = false; R.flare.group.visible = mode === 'adrift';
    const A = R.echoAgent;
    if (mode === 'depart') Object.assign(A, { x: e.x, z: e.z, heading, speed: 0.8, want: 5.4, turn: 0, decisionT: 0, targetX: e.x - Math.sin(heading) * 420, targetZ: e.z - Math.cos(heading) * 420, active: true });
    else A.active = false;
    return true;
  }

  updateDistressEcho(dt, t) {
    const E = this.distressEcho; if (!E) return;
    const R = this.rigs.distress, A = R.echoAgent; E.t -= dt;
    if (E.t <= 0) { this.clearDistressEcho(); return; }
    if (E.mode === 'depart') {
      this.updateAgent(A, dt, t, A.targetX, A.targetZ, 5.4); E.x = A.x; E.z = A.z; E.heading = A.heading;
      R.flare.group.visible = false;
    } else {
      if (this.currents) { const f = this.currents.flowAt(E.x, E.z, this._flow); E.x += f.x * dt * 0.58; E.z += f.y * dt * 0.58; }
      R.boat.position.set(E.x, this.water.waveHeight(E.x, E.z, t) - 0.05, E.z); R.boat.rotation.set(0, E.heading, Math.sin(t * 0.8 + E.ph) * 0.025, 'YXZ');
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.4); R.flare.group.visible = true; R.flare.light.intensity = 14 + pulse * 26; R.flare.bulb.scale.setScalar(0.55 + pulse * 0.45);
    }
    const d = Math.hypot(E.x - this.phys.pos.x, E.z - this.phys.pos.y); R.boat.visible = d < 650;
    if (R.survivor.visible && d < 180) { const boat = this._personBoat; boat.x = this.phys.pos.x; boat.z = this.phys.pos.y; boat.speed = this.phys.speed; animatePerson(R.survivor, t, dt, boat); }
    if (d < 70) {
      const fx = -Math.sin(E.heading), fz = -Math.cos(E.heading), o = this.echoObs;
      o.ax = E.x + fx * 2; o.az = E.z + fz * 2; o.bx = E.x - fx * 2; o.bz = E.z - fz * 2; o.tag = E.mode === 'depart' ? 'repaired skiff' : 'abandoned skiff'; this.obs.push(o);
    }
  }

  finish(success = false, silent = false) {
    const e = this.active; if (!e) return;
    this.clearPrompt(); this.obs.length = 0;
    if (e.type === 'distress') { if (!(success && this.beginDistressEcho(e))) this.clearDistressEcho(); }
    else if (!this.distressEcho) this.rigs.distress.boat.visible = false;
    this.rigs.distress.passenger.visible = false;
    this.rigs.patrol.boat.visible = false; this.rigs.patrol.agent.active = false;
    this.rigs.smuggler.boat.visible = false; this.rigs.smuggler.agent.active = false; this.rigs.smuggler.pack.visible = false;
    this.rigs.salvage.wreck.visible = false; for (const d of this.rigs.salvage.drums) d.visible = false;
    this.rigs.netline.visible = false; this.rigs.netline.scale.set(1, 1, 1); this.rigs.netline.rotation.z = 0;
    this.rigs.fire.boat.visible = false; this.rigs.fire.operator.visible = true; this.rigs.fire.swimmer.visible = false; animateEngineFire(this.rigs.fire.fire, 0, 0, 0);
    this.rigs.grounding.boat.visible = false; this.rigs.grounding.operator.visible = true; this.rigs.grounding.rope.visible = false; this.rigs.grounding.lamp.light.intensity = 0; this.rigs.grounding.agent.active = false;
    this.rigs.manatee.animal.visible = false; this.rigs.manatee.buoy.visible = false; this.rigs.manatee.rope.visible = false; this.rigs.manatee.rope.material.opacity = 0.86;
    this.rigs.spotlight.gunner.visible = false; this.rigs.spotlight.gator.visible = false; this.rigs.spotlight.eyes.visible = false; this.rigs.spotlight.light.intensity = 0; this.rigs.spotlight.pool.visible = false; this.rigs.spotlight.uniforms.uOpacity.value = 0;
    if (e.type === 'fire' && e.aboard) this.phys.loaded = 0;
    if (e.type === 'grounding') this.phys.towDrag = 0;
    if (this.law) this.law.setPursuit(false);
    if (this.game.wpTarget && this.game.wpTarget.encounter) this.game.wpTarget = null;
    this.active = null; this.next = success ? 100 + Math.random() * 110 : silent ? 60 : 75 + Math.random() * 90;
  }

  updateAgent(A, dt, t, targetX, targetZ, maxSpeed, holdRadius = 0) {
    if (!A.active) return;
    A.decisionT -= dt;
    if (A.decisionT <= 0) {
      A.decisionT = 0.1; A.targetX = targetX; A.targetZ = targetZ;
      // Three cheap probes keep pursuit boats in navigable water. Decisions run at 10 Hz; motion stays smooth at frame rate.
      let best = 0, score = -1e9;
      for (const da of STEER_PROBES) {
        const h = A.heading + da, x = A.x - Math.sin(h) * 24, z = A.z - Math.cos(h) * 24;
        const depth = -this.terrain.heightAt(x, z), toward = Math.hypot(targetX - x, targetZ - z);
        const s = Math.min(4, depth) - Math.abs(da) * 0.7 - toward * 0.006;
        if (depth > 0.55 && s > score) { score = s; best = da; }
      }
      A.choice = best;
    }
    const direct = Math.atan2(-(A.targetX - A.x), -(A.targetZ - A.z));
    let dh = Math.atan2(Math.sin(direct - A.heading), Math.cos(direct - A.heading)); dh += A.choice || 0;
    const turn = clamp(dh * 2.1, -1.35, 1.35), d = Math.hypot(A.targetX - A.x, A.targetZ - A.z);
    const want = maxSpeed * (holdRadius && d < holdRadius ? clamp(d / holdRadius, 0.05, 1) : 1) * (1 - Math.min(0.35, Math.abs(dh) * 0.22));
    A.speed += (want - A.speed) * (1 - Math.exp(-dt * (want > A.speed ? 0.7 : 2.4))); A.heading += turn * dt;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    const flow = this.currents ? this.currents.flowAt(A.x, A.z, this._flow) : null;
    A.x += (fx * A.speed + (flow ? flow.x : 0)) * dt; A.z += (fz * A.speed + (flow ? flow.y : 0)) * dt;
    const y = this.water.waveHeight(A.x, A.z, t); A.mesh.position.set(A.x, y - 0.05, A.z); A.mesh.rotation.set(A.speed * 0.005, A.heading, -turn * A.speed * 0.018, 'YXZ');
    if (A.mesh.userData.motor) { A.mesh.userData.motor.rotation.y = -turn * 0.35; A.mesh.userData.motor.userData.prop.rotation.z += dt * (6 + A.speed * 5); }
  }

  addBoatObstacle(A, tag = 'boat', slot = 0) {
    if (!A.active || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 70) return;
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);
    const o = slot ? this.boatObs2 : this.boatObs; o.ax = A.x + fx * 2; o.az = A.z + fz * 2; o.bx = A.x - fx * 2; o.bz = A.z - fz * 2; o.tag = tag; this.obs.push(o);
  }

  updateDistress(e, dt, t) {
    const R = this.rigs.distress;
    if (this.currents && e.state !== 'repair') { const f = this.currents.flowAt(e.x, e.z, this._flow); e.x += f.x * dt * 0.58; e.z += f.y * dt * 0.58; }
    const d = Math.hypot(e.x - this.phys.pos.x, e.z - this.phys.pos.y);
    R.boat.position.x = e.x; R.boat.position.z = e.z;
    R.boat.position.y = this.water.waveHeight(e.x, e.z, t) - 0.05; R.boat.rotation.z = Math.sin(t * 0.8) * 0.025;
    { const boat = this._personBoat; boat.x = this.phys.pos.x; boat.z = this.phys.pos.y; boat.speed = this.phys.speed; animatePerson(R.survivor, t, dt, boat); }
    if (R.passenger.visible) animatePerson(R.passenger, t, dt);
    if (R.survivor.userData.waveT <= 0 && d < 130) wave(R.survivor);
    const pulse = 0.5 + 0.5 * Math.sin(t * 7); R.flare.light.intensity = 50 + pulse * 95; R.flare.bulb.scale.setScalar(0.7 + pulse * 0.8);
    if (d < 120) this.known(e, 'Distress flare', e.recognized ? 'He knows the hull and is waving you in.' : 'A skiff is dead in the water ahead.');
    if (e.known && e.state !== 'aboard') this.point(e.x, e.z, 'distress flare', '#ff5a36');
    if (d < 70 && R.boat.visible) { const o = this.boatObs; o.ax = e.x - Math.sin(e.heading) * 2; o.az = e.z - Math.cos(e.heading) * 2; o.bx = e.x + Math.sin(e.heading) * 2; o.bz = e.z + Math.cos(e.heading) * 2; o.tag = 'boat'; this.obs.push(o); }
    if (e.state === 'waiting' && d < 13 && this.phys.speed * MPH < 6 && this.canInteract()) {
      this.setPrompt('hold steady for a fuel-line repair <i>· F bring the operator aboard</i>');
      if (this.interact) { e.state = 'repair'; this.clearPrompt(); this.game.toast('Hold her steady', 'He is clearing the fuel line.', 2.4); }
      else if (this.alternate) this.boardDistress(e);
    }
    if (e.state === 'repair') {
      if (d < 15 && this.phys.speed * MPH < 7) e.hold += dt; else e.hold = Math.max(0, e.hold - dt * 1.5);
      if (e.hold >= 6) { this.audio.checkpoint(); if (this.law) this.law.cool(0.2); this.complete('Stranger helped', e.recognized ? 'Motor caught. He says the camps will hear about it.' : 'Motor caught. He owes you one.', 180, 1, 'You pulled a stranded skiff clear.', 'distress-repaired'); }
    } else if (e.state === 'aboard') {
      if (d > 360) R.boat.visible = false;
      const q = e.drop, dd = Math.hypot(q.x - this.phys.pos.x, q.z - this.phys.pos.y);
      this.point(q.x, q.z, q.name, '#7be08a');
      if (dd < 13 && this.phys.speed * MPH < 5 && !this.game.dockJob && !this.game.atBoard) {
        this.setPrompt(`put the operator ashore at ${q.name}`);
        if (this.interact) {
          if (this.law) this.law.cool(0.3);
          this.complete('Safe berth reached', `${q.name} took him in. His skiff can wait for daylight.`, 275, 1.25, 'You carried a stranded operator to a safe berth.', 'distress-berth', q.name);
        }
      }
    }
  }

  updateGrounding(e, dt, t) {
    const R = this.rigs.grounding, p = this.phys; e.hitCd = Math.max(0, e.hitCd - dt);
    if (e.state === 'depart') {
      const A = R.agent; this.updateAgent(A, dt, t, A.targetX, A.targetZ, 5.2); e.x = A.x; e.z = A.z; e.heading = A.heading;
      R.boat.userData.motor.rotation.x = lerp(R.boat.userData.motor.rotation.x, 0, 1 - Math.exp(-dt * 3.4));
      { const boat = this._personBoat; boat.x = p.pos.x; boat.z = p.pos.y; boat.speed = p.speed; animatePerson(R.operator, t, dt, boat); }
      this.addBoatObstacle(A, 'departing skiff', 1); e.departT -= dt;
      if (e.departT <= 0) {
        if (!e.assisted) {
          if (e.known) this.complete('Flood tide lifted the skiff', 'The operator waited with the outboard trimmed and left without cutting the bank.', 0, 0, '', 'grounding-flood');
          else this.finish(false, true);
        } else if (e.cleanTow) {
          if (this.reputation) this.reputation.change('fwc', 0.3, 'grounding-clean-tow', 'A grounded skiff was pulled into deep water without a visible prop scar.', false);
          this.complete('Skiff recovered clean', 'Steady line, trimmed motor, no mud trench behind the hull.', 230, 0.85, 'You floated a working skiff off a falling-tide bank without chewing up the bottom.', 'grounding-towed');
        } else {
          if (this.reputation) this.reputation.change('fwc', -0.55, 'grounding-bottom-scar', 'FWC logged a fresh bottom scar behind a skiff pulled off the bank.', true);
          if (this.law) this.law.add(0.35, 'shallow-bank damage during a tow', false);
          this.complete('Skiff dragged clear', 'The hull is floating, but the hard pull left a fresh trench in the bank.', 140, 0.35, 'You got a working skiff loose with a rough tow.', 'grounding-scarred');
        }
      }
      return;
    }

    this.updateGroundingTransform(e, dt, t);
    { const boat = this._personBoat; boat.x = p.pos.x; boat.z = p.pos.y; boat.speed = p.speed; animatePerson(R.operator, t, dt, boat); }
    const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y), fx = -Math.sin(e.heading), fz = -Math.cos(e.heading);
    if (R.operator.userData.waveT <= 0 && d < 150 && e.state === 'waiting') wave(R.operator);
    if (d < 145) this.known(e, 'Skiff hard aground', e.falling ? 'Outboard is trimmed, but the ebb is still taking water off the bank.' : 'Outboard is trimmed. The operator is waiting on more water.');
    if (e.known && e.state !== 'tow') this.point(e.x, e.z, 'grounded skiff', '#f0a24d');
    if (d < 72) {
      const o = this.groundingObs; o.ax = e.x + fx * 2; o.az = e.z + fz * 2; o.bx = e.x - fx * 2; o.bz = e.z - fz * 2; this.obs.push(o);
    }

    if (e.state === 'waiting') {
      e.vx *= Math.exp(-dt * 3.5); e.vz *= Math.exp(-dt * 3.5);
      if (e.clearance > 0.58) { this.floatGrounding(e, false); return; }
      if (d < 14.5 && p.speed * MPH < 4.8 && this.canInteract()) {
        this.setPrompt('set a stern line for deep water <i>· F relay the position and wait for high tide</i>');
        if (this.interact) this.attachGroundingTow(e);
        else if (this.alternate) this.waitForGroundingFlood(e);
      }
    } else if (e.state === 'tow') {
      this.point(e.clearX, e.clearZ, 'deep water', '#7db8d8'); this.updateGroundingRope(e, dt, t);
      const grounded = clamp((0.52 - e.clearance) / 0.44), flow = this.currents ? this.currents.flowAt(e.x, e.z, this._flow) : null;
      e.vx *= Math.exp(-dt * (0.72 + grounded * 2.8)); e.vz *= Math.exp(-dt * (0.72 + grounded * 2.8));
      const nx = e.x + (e.vx + (flow ? flow.x * (1 - grounded) * 0.34 : 0)) * dt, nz = e.z + (e.vz + (flow ? flow.y * (1 - grounded) * 0.34 : 0)) * dt;
      if (!this.world?.blockedAt(nx, nz) && this.environment.waterLevel - this.terrain.heightAt(nx, nz) > 0.025) { e.x = nx; e.z = nz; }
      else { e.vx *= -0.16; e.vz *= -0.16; }
      e.clearance = this.environment.waterLevel - this.terrain.heightAt(e.x, e.z);
      if (e.state === 'tow' && (Math.hypot(e.x - e.clearX, e.z - e.clearZ) < 9 || e.clearance > 0.61)) { this.floatGrounding(e, true); return; }
      if (e.state === 'tow') this.setPrompt(`drop the tow line <i>· ${e.strain > 0.7 ? 'shock load high, ease off' : e.scour > 0.8 ? 'bottom dragging, keep it slow' : 'steady tension toward blue water'}</i>`, 'F');
    } else if (e.state === 'secured') {
      e.resolveT -= dt;
      if (e.resolveT <= 0) this.complete('Grounding response logged', 'The operator is staying with the skiff for higher water. No prop scar, no abandoned hull.', 70, 0.3, 'You stopped a grounded operator from powering across a shallow bank.', 'grounding-wait');
    }
  }

  updateFire(e, dt, t) {
    const R = this.rigs.fire, p = this.phys, V = this.environment.values;
    e.hitCd = Math.max(0, e.hitCd - dt); e.soundT -= dt; e.flash = Math.max(0, e.flash - dt * 1.7);
    if (this.currents) {
      const flow = this.currents.flowAt(e.x, e.z, this._flow); e.x += flow.x * dt * 0.46; e.z += flow.y * dt * 0.46;
      if (e.overboard) { e.swimmerX += flow.x * dt * 0.62; e.swimmerZ += flow.y * dt * 0.62; }
    }
    if (e.burned) { e.sink += dt; e.flame += ((e.sink < 5 ? 0.28 : 0) - e.flame) * (1 - Math.exp(-dt * 0.72)); }
    if (e.fireOut) { e.outT = (e.outT || 0) + dt; e.flame *= Math.exp(-dt * 2.7); }

    const sink = e.burned ? smooth(0.6, 10.5, e.sink) : 0;
    R.boat.visible = !e.burned || e.sink < 11.5;
    if (R.boat.visible) {
      R.boat.position.set(e.x, this.water.waveHeight(e.x, e.z, t) - 0.05 - sink * 1.35, e.z);
      R.boat.rotation.set(sink * 0.12, e.heading, Math.sin(t * 0.8 + e.ph) * 0.025 + sink * 0.42, 'YXZ');
    }
    const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y), mph = p.speed * MPH;
    if (R.operator.visible) {
      const boat = this._personBoat; boat.x = p.pos.x; boat.z = p.pos.y; boat.speed = p.speed; animatePerson(R.operator, t, dt, boat);
      if (R.operator.userData.waveT <= 0 && d < 135) wave(R.operator);
    }
    if (this.rigs.distress.passenger.visible) animatePerson(this.rigs.distress.passenger, t, dt);
    let rescueD = d;
    if (e.overboard) {
      rescueD = Math.hypot(e.swimmerX - p.pos.x, e.swimmerZ - p.pos.y);
      R.swimmer.position.set(e.swimmerX, this.water.waveHeight(e.swimmerX, e.swimmerZ, t) - 0.09, e.swimmerZ);
      R.swimmer.rotation.set(-0.08, e.heading + Math.PI * 0.5, Math.sin(t * 1.6 + e.ph) * 0.08, 'YXZ');
      const boat = this._personBoat; boat.x = p.pos.x; boat.z = p.pos.y; boat.speed = p.speed; animatePerson(R.swimmer, t, dt, boat);
    }

    if (d < 135) this.known(e, 'Skiff on fire', 'Flame is through the outboard cowl. One operator is trapped at the bow.');
    if (!e.aboard) {
      if (e.overboard && rescueD < 8 && mph < 5.5 && this.canInteract()) {
        this.setPrompt('pull the operator from the water'); if (this.interact) this.boardFireOperator(e);
      } else if (e.fireOut && d < 13 && mph < 6 && this.canInteract()) {
        this.setPrompt('bring the operator off the disabled skiff'); if (this.interact || this.alternate) this.boardFireOperator(e);
      } else if (!e.burned && d < 13 && mph < 6.5 && this.canInteract()) {
        this.setPrompt('lay the marine extinguisher across the stern <i>· F take the operator aboard</i>');
        if (this.interact) { e.suppressing = true; e.state = 'suppressing'; this.clearPrompt(); }
        else if (this.alternate) this.boardFireOperator(e);
      }
    } else if (!e.fireOut && !e.burned && d < 15 && mph < 7.5 && this.canInteract()) {
      this.setPrompt(e.suppressing ? 'hold alongside while the extinguisher discharges' : 'fight the stern fire <i>· or back clear</i>');
      if (this.interact) { e.suppressing = true; e.state = 'suppressing-aboard'; this.clearPrompt(); }
    }

    const canFight = !e.fireOut && !e.burned && d < 15.5 && mph < 7.5;
    if (e.suppressing) {
      if (canFight) {
        e.suppression += dt; e.burn = Math.max(0, e.burn - dt * 2.65); this.emitExtinguisher(e, dt);
      } else e.suppression = Math.max(0, e.suppression - dt * 0.7);
      if (!canFight && (d > 22 || mph > 11)) { e.suppressing = false; e.state = e.aboard ? 'aboard' : 'burning'; }
      if (e.suppression >= 6.8) this.containFire(e);
    }

    if (!e.fireOut && !e.burned) {
      const burnRate = clamp(0.78 + (V.wind || 0) * 0.036 - (V.rain || 0) * 0.2, 0.58, 1.5);
      e.burn += dt * burnRate * (e.suppressing ? 0.2 : 1);
      const target = 0.64 + clamp(e.burn / e.limit) * 0.92; e.flame += (target - e.flame) * (1 - Math.exp(-dt * 1.8));
      if (e.burn >= e.limit) this.flashFire(e);
    }

    const c = Math.cos(e.heading), s = Math.sin(e.heading), fireX = e.x + c * 0.34 + s * 1.5, fireZ = e.z - s * 0.34 + c * 1.5;
    const smokeLife = e.fireOut ? Math.max(0, 1 - (e.outT || 0) / 13) : e.burned ? Math.max(0, 1 - e.sink / 11) : 1;
    const smokeRate = smokeLife * (e.burned ? 7 : 4 + e.flame * 6);
    e.smokeCarry += dt * smokeRate; const smokeN = Math.min(6, Math.floor(e.smokeCarry)); e.smokeCarry -= smokeN;
    const wind = this.environment.windDir, windScale = Math.min(2.2, (V.wind || 0) * 0.055);
    for (let i = 0; i < smokeN; i++) this.plume.emit(
      fireX + (Math.random() - 0.5) * 0.34, this.water.waveHeight(fireX, fireZ, t) + 0.72 + Math.random() * 0.28, fireZ + (Math.random() - 0.5) * 0.34,
      (wind ? wind.x : 0) * windScale + (Math.random() - 0.5) * 0.36, 0.72 + Math.random() * 0.72, (wind ? wind.z : 0) * windScale + (Math.random() - 0.5) * 0.36,
      0.25 + Math.random() * 0.22, 0.22 + Math.random() * 0.18, 1.5 + Math.random() * 0.8, 0.48 + smokeLife * 0.35, true,
    );
    animateEngineFire(R.fire, t, R.boat.visible ? e.flame : 0, e.flash);
    if (e.soundT <= 0 && d < 120 && !e.fireOut && (e.flame > 0.1 || e.flash > 0)) {
      e.soundT = 1.05 + Math.random() * 0.65; if (this.audio.fire) this.audio.fire(0.12 + clamp(1 - d / 120) * 0.24);
    }

    if (R.boat.visible && d < 72) {
      const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), o = this.fireObs;
      o.ax = e.x + fx * 2; o.az = e.z + fz * 2; o.bx = e.x - fx * 2; o.bz = e.z - fz * 2; this.obs.push(o);
    }
    if (e.aboard && (e.fireOut || e.burned)) {
      const q = e.drop, dd = Math.hypot(q.x - p.pos.x, q.z - p.pos.y); this.point(q.x, q.z, q.name, '#7be08a');
      if (dd < 13 && mph < 5 && !this.game.dockJob && !this.game.atBoard) {
        this.setPrompt(`put the operator ashore at ${q.name}`);
        if (this.interact) {
          if (this.reputation) this.reputation.change('fwc', e.fireOut ? 1.05 : 0.75, e.fireOut ? 'boat-fire-contained' : 'boat-fire-rescue', e.fireOut ? 'You used a marine extinguisher, evacuated the operator, and kept fuel out of the cut.' : 'You pulled an operator clear of a burning skiff and brought him to safety.', true);
          if (e.burned) this.game.save.engineFireLosses = (this.game.save.engineFireLosses || 0) + 1;
          this.complete(e.fireOut ? 'Operator and skiff saved' : 'Operator brought ashore', e.fireOut ? 'The fire stayed out. A camp tow will recover the disabled skiff.' : 'He is safe. FWC is containing the sheen around what is left of the skiff.', e.fireOut ? 320 : 220, e.fireOut ? 1.25 : 1, e.fireOut ? 'You stopped an outboard fire before the fuel tank opened.' : 'You pulled a skiff operator out of a fuel fire.', e.fireOut ? 'fire-contained' : 'fire-evacuation', q.name);
          return;
        }
      }
    } else if (e.known) {
      if (e.overboard) this.point(e.swimmerX, e.swimmerZ, 'operator in the water', '#ff5a36');
      else this.point(e.x, e.z, e.fireOut ? 'disabled skiff' : 'burning skiff', e.fireOut ? '#7be08a' : '#ff5a36');
    }
  }

  updateManatee(e, dt, t) {
    const R = this.rigs.manatee, A = this.rigs.patrol.agent, p = this.phys;
    this.updateManateeRig(e, dt, t);
    const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y), mph = p.speed * MPH;
    if (d < 138) this.known(e, 'Entangled manatee', 'A manatee is towing a numbered crab float. The line is tight around a flipper.');
    if (e.known && e.state !== 'released') {
      if (e.state === 'reported' && e.lostT > 6) this.point(e.fixX, e.fixZ, 'last manatee position', '#e5c063');
      else this.point(e.x, e.z, e.state === 'struck' ? 'injured manatee' : 'entangled manatee', e.state === 'struck' ? '#ff5a36' : '#7be08a');
    }

    if (d < 88 && e.state !== 'released' && e.state !== 'cut') {
      this.manateeObs.x = e.x; this.manateeObs.z = e.z; this.obs.push(this.manateeObs);
      if (R.rope.visible) {
        this.manateeLineObs.ax = e.x; this.manateeLineObs.az = e.z; this.manateeLineObs.bx = e.buoyX; this.manateeLineObs.bz = e.buoyZ; this.obs.push(this.manateeLineObs);
      }
    }
    if (d < 18 && mph > 7 && e.state !== 'released' && e.state !== 'cut' && e.state !== 'struck') {
      e.spook = Math.max(e.spook, 5.5); e.navHeading = Math.atan2(-(e.x - p.pos.x), -(e.z - p.pos.y));
      if (e.warnT <= 0) { e.warnT = 4; this.audio.warn(); this.game.toast('Manatee diving under the wake', 'Throttle to idle and hold the last position. Do not chase it.', 3.1); }
    }

    if (e.state === 'waiting') {
      if (d < 22 && mph < 6.5 && this.canInteract()) {
        this.setPrompt('report the entanglement to FWC <i>· F cut the float line yourself</i>');
        if (this.interact) this.reportManatee(e); else if (this.alternate) this.beginManateeCut(e);
      }
      return;
    }

    if (e.state === 'cutting') {
      if (d < 7 && mph < 4.5) {
        e.cutT += dt; this.setPrompt(`hold beside the flipper while cutting <i>· ${Math.round(clamp(e.cutT / 4.5) * 100)}% · E stop and report</i>`, 'F');
      } else {
        e.cutT = Math.max(0, e.cutT - dt * 0.8); this.setPrompt(`get within 23 ft at idle to reach the float line <i>· E report instead</i>`, 'F');
      }
      if (this.interact) { this.reportManatee(e); return; }
      if (e.cutT >= 4.5) { this.improperManateeCut(e); return; }
      return;
    }

    if (A.active) {
      const blink = Math.floor(t * 2.2) % 2; this.rigs.patrol.blue.light.intensity = blink ? 54 : 3; this.rigs.patrol.red.light.intensity = blink ? 3 : 38;
    }

    if (e.state === 'reported') {
      const visual = d < 78 && mph < 11;
      e.fixAge += dt;
      if (visual) { e.fixX = e.x; e.fixZ = e.z; e.fixAge = 0; e.lostT = 0; e.visualT = Math.min(20, e.visualT + dt); }
      else { e.lostT += dt; e.visualT = Math.max(0, e.visualT - dt * 0.35); }
      const search = e.lostT > 7 ? 8 + Math.min(26, e.lostT * 0.45) : 0;
      this.updateAgent(A, dt, t, e.fixX + Math.sin(t * 0.25) * search, e.fixZ + Math.cos(t * 0.25) * search, e.lostT > 7 ? 4.6 : 8.2, e.lostT > 7 ? 12 : 7);
      this.addBoatObstacle(A, 'FWC rescue skiff');
      const rescueD = Math.hypot(A.x - e.x, A.z - e.z);
      if (visual && d > 12 && d < 75) this.setPrompt(`keep the animal in sight for the rescue skiff <i>· ${fmtDist(rescueD)}</i>`, 'VISUAL');
      if (rescueD < 15.5 && e.visualT > 4 && e.lostT < 3) { e.state = 'rescue'; e.rescueT = 0; A.speed *= 0.25; this.audio.checkpoint(); this.game.toast('Rescue skiff has visual', 'Hold outside their stern and keep your prop stopped.', 3.4); }
      return;
    }

    if (e.state === 'rescue') {
      const rescueD = Math.hypot(A.x - e.x, A.z - e.z);
      this.updateAgent(A, dt, t, e.x + Math.cos(e.heading) * 5.6, e.z - Math.sin(e.heading) * 5.6, 1.15, 8);
      this.addBoatObstacle(A, 'FWC rescue skiff');
      if (e.spook > 0 || (d < 11 && mph > 5)) {
        e.state = 'reported'; e.rescueT = 0; e.visualT = 1; e.lostT = 0; e.fixX = e.x; e.fixZ = e.z;
        this.audio.warn(); this.game.toast('Rescue approach broken off', 'Wake crossed the animal. Back out and let it surface again.', 3.2); return;
      }
      if (rescueD < 16 && d > 13) e.rescueT += dt; else e.rescueT = Math.max(0, e.rescueT - dt * 0.3);
      R.rope.material.opacity = 0.86 * (1 - smooth(5.5, 8.8, e.rescueT));
      this.setPrompt(`biologists working the wrap <i>· ${Math.round(clamp(e.rescueT / 9) * 100)}% · hold clear</i>`, 'FWC');
      if (e.rescueT >= 9) this.releaseManatee(e);
      return;
    }

    if (e.state === 'released') {
      e.releaseT += dt; this.updateAgent(A, dt, t, e.x + Math.sin(e.heading) * 220, e.z + Math.cos(e.heading) * 220, 7.6); this.addBoatObstacle(A, 'FWC rescue skiff');
      if (e.releaseT >= 5.5) { this.complete('Manatee released', 'The crab line is aboard the rescue skiff. The animal is swimming on its own.', 0, 0, '', 'manatee-rescued'); return; }
      return;
    }

    if (e.state === 'cut') {
      e.resolveT -= dt;
      if (e.resolveT <= 0) { this.complete('Locator float lost', 'FWC has the last position, but the embedded wrap is still on the animal.', 0, 0, '', 'manatee-line-cut'); return; }
      return;
    }

    if (e.state === 'struck') {
      e.resolveT -= dt; this.updateAgent(A, dt, t, e.x, e.z, 7.4, 11); this.addBoatObstacle(A, 'FWC rescue skiff');
      if (e.resolveT <= 0) { this.complete('Wildlife response inbound', 'FWC has the injured animal and the tower hull in its incident log.', 0, 0, '', 'manatee-struck'); return; }
    }
  }

  updateSpotlight(e, dt, t) {
    const A = this.rigs.smuggler.agent, P = this.rigs.patrol.agent, p = this.phys;
    let d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y), mph = p.speed * MPH;
    if (d < 155) this.known(e, 'Blacked-out spotlight crew', 'No navigation lights. A long gun is up while they sweep a closed refuge cut.');
    if (e.known && e.state !== 'seized') this.point(A.x, A.z, e.state === 'taken' ? 'untagged harvest crew' : 'blackout skiff', e.state === 'reported' ? '#5aa7ff' : '#ff8a45');

    if (e.state === 'waiting') {
      if (d < 72) this.addBoatObstacle(A, 'blackout skiff');
      if (e.known) e.takeT -= dt;
      if (d < 30 && mph > 11) { this.spookSpotlight(e); this.updateSpotlightRig(e, dt, t); return; }
      if (d < 55 && mph < 7 && this.canInteract()) {
        this.setPrompt(`report the blacked-out harvest crew <i>· F warn them on seventy-two${e.takeT < 8 ? ' · gunner lining up' : ''}</i>`);
        if (this.interact) { this.reportSpotlight(e); this.updateSpotlightRig(e, dt, t); return; }
        if (this.alternate) { this.warnSpotlight(e); this.updateSpotlightRig(e, dt, t); return; }
      }
      if (e.takeT <= 0) { this.takeSpotlightGator(e); this.updateSpotlightRig(e, dt, t); return; }
      this.updateSpotlightRig(e, dt, t); return;
    }

    if (e.state === 'reported' || e.state === 'warned' || e.state === 'spooked' || e.state === 'taken' || e.state === 'escaped') {
      this.updateAgent(A, dt, t, e.escapeX, e.escapeZ, e.state === 'reported' ? 10.4 : 11.4);
      e.x = A.x; e.z = A.z; d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y); this.addBoatObstacle(A, 'blackout skiff');
    }

    if (e.state === 'reported') {
      e.chaseT += dt; const visual = d < 195;
      if (visual) { e.fixX = A.x; e.fixZ = A.z; e.visualT = Math.min(24, e.visualT + dt); e.lostT = 0; }
      else { e.visualT = Math.max(0, e.visualT - dt * 0.3); e.lostT += dt; }
      this.updateAgent(P, dt, t, visual ? A.x : e.fixX, visual ? A.z : e.fixZ, visual ? 13.4 : 9.2, visual ? 5 : 14);
      this.addBoatObstacle(P, 'FWC twenty-seven', 1);
      const blink = Math.floor(t * 5.2) % 2; this.rigs.patrol.blue.light.intensity = blink ? 86 : 4; this.rigs.patrol.red.light.intensity = blink ? 4 : 86;
      const pd = Math.hypot(P.x - A.x, P.z - A.z);
      if (visual) this.setPrompt(`keep the blackout skiff in sight for FWC <i>· ${fmtDist(pd)} to intercept</i>`, 'VISUAL');
      else if (e.lostT > 4) this.setPrompt(`reacquire the blackout skiff <i>· last fix ${fmtDist(Math.hypot(e.fixX - p.pos.x, e.fixZ - p.pos.y))}</i>`, 'LOST');
      this.updateSpotlightRig(e, dt, t);
      if (pd < 14.5 && e.visualT > 4) { this.seizeSpotlight(e); return; }
      if (e.chaseT > 64 || (e.lostT > 16 && d > 270)) { this.escapeSpotlight(e); return; }
      return;
    }

    if (e.state === 'seized') {
      const blink = Math.floor(t * 2.4) % 2; this.rigs.patrol.blue.light.intensity = blink ? 58 : 5; this.rigs.patrol.red.light.intensity = blink ? 5 : 48;
      e.resolveT -= dt; this.updateSpotlightRig(e, dt, t);
      if (e.resolveT <= 0) { this.complete('Illegal harvest stopped', 'FWC has the blacked-out skiff, long gun and untagged gear.', 0, 0, '', 'spotlight-seized'); return; }
      return;
    }

    if (e.state === 'escaped') {
      if (P.active) { this.updateAgent(P, dt, t, e.fixX, e.fixZ, 7.8, 16); this.addBoatObstacle(P, 'FWC twenty-seven', 1); }
      e.resolveT -= dt; this.updateSpotlightRig(e, dt, t);
      if (e.resolveT <= 0) { this.complete('Blackout skiff escaped', 'FWC has the last hull description, but the channels swallowed the running lights.', 0, 0, '', 'spotlight-escaped'); return; }
      return;
    }

    e.resolveT -= dt; this.updateSpotlightRig(e, dt, t);
    if (e.resolveT > 0) return;
    if (e.state === 'warned') this.complete('Warning delivered', `The blackout crew is gone. ${e.paid ? `$${e.paid} is on your backchannel ledger.` : 'The backchannel remembers.'}`, 0, 0, '', 'spotlight-warned');
    else if (e.state === 'spooked') this.complete('Crew scattered', 'The gator stayed in the refuge cut. The warning shot is in FWC’s call log.', 0, 0, '', 'spotlight-spooked');
    else if (e.state === 'taken') this.complete('Untagged take lost', 'FWC has a shot report and no hull number. The closed cut is quiet again.', 0, 0, '', 'spotlight-taken');
  }

  updatePatrol(e, dt, t) {
    const A = this.rigs.patrol.agent, p = this.phys, d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y);
    const lead = 1.5, tx = p.pos.x + p.vel.x * lead, tz = p.pos.y + p.vel.y * lead;
    this.updateAgent(A, dt, t, tx, tz, e.state === 'pursuit' ? 11.5 : 8.4, e.state === 'check' ? 24 : 0); this.addBoatObstacle(A, 'patrol');
    const blink = Math.floor(t * 5) % 2; this.rigs.patrol.blue.light.intensity = blink ? 80 : 5; this.rigs.patrol.red.light.intensity = blink ? 5 : 80;
    if (d < 150) this.known(e, e.wanted ? 'FWC intercept' : 'FWC patrol', e.wanted ? 'They matched the hull. Idle and let them come alongside.' : 'Blue lights. They want the prop at idle.');
    if (e.known) this.point(A.x, A.z, 'FWC patrol', '#5aa7ff');
    if (e.state === 'approach' && d < 38) { e.state = 'check'; this.audio.horn(0.28); }
    if (e.state === 'check') {
      if (p.speed * MPH < 6) e.comply += dt; else e.comply = Math.max(0, e.comply - dt * 0.7);
      const goodwill = Number(this.game.save.goodwill) || 0;
      let checkTime = e.recognized ? 2.8 : goodwill <= -2 ? 6 : 4.5;
      if (this.reputation) checkTime = this.reputation.patrolCheckTime(checkTime);
      if (p.speed * MPH > (e.wanted ? 10 : 16) && d < 42) {
        e.state = 'pursuit'; e.pursuit = 24 + (this.law ? this.law.attention * 7 : 0);
        const fine = Math.round((100 + (this.law ? this.law.attention * 35 : 0)) * (this.reputation ? this.reputation.fineFactor() : 1));
        this.pay(-fine, 'FWC citation');
        if (this.law) { this.law.add(0.65, 'failure to stop', false); this.law.cited(); this.law.setPursuit(true); }
        this.game.toast('Failure to idle', 'The patrol is staying on you.', 3);
      } else if (e.comply > checkTime) {
        this.audio.checkpoint();
        if (this.law && this.law.confiscate()) {
          this.pay(-Math.round(200 * (this.reputation ? this.reputation.fineFactor() : 1)), 'Cargo seizure');
          this.complete('Cargo seized', 'FWC took the package and wrote the hull up.', 0, 0, '', 'patrol-seizure');
        } else {
          if (this.law) this.law.cleanCheck();
          this.complete('Patrol cleared you', e.recognized ? 'They know the hull. Keep it clean.' : 'Clean hull. Carry on.', 0, 0, '', 'patrol-cleared');
        }
        return;
      }
    } else if (e.state === 'pursuit') {
      if (this.law) this.law.setPursuit(true);
      e.pursuit -= dt;
      if (e.pursuit <= 0 || d > 360) {
        if (this.law) this.law.escaped();
        this.complete('Patrol broke off', 'The citation still stands. Their radio does not forget the hull.', 0, 0, '', 'patrol-escaped');
        return;
      }
    }
  }

  updateSmuggler(e, dt, t) {
    const R = this.rigs.smuggler, A = R.agent, p = this.phys;
    if (this.currents && e.state === 'waiting') { const f = this.currents.flowAt(e.x, e.z, this._flow); e.x += f.x * dt * 0.82; e.z += f.y * dt * 0.82; }
    const dp = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    if (R.pack.visible) { R.pack.position.set(e.x, this.water.waveHeight(e.x, e.z, t) + 0.08, e.z); R.pack.rotation.y += dt * 0.25; R.pack.rotation.z = Math.sin(t * 1.1) * 0.12; }
    if (e.state === 'waiting') this.updateAgent(A, dt, t, e.x + Math.sin(t * 0.12) * 45, e.z + Math.cos(t * 0.12) * 45, 5.2, 18);
    else this.updateAgent(A, dt, t, p.pos.x + p.vel.x * 0.8, p.pos.y + p.vel.y * 0.8, e.hostile ? 13.8 : 12.2, 0);
    this.addBoatObstacle(A, 'smuggler');
    if (dp < 105) this.known(e, e.hostile ? 'Backchannel bait' : 'Unmarked package', e.trusted ? 'The johnboat crew recognizes you. They are waiting for a signal.' : e.hostile ? 'They left it where this hull would find it.' : 'It was dropped in the channel. Somebody is watching it.');
    if (e.known && R.pack.visible) this.point(e.x, e.z, 'unmarked package', '#e5c063');
    if (e.state === 'waiting' && dp < 8 && p.speed * MPH < 8 && this.canInteract()) {
      this.setPrompt(`take the unmarked package <i>· F flag the johnboat</i>`);
      if (this.alternate) {
        this.clearPrompt(); R.pack.visible = false;
        if (this.reputation) this.reputation.change('runners', e.trusted ? 0.55 : 1, 'package-returned', 'You flagged the johnboat and left their package alone.', true);
        if (this.law) this.law.cool(0.2);
        this.audio.horn(0.16); this.complete('Package returned', e.trusted ? 'They nod once. The line stays open.' : 'The johnboat crew pays a finder’s cut.', e.trusted ? 140 : 90, 0, '', 'package-returned'); return;
      }
      if (this.interact) {
        this.clearPrompt(); R.pack.visible = false; e.state = 'chase'; e.chase = e.hostile ? 52 : e.trusted ? 46 : 38; this.pay(260, 'Package taken');
        if (this.reputation) {
          this.reputation.change('runners', e.trusted ? -3 : -2, 'package-stolen', e.trusted ? 'You took a package after the backchannel vouched for the hull.' : 'You took a package the backchannel was watching.', true);
          this.reputation.change('locals', -0.35, 'package-stolen', 'Word of the channel theft reached the camps.', false);
        }
        if (this.law) this.law.addContraband();
        this.audio.warn(); this.game.toast(e.hostile ? 'They were waiting for you' : 'That was not abandoned', e.hostile ? 'The johnboat was already on the throttle.' : 'The johnboat is coming for it.', 3.2);
      }
    }
    if (e.state === 'chase') {
      e.chase -= dt; const d = Math.hypot(A.x - p.pos.x, A.z - p.pos.y), run = Math.hypot(p.pos.x - e.originX, p.pos.y - e.originZ);
      this.point(A.x, A.z, 'johnboat', '#f05a36');
      if (d < 16 && !e.yelled) { e.yelled = true; this.game.toast(e.hostile ? '“Knew you would take it.”' : '“Put it back!”', 'The men in the johnboat', 2.2); }
      if (e.chase <= 0 || run > 340) this.complete('Lost the johnboat', 'The package is yours now. Whatever is in it.', 0, 0, '', 'package-taken');
    }
  }

  updateSalvage(e, dt, t) {
    const R = this.rigs.salvage, p = this.phys, d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    R.wreck.position.y = this.water.waveHeight(e.x, e.z, t) - 0.35; R.wreck.rotation.z = Math.sin(t * 0.7 + e.ph) * 0.05;
    if (d < 130) this.known(e, 'Storm wreckage', 'Fuel drums are washing away from a sunken skiff.');
    if (d < 70) { const o = this.fixedObs; o.x = e.x; o.z = e.z; o.r = 2.1; o.tag = 'wreck'; this.obs.push(o); }
    let nearest = null, nearestD = Infinity;
    for (const q of e.pieces) {
      q.hitCd = Math.max(0, q.hitCd - dt);
      if (q.found) continue;
      if (this.currents) { const f = this.currents.flowAt(q.x, q.z, this._flow); q.x += (f.x * 0.74 + q.vx) * dt; q.z += (f.y * 0.74 + q.vz) * dt; }
      else { q.x += q.vx * dt; q.z += q.vz * dt; }
      const drag = Math.exp(-dt * 0.86); q.vx *= drag; q.vz *= drag;
      if (q.ruptured) q.sinkT += dt;
      q.mesh.position.y = this.water.waveHeight(q.x, q.z, t) - 0.1 - smooth(0, 5, q.sinkT) * 0.9; q.mesh.rotation.z = 1.25 + Math.sin(t * 0.9 + q.ph) * 0.1;
      q.mesh.position.x = q.x; q.mesh.position.z = q.z;
      if (q.ruptured) { if (q.sinkT >= 5) q.mesh.visible = false; continue; }
      const qd = Math.hypot(q.x - p.pos.x, q.z - p.pos.y); if (qd < nearestD) { nearestD = qd; nearest = q; }
      if (qd < 70) { const o = this.drumObs[q.index]; o.x = q.x; o.z = q.z; this.obs.push(o); }
    }
    if (e.known) {
      if (nearest) this.point(nearest.x, nearest.z, 'loose fuel drum', '#f3ede0');
      else if (e.ruptured) this.point(e.lastSpillX, e.lastSpillZ, 'fuel sheen', '#d8b06a');
      else this.point(e.x, e.z, 'storm wreckage', '#f3ede0');
    }
    if (nearest && nearestD < 7.5 && this.canInteract()) {
      const mph = p.speed * MPH;
      if (mph < 5.5) { this.setPrompt('recover the fuel drum <i>· idle alongside</i>'); if (this.interact) this.recoverDrum(e, nearest); }
      else this.setPrompt(`ease below 5 mph for the loose drum <i>· ${Math.round(mph)} mph</i>`, 'IDLE');
    }
    if (e.handled >= e.pieces.length) {
      if (!e.ruptured) { if (this.law) this.law.cool(0.15); this.complete('Wreckage cleared', 'Three drums recovered before they split.', 140, 1, 'You cleared loose fuel drums out of the storm channel.', 'salvage-cleared'); return; }
      if (e.resolveT <= 0) e.resolveT = 4.8;
      e.resolveT -= dt;
      if (e.resolveT <= 0) {
        const line = e.found === 2 ? 'Two drums recovered. One split and the sheen was reported.' : e.found === 1 ? 'One drum recovered. Two split; the sheen was reported.' : 'All three split. The sheen was marked for response.';
        this.complete('Fuel sheen reported', line, 0, 0, '', 'salvage-spill'); return;
      }
    }
  }

  beginNetRecovery(e, choice) {
    if (e.choice) return;
    e.choice = choice; e.state = choice === 'fwc' ? 'reported' : 'tipped'; e.recoveryT = 0; this.clearPrompt();
    const A = choice === 'fwc' ? this.rigs.patrol.agent : this.rigs.smuggler.agent;
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), side = choice === 'fwc' ? 1 : -1;
    let distance = 55;
    for (let candidate = 145; candidate >= 55; candidate -= 15) {
      const sx = e.x + fx * side * candidate, sz = e.z + fz * side * candidate;
      if (this.terrain.heightAt(sx, sz) < -0.65 && !this.world.blockedAt(sx, sz)) { distance = candidate; break; }
    }
    const x = e.x + fx * side * distance, z = e.z + fz * side * distance, heading = side > 0 ? e.heading + Math.PI : e.heading;
    Object.assign(A, { x, z, heading, speed: 4.2, want: 7.5, turn: 0, decisionT: 0, active: true });
    A.mesh.position.set(x, this.water.waveHeight(x, z, 0) - 0.05, z); A.mesh.rotation.set(0, heading, 0); A.mesh.visible = true;
    if (choice === 'fwc') {
      this.audio.checkpoint(); this.game.toast('Net position reported', 'FWC says leave the monofilament in place and hold clear.', 3.2);
    } else {
      this.audio.horn(0.16); this.game.toast('Backchannel tipped', 'A dark johnboat is coming to lift the net before FWC sees it.', 3.2);
    }
  }

  resolveNetline(e) {
    if (e.state === 'secured') return;
    e.state = 'secured'; e.resolveT = 5; this.rigs.netline.visible = false;
    if (e.choice === 'fwc') {
      this.pay(240, 'FWC net recovery');
      if (this.reputation) {
        this.reputation.change('fwc', 1.1, 'illegal-net', 'You held the illegal net in place until FWC could seize it.', true);
        this.reputation.change('locals', 0.55, 'illegal-net', 'The camps heard you got a killing net out of the cut.', false);
        this.reputation.change('runners', -0.7, 'illegal-net', 'The backchannel lost a set and knows who held the scene.', false);
      }
      if (this.law) this.law.cool(0.45);
      this.game.toast('Monofilament secured', 'Twenty-seven has the net and the entangled fish aboard.', 3.4);
    } else {
      this.pay(330, 'Backchannel recovery');
      if (this.reputation) {
        this.reputation.change('runners', 1.15, 'net-warning', 'You warned the net crew before FWC reached the cut.', true);
        this.reputation.change('locals', -0.45, 'net-warning', 'The illegal set went back aboard instead of into evidence.', false);
        this.reputation.change('fwc', -0.4, 'net-warning', 'FWC logged radio traffic around a vanished illegal set.', false);
      }
      if (this.law) this.law.add(0.45, 'illegal net crew tipped off', false);
      this.game.toast('Evidence gone', 'The johnboat hauled the line and left no floats behind.', 3.4);
    }
    this.game.save.encounters.netline = (this.game.save.encounters.netline || 0) + 1;
    this.remember(e.choice === 'fwc' ? 'net-evidence' : 'net-removed'); this.game.persist();
  }

  updateNetline(e, dt, t) {
    const R = this.rigs.netline, p = this.phys, d = Math.hypot(e.x - p.pos.x, e.z - p.pos.y);
    e.hitCd = Math.max(0, e.hitCd - dt);
    R.position.y = this.water.waveHeight(e.x, e.z, t) + 0.02; R.rotation.z = Math.sin(t * 0.68 + e.heading) * (0.004 + this.environment.values.sea * 0.006);
    R.userData.net.material.opacity = 0.46 - e.snag * 0.18;
    if (d < 125) this.known(e, 'Illegal gill net', 'A monofilament wall is hanging from the float line. Fish are still hitting it.');
    if (e.known && e.state !== 'secured') this.point(e.x, e.z, 'illegal gill net', '#f06c38');

    if (e.state !== 'recovering' && e.state !== 'secured') {
      Object.assign(this.netObs, { ax: e.ax, az: e.az, bx: e.bx, bz: e.bz }); this.obs.push(this.netObs);
    }
    if (e.state === 'waiting') {
      if (d < 17 && p.speed * MPH < 7 && this.canInteract()) {
        this.setPrompt('report the illegal net to FWC <i>· F warn the crew on CH 72</i>');
        if (this.interact) this.beginNetRecovery(e, 'fwc'); else if (this.alternate) this.beginNetRecovery(e, 'runners');
      }
      return;
    }

    const A = e.choice === 'fwc' ? this.rigs.patrol.agent : this.rigs.smuggler.agent;
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading), side = e.choice === 'fwc' ? 1 : -1;
    if (e.state === 'reported' || e.state === 'tipped') {
      const tx = e.x + fx * side * 14, tz = e.z + fz * side * 14;
      this.updateAgent(A, dt, t, tx, tz, e.choice === 'fwc' ? 8.7 : 9.6, 5);
      if (Math.hypot(A.x - tx, A.z - tz) < 7.5) { e.state = 'recovering'; e.recoveryT = 0; A.speed *= 0.2; }
    } else if (e.state === 'recovering') {
      e.recoveryT += dt; const tx = e.x + fx * side * 12, tz = e.z + fz * side * 12;
      this.updateAgent(A, dt, t, tx, tz, 1.2, 5);
      const k = clamp(e.recoveryT / 7); R.scale.x = Math.max(0.035, 1 - k * k * (3 - 2 * k));
      if (e.recoveryT >= 7) this.resolveNetline(e);
    } else if (e.state === 'secured') {
      e.resolveT -= dt; this.updateAgent(A, dt, t, e.x - fx * side * 240, e.z - fz * side * 240, e.choice === 'fwc' ? 7.8 : 10.2);
      if (e.resolveT <= 0) { this.finish(true); return; }
    }
    if (e.choice === 'fwc') {
      const blink = Math.floor(t * 5.2) % 2; this.rigs.patrol.blue.light.intensity = blink ? 86 : 4; this.rigs.patrol.red.light.intensity = blink ? 4 : 86;
    }
    this.addBoatObstacle(A, e.choice === 'fwc' ? 'patrol' : 'net crew');
  }

  canInteract() { return !this.game.dockCamp && !this.game.dockJob && !this.game.atBoard; }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.obs.length = 0;
    this.updateSpills(this.game.paused ? 0 : dt);
    if (!enabled) { if (this.distressEcho) this.clearDistressEcho(); this.interact = false; this.alternate = false; return; }
    if (this.game.state) { if (this.active) this.finish(false, true); if (this.distressEcho) this.clearDistressEcho(); this.interact = false; this.alternate = false; return; }
    if (this.game.paused) { this.interact = false; this.alternate = false; return; }
    this.updateDistressEcho(dt, t);
    if (!this.active) { this.next -= dt; if (this.next <= 0) this.start(); this.interact = false; this.alternate = false; return; }
    const e = this.active; e.t += dt; this.clearPrompt();
    if (e.type === 'distress') this.updateDistress(e, dt, t);
    else if (e.type === 'grounding') this.updateGrounding(e, dt, t);
    else if (e.type === 'fire') this.updateFire(e, dt, t);
    else if (e.type === 'manatee') this.updateManatee(e, dt, t);
    else if (e.type === 'spotlight') this.updateSpotlight(e, dt, t);
    else if (e.type === 'patrol') this.updatePatrol(e, dt, t);
    else if (e.type === 'smuggler') this.updateSmuggler(e, dt, t);
    else if (e.type === 'netline') this.updateNetline(e, dt, t);
    else this.updateSalvage(e, dt, t);
    const carryingDistress = e.type === 'distress' && e.state === 'aboard', carryingFire = e.type === 'fire' && e.aboard;
    const focus = e.type === 'patrol' ? this.rigs.patrol.agent : e.type === 'spotlight' || (e.type === 'smuggler' && e.state === 'chase') ? this.rigs.smuggler.agent : e;
    if (this.active && ((!carryingDistress && !carryingFire && (e.t > 260 || Math.hypot(focus.x - this.phys.pos.x, focus.z - this.phys.pos.y) > 720)) || ((carryingDistress || carryingFire) && e.t > 600))) this.finish(false);
    this.interact = false; this.alternate = false;
  }

  stamps(out) {
    for (const A of this.agents) {
      if (!A.active || A.speed < 2 || Math.hypot(A.x - this.phys.pos.x, A.z - this.phys.pos.y) > 85) continue;
      const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading), sp = Math.min(1, A.speed / 11);
      out.push({ x: A.x - fx * 1.8, z: A.z - fz * 1.8, radius: 1.1, height: 0.5 * sp, foam: 1.6 * sp, foamRadius: 1 });
      out.push({ x: A.x + fx * 1.8, z: A.z + fz * 1.8, radius: 1, height: -0.65 * sp, foam: 0.1 * sp, foamRadius: 0.7 });
    }
  }
}
