import * as THREE from 'three';
import { RESIDENT_ROUTINE } from './residentroutines.js';

// The people of the bayou. A jointed figure (two-segment arms and legs, spine, head) driven by a pose-target system:
// every frame a target pose is assembled from the figure's base pose (stand / sit / sitEdge / crouch), the thing it is
// currently doing (holding a rod, drinking, scratching its head, walking a stretch of bank, reeling in, chatting to a
// mate, shouldering a gun...) and what is going on around it (a boat idling past gets a wave and a long look), and the
// joints ease toward it. Nobody stands bolt upright with their arms at their sides.

const M = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const SKIN = [0xb08262, 0x7d5236, 0xcf9f7e, 0x5e3d2a, 0xbd8a66, 0x9c6b4c].map(c => M(c, 0.85));
const SHIRT = [0xc4bda8, 0x2d4664, 0x62704a, 0x8f8f86, 0xdedbd0, 0x6e3a32, 0x36363a, 0x557a96, 0xa89f8e, 0x435a3a, 0x8c6e4a, 0x9c9fa8].map(c => M(c));
const PANTS = [0x2a2926, 0x394758, 0x66593f, 0x474b3a, 0x827a68, 0x2f3a4c].map(c => M(c));
const HAT = [0xcbbd9a, 0x333333, 0xa6392a, 0x46523a, 0xdad2bc, 0x2d4664, 0x6b5a44].map(c => M(c));
const HAIR = [0x2a2118, 0x4a3524, 0x8a8478, 0x1a1512, 0x6a4a30].map(c => M(c, 0.95));
const WADER = M(0x3a4632, 0.7);
const VEST = [M(0x9a3c1e, 0.8), M(0x8a2a22, 0.8), M(0x9a7a1e, 0.8)];
const ROD = M(0x2a2a2a, 0.6);
const LINE = new THREE.MeshBasicMaterial({ color: 0xe8e4da, transparent: true, opacity: 0.55 });
const PLASTIC = M(0xe8e4da, 0.6);
const BLUE = M(0x3c6aa3, 0.6);
const GUN = new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.7, metalness: 0.3 });
const WOOD = M(0x8a6a48);
const CAN = [new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.4, metalness: 0.5 })];
const SHADES = M(0x101010, 0.3);
const sh = (o) => { o.castShadow = true; return o; };
const pick = (rr, arr) => arr[Math.floor(rr() * arr.length)];
const lerp = (a, b, k) => a + (b - a) * k;
const PERSON_GEOMETRIES = new Map();
const personGeometry = (key, create) => {
  let geometry = PERSON_GEOMETRIES.get(key);
  if (!geometry) { geometry = create(); PERSON_GEOMETRIES.set(key, geometry); }
  return geometry;
};

// a limb segment: a group pivoting at the joint with the capsule hanging down -y from it
function seg(len, r, mat) {
  const g = new THREE.Group();
  const geo = personGeometry(`segment:${len}:${r}`, () => new THREE.CapsuleGeometry(r, len - r * 2, 3, 7));
  const c = new THREE.Mesh(geo, mat); c.position.y = -len / 2; g.add(sh(c));
  return g;
}

// base poses. Channels: hy hips height, hx weight shift, hRx/hRy/hRz hips, sx/sy/sz spine, hdx/hdy head,
// lf/lo/le left arm forward/out/elbow, rf/ro/re right arm, ltf/lto/lk left leg forward/out/knee, rtf/rto/rk, rod tip-up.
const HIP_Y = { stand: 0.84, sit: 0.47, sitEdge: 0.06, crouch: 0.45 };
const BASE = {
  stand: { hy: 0.84, sx: 0.06, lf: 0.2, lo: 0.14, le: 0.55, rf: 0.2, ro: 0.14, re: 0.55, ltf: 0, lto: 0.1, lk: 0.08, rtf: 0, rto: 0.1, rk: 0.08 },
  sit: { hy: 0.47, sx: 0.12, lf: 0.75, lo: 0.08, le: 0.85, rf: 0.75, ro: 0.08, re: 0.85, ltf: 1.47, lto: 0.12, lk: 1.35, rtf: 1.47, rto: 0.12, rk: 1.35 },
  sitEdge: { hy: 0.06, sx: 0.18, lf: 0.8, lo: 0.08, le: 0.9, rf: 0.8, ro: 0.08, re: 0.9, ltf: 1.47, lto: 0.1, lk: 1.85, rtf: 1.47, rto: 0.1, rk: 1.85 },
  crouch: { hy: 0.45, sx: 0.45, lf: 0.9, lo: 0.1, le: 0.8, rf: 0.9, ro: 0.1, re: 0.8, ltf: 1.2, lto: 0.18, lk: 1.94, rtf: 1.2, rto: 0.18, rk: 1.94 },
};
const ZERO = { hy: 0, hx: 0, hRx: 0, hRy: 0, hRz: 0, sx: 0, sy: 0, sz: 0, hdx: 0, hdy: 0, lf: 0, lo: 0, le: 0, rf: 0, ro: 0, re: 0, ltf: 0, lto: 0, lk: 0, rtf: 0, rto: 0, rk: 0, rod: 0.3 };
const CHANNELS = Object.keys(ZERO);

// pose: 'stand' | 'sit' (on a 0.45 m seat) | 'sitEdge' (on the ground/deck, legs over the edge) | 'crouch'
// rod: a rod in the right hand; gun: a shotgun; drive: a hand on a wheel; waders: chest waders; vest: a life jacket
export function person(rr, { pose = 'stand', rod = false, hat = true, gun = false, drive = false, waders = false, vest = false } = {}) {
  const g = new THREE.Group();
  const skin = pick(rr, SKIN), shirt = pick(rr, SHIRT), pants = waders ? WADER : pick(rr, PANTS), hair = pick(rr, HAIR);
  const shorts = !waders && pose !== 'crouch' && rr() < 0.3;
  const hips = new THREE.Group(); hips.position.y = HIP_Y[pose]; g.add(hips);
  const pelvis = new THREE.Mesh(personGeometry('pelvis', () => new THREE.CylinderGeometry(0.15, 0.175, 0.2, 12)), pants); pelvis.position.y = 0.05; hips.add(sh(pelvis));
  const spine = new THREE.Group(); spine.position.y = 0.1; hips.add(spine);
  const torso = new THREE.Mesh(personGeometry('torso', () => new THREE.CapsuleGeometry(0.16, 0.26, 4, 10)), shirt); torso.position.y = 0.28; spine.add(sh(torso));
  const shoulders = new THREE.Mesh(personGeometry('shoulders', () => new THREE.SphereGeometry(0.17, 12, 8)), shirt); shoulders.scale.set(1.45, 0.5, 0.85); shoulders.position.y = 0.5; spine.add(sh(shoulders));
  if (waders) { const bib = new THREE.Mesh(personGeometry('wader-bib', () => new THREE.BoxGeometry(0.3, 0.34, 0.12)), WADER); bib.position.set(0, 0.22, 0.12); spine.add(sh(bib)); const belt = new THREE.Mesh(personGeometry('belt', () => new THREE.CylinderGeometry(0.175, 0.175, 0.04, 12)), GUN); belt.position.y = 0.06; spine.add(belt); }
  if (vest) { const v = new THREE.Mesh(personGeometry('vest', () => new THREE.BoxGeometry(0.38, 0.34, 0.3)), pick(rr, VEST)); v.position.y = 0.3; spine.add(sh(v)); }
  const neck = new THREE.Mesh(personGeometry('neck', () => new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)), skin); neck.position.y = 0.6; spine.add(neck);
  const headG = new THREE.Group(); headG.position.y = 0.63; spine.add(headG);
  const head = new THREE.Mesh(personGeometry('head', () => new THREE.SphereGeometry(0.105, 12, 10)), skin); head.scale.set(0.9, 1.12, 0.95); head.position.y = 0.12; headG.add(sh(head));
  const nose = new THREE.Mesh(personGeometry('nose', () => new THREE.SphereGeometry(0.024, 6, 5)), skin); nose.position.set(0, 0.105, 0.098); headG.add(nose);
  const hairM = new THREE.Mesh(personGeometry('hair', () => new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair); hairM.scale.set(0.9, 1.05, 0.95); hairM.position.y = 0.125; headG.add(hairM);
  if (rr() < 0.3) { const beard = new THREE.Mesh(personGeometry('beard', () => new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45)), hair); beard.scale.set(0.85, 1.05, 0.9); beard.position.set(0, 0.11, 0.012); headG.add(beard); }
  if (rr() < 0.45) { const sg = new THREE.Mesh(personGeometry('shades', () => new THREE.BoxGeometry(0.15, 0.03, 0.05)), SHADES); sg.position.set(0, 0.14, 0.085); headG.add(sg); }
  if (hat) {
    const hm = pick(rr, HAT);
    if (rr() < 0.45) { const brim = new THREE.Mesh(personGeometry('hat-brim', () => new THREE.CylinderGeometry(0.2, 0.22, 0.035, 14)), hm); brim.position.y = 0.2; brim.rotation.x = 0.08; headG.add(sh(brim)); const crown = new THREE.Mesh(personGeometry('hat-crown', () => new THREE.CylinderGeometry(0.1, 0.115, 0.1, 12)), hm); crown.position.y = 0.255; headG.add(crown); }
    else { const cap = new THREE.Mesh(personGeometry('cap', () => new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), hm); cap.position.y = 0.135; cap.scale.set(0.92, 1, 0.96); headG.add(cap); const peak = new THREE.Mesh(personGeometry('cap-peak', () => new THREE.BoxGeometry(0.15, 0.018, 0.13)), hm); peak.position.set(0, 0.15, 0.15); peak.rotation.x = -0.15; headG.add(peak); }
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const upper = seg(0.3, 0.05, shirt); upper.position.set(sx * 0.245, 0.5, 0);
    const fore = seg(0.28, 0.045, shirt); fore.position.y = -0.3; upper.add(fore);
    const hand = new THREE.Mesh(personGeometry('hand', () => new THREE.SphereGeometry(0.048, 7, 6)), skin); hand.scale.set(0.8, 1.1, 0.7); hand.position.y = -0.28; fore.add(hand);
    spine.add(upper); arms.push({ upper, fore, hand });
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    const thigh = seg(0.42, 0.075, pants); thigh.position.set(sx * 0.09, 0.0, 0);
    const shin = seg(0.42, 0.06, shorts ? skin : pants); shin.position.y = -0.42; thigh.add(shin);
    const boot = new THREE.Mesh(personGeometry('boot', () => new THREE.BoxGeometry(0.11, 0.07, 0.25)), waders ? WADER : PANTS[0]); boot.position.set(0, -0.415, 0.06); shin.add(sh(boot));
    hips.add(thigh); legs.push({ thigh, shin });
  }
  // things in hands
  let rodMesh = null, tip = null, gunG = null, can = null;
  if (rod) {
    rodMesh = new THREE.Group(); rodMesh.position.y = -0.28; arms[1].fore.add(rodMesh);
    const stick = new THREE.Mesh(personGeometry('rod', () => new THREE.CylinderGeometry(0.005, 0.013, 2.3, 5)), ROD); stick.position.y = 1.0; rodMesh.add(stick);
    const grip = new THREE.Mesh(personGeometry('rod-grip', () => new THREE.CylinderGeometry(0.017, 0.017, 0.34, 6)), GUN); grip.position.y = -0.02; rodMesh.add(grip);
    const reel = new THREE.Mesh(personGeometry('rod-reel', () => new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8)), GUN); reel.rotation.z = Math.PI / 2; reel.position.set(0, 0.22, -0.05); rodMesh.add(reel);
    tip = new THREE.Object3D(); tip.position.y = 2.15; rodMesh.add(tip);
    rodMesh.rotation.x = Math.PI - 0.3;
  }
  if (gun) {
    gunG = new THREE.Group(); gunG.position.y = -0.26; arms[1].fore.add(gunG);
    const barrel = new THREE.Mesh(personGeometry('gun-barrel', () => new THREE.CylinderGeometry(0.016, 0.019, 1.0, 6)), GUN); barrel.position.y = 0.55; gunG.add(barrel);
    const stock = new THREE.Mesh(personGeometry('gun-stock', () => new THREE.BoxGeometry(0.05, 0.4, 0.09)), WOOD); stock.position.set(0, -0.15, 0.02); gunG.add(stock);
    gunG.rotation.x = Math.PI + 0.1;
  }
  if (!rod && !gun && !drive && rr() < 0.4) { can = new THREE.Mesh(personGeometry('can', () => new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10)), pick(rr, CAN)); can.position.y = -0.3; can.rotation.x = 0.25; arms[0].fore.add(can); }
  const base = { ...ZERO, ...BASE[pose] };
  if (rod) { base.rf = 1.0; base.ro = 0.12; base.re = 0.75; if (pose === 'stand') { base.lf = 0.6; base.lo = -0.3; base.le = 1.0; } base.hdx = 0.15; }
  if (gun) { base.rf = 0.6; base.re = 0.9; base.ro = 0.05; base.lf = 0.9; base.lo = 0.45; base.le = 1.0; }
  if (drive) { base.rf = 1.0; base.re = 0.5; base.ro = 0.12; base.lf = 0.5; base.le = 0.6; base.lo = 0.25; base.sx = 0.08; }
  if (can) { base.lf = 0.35; base.le = 1.1; base.lo = 0.12; }
  g.userData = {
    kind: 'person', pose, rodProp: rod, gunProp: gun, drive, can: !!can, hips, spine, head: headG, arms, legs, rod: rodMesh, tip, gun: gunG,
    base, cur: { ...base }, waveT: 0, castT: -1, guide: 0, wrangle: 0, ph: rr() * 6.28, look: 0, lookX: 0, tug: 0,
    act: null, actT: 0, actDur: 0, side: rr() < 0.5 ? -1 : 1, sideT: 4 + rr() * 8, wander: 0, wanderT: 0, rate: 5, faceY: null, buddy: null, walk: null, aimT: 0, seed: rr(),
  };
  // sit the joints at their base pose immediately (the figure may be seen before its first update)
  applyPose(g.userData);
  return g;
}

function applyPose(u) {
  const c = u.cur;
  u.hips.position.set(c.hx, c.hy, 0); u.hips.rotation.set(c.hRx, c.hRy, c.hRz);
  u.spine.rotation.set(c.sx, c.sy, c.sz);
  u.head.rotation.set(c.hdx + u.lookX, c.hdy + u.look, 0);
  const L = u.arms[0], R = u.arms[1];
  L.upper.rotation.set(-c.lf, 0, -c.lo); L.fore.rotation.x = -c.le;
  R.upper.rotation.set(-c.rf, 0, c.ro); R.fore.rotation.x = -c.re;
  u.legs[0].thigh.rotation.set(-c.ltf, 0, -c.lto); u.legs[0].shin.rotation.x = c.lk;
  u.legs[1].thigh.rotation.set(-c.rtf, 0, c.rto); u.legs[1].shin.rotation.x = c.rk;
  if (u.rod) u.rod.rotation.x = Math.PI - c.rod - (u.tug > 0 ? Math.sin(performance.now() * 0.02) * 0.08 : 0);
}

// ---- activities: each writes its targets into P for the act's progress k (0..1) ----
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const env = (k, a = 0.2, b = 0.8) => smooth(k / a) * smooth((1 - k) / (1 - b)); // in, hold, out
const ACTS = {
  idle(u, P) {},
  hold(u, P, k, t) { P.rod = 0.3 + Math.sin(t * 0.6 + u.ph) * 0.05; },
  cross(u, P, k) { const e = env(k, 0.15, 0.85); P.lf = lerp(P.lf, 0.95, e); P.lo = lerp(P.lo, -0.45, e); P.le = lerp(P.le, 2.1, e); P.rf = lerp(P.rf, 0.8, e); P.ro = lerp(P.ro, -0.4, e); P.re = lerp(P.re, 2.2, e); P.sx = lerp(P.sx, -0.03, e); },
  hips(u, P, k) { const e = env(k, 0.15, 0.85); P.lf = lerp(P.lf, 0.05, e); P.lo = lerp(P.lo, 0.62, e); P.le = lerp(P.le, 1.55, e); if (!u.rodProp && !u.gunProp) { P.rf = lerp(P.rf, 0.05, e); P.ro = lerp(P.ro, 0.62, e); P.re = lerp(P.re, 1.55, e); } P.sx = lerp(P.sx, -0.05, e); },
  look(u, P, k, t) { P.hdy += u.lookTo * env(k, 0.2, 0.75); P.sy += u.lookTo * 0.35 * env(k, 0.25, 0.7); },
  drink(u, P, k, t) { const e = env(k, 0.25, 0.7); P.lf = lerp(P.lf, 1.1, e); P.lo = lerp(P.lo, -0.55, e); P.le = lerp(P.le, 2.25, e); P.hdx = lerp(P.hdx, -0.3, smooth((k - 0.35) / 0.2) * smooth((0.75 - k) / 0.15)); },
  scratch(u, P, k, t) { const e = env(k, 0.3, 0.7); P.lf = lerp(P.lf, 1.0, e); P.lo = lerp(P.lo, 0.5, e); P.le = lerp(P.le, 2.35 + Math.sin(t * 11) * 0.08 * e, e); P.hdx = lerp(P.hdx, 0.12, e); P.hdy = lerp(P.hdy, 0.2, e); },
  point(u, P, k, t) { const e = env(k, 0.25, 0.7); if (u.rodProp) { P.lf = lerp(P.lf, 1.45, e); P.lo = lerp(P.lo, 0.3 + u.lookTo * 0.3, e); P.le = lerp(P.le, 0.05, e); } else { P.rf = lerp(P.rf, 1.45, e); P.ro = lerp(P.ro, 0.3 - u.lookTo * 0.3, e); P.re = lerp(P.re, 0.05, e); } P.hdy += u.lookTo * e; P.sy += u.lookTo * 0.3 * e; },
  checkRod(u, P, k, t) { const e = env(k, 0.3, 0.7); P.rf = lerp(P.rf, 0.45, e); P.re = lerp(P.re, 1.7, e); P.rod = lerp(P.rod, 0.7, e); P.hdx = lerp(P.hdx, -0.25, e); P.lf = lerp(P.lf, 0.6, e); P.le = lerp(P.le, 1.6, e); P.lo = lerp(P.lo, 0.05, e); },
  reel(u, P, k, t) { const e = env(k, 0.15, 0.9); P.lf = lerp(P.lf, 0.7, e); P.lo = lerp(P.lo, 0.32 + Math.cos(t * 9) * 0.06 * e, e); P.le = lerp(P.le, 1.55 + Math.sin(t * 9) * 0.14 * e, e); P.rod = lerp(P.rod, 0.55 + Math.sin(t * 9) * 0.02, e); P.hdx = lerp(P.hdx, 0.25, e); P.sx += 0.05 * e; },
  sitBack(u, P, k) { const e = env(k, 0.2, 0.85); P.sx = lerp(P.sx, -0.12, e); if (!u.rodProp) { P.rf = lerp(P.rf, 0.25, e); P.re = lerp(P.re, 0.25, e); P.ro = lerp(P.ro, 0.3, e); } P.lf = lerp(P.lf, 0.25, e); P.le = lerp(P.le, u.can ? 1.1 : 0.25, e); P.lo = lerp(P.lo, 0.3, e); P.hdx = lerp(P.hdx, -0.08, e); },
  sitLean(u, P, k) { const e = env(k, 0.2, 0.85); P.sx = lerp(P.sx, 0.4, e); P.lf = lerp(P.lf, 0.95, e); P.le = lerp(P.le, 0.95, e); P.lo = lerp(P.lo, -0.05, e); if (!u.rodProp) { P.rf = lerp(P.rf, 0.95, e); P.re = lerp(P.re, 0.95, e); P.ro = lerp(P.ro, -0.05, e); } P.hdx = lerp(P.hdx, 0.1, e); },
  chat(u, P, k, t) { const e = env(k, 0.2, 0.85); const g1 = Math.sin(t * 3.1 + u.ph), g2 = Math.sin(t * 2.3 + u.ph * 2); P.lf = lerp(P.lf, 0.7 + g1 * 0.2, e); P.le = lerp(P.le, 1.4 + g2 * 0.35, e); P.lo = lerp(P.lo, 0.3 + g1 * 0.15, e); if (!u.rodProp) { P.rf = lerp(P.rf, 0.6 - g2 * 0.15, e); P.re = lerp(P.re, 1.2 + g1 * 0.3, e); P.ro = lerp(P.ro, 0.25, e); } P.hdx += Math.sin(t * 4.5) * 0.04 * e; },
  listen(u, P, k, t) { const e = env(k, 0.2, 0.85); P.hdx += (Math.sin(t * 2.2 + u.ph) * 0.05 + 0.04) * e; },
  kick(u, P, k, t) { P.lk += Math.sin(t * 2.4 + u.ph) * 0.35; P.rk += Math.sin(t * 2.4 + u.ph + 2.4) * 0.35; },
  work(u, P, k, t) { const a = Math.sin(t * 2.6 + u.ph), b = Math.sin(t * 3.3 + u.ph + 1); P.lf += a * 0.15; P.le += b * 0.3 + 0.2; P.rf -= a * 0.12; P.re += 0.25 - b * 0.25; P.lo += 0.05; P.ro += 0.05; P.hdx += 0.45 + a * 0.04; P.sx += 0.05; },
  standUp(u, P, k, t) { // a crouching worker gets up, arches its back, has a look around, and gets back down
    const e = smooth(k / 0.12) * smooth((1 - k) / 0.15); const S = BASE.stand;
    for (const c of ['hy', 'sx', 'lf', 'lo', 'le', 'rf', 'ro', 're', 'ltf', 'lto', 'lk', 'rtf', 'rto', 'rk']) P[c] = lerp(P[c], S[c], e);
    const st = smooth((k - 0.1) / 0.1) * smooth((0.4 - k) / 0.1); P.sx = lerp(P.sx, -0.18, st); P.lf = lerp(P.lf, 0.3, st); P.rf = lerp(P.rf, 0.3, st); P.lo = lerp(P.lo, 0.6, st); P.ro = lerp(P.ro, 0.6, st); P.le = lerp(P.le, 1.6, st); P.re = lerp(P.re, 1.6, st); P.hdx = lerp(P.hdx, -0.25, st);
    const lk = smooth((k - 0.4) / 0.1) * smooth((0.9 - k) / 0.1); P.hdy += u.lookTo * lk; P.sy += u.lookTo * 0.3 * lk; P.hx = lerp(P.hx, u.side * 0.035, e); P.hRz = lerp(P.hRz, u.side * 0.05, e);
  },
  aim(u, P, k) { const e = env(k, 0.2, 0.8); P.rf = lerp(P.rf, 1.35, e); P.re = lerp(P.re, 0.35, e); P.ro = lerp(P.ro, -0.15, e); P.lf = lerp(P.lf, 1.4, e); P.lo = lerp(P.lo, 0.15, e); P.le = lerp(P.le, 0.6, e); P.hdx = lerp(P.hdx, 0.12, e); P.hdy = lerp(P.hdy, 0.15, e); P.sx = lerp(P.sx, 0.3, e); P.sy = lerp(P.sy, -0.35, e); },
  peek(u, P, k) { const e = env(k, 0.3, 0.7); P.hy = lerp(P.hy, 0.62, e); P.lk = lerp(P.lk, 1.6, e); P.rk = lerp(P.rk, 1.6, e); P.ltf = lerp(P.ltf, 0.9, e); P.rtf = lerp(P.rtf, 0.9, e); P.sx = lerp(P.sx, 0.2, e); P.hdx = lerp(P.hdx, -0.1, e); },
  cast(u, P, k, t) {
    const c = u.actT;
    if (c < 0.6) { const q = c / 0.6; P.rf = 1.0 + 1.3 * Math.sin(q * Math.PI / 2); P.re = 0.75 + 0.5 * q; P.rod = 0.3 + 1.1 * q; P.sx = 0.05 - 0.12 * q; P.hdx = -0.1 * q; }
    else if (c < 0.85) { const q = (c - 0.6) / 0.25; P.rf = 2.3 - 1.5 * q; P.re = 1.25 - 0.95 * q; P.rod = 1.4 - 1.6 * q; P.sx = -0.07 + 0.25 * q; P.hdx = -0.1 + 0.3 * q; if (!u.castFired && q > 0.7) { u.castFired = true; u.onCast && u.onCast(u.g); } }
    else { const q = smooth((c - 0.85) / 0.75); P.rf = lerp(0.8, 1.0, q); P.re = lerp(0.3, 0.75, q); P.rod = lerp(-0.2, 0.3, q); P.sx = lerp(0.18, 0.05, q); P.hdx = lerp(0.2, 0.15, q); }
    P.lf = 0.45; P.le = 1.0; P.lo = 0.1;
  },
  walk(u, P, k, t) {
    const ph = u.walkPh; const s = Math.sin(ph), c = Math.cos(ph);
    P.ltf = s * 0.5; P.rtf = -s * 0.5; P.lk = Math.max(0, -c) * 0.9 + 0.08; P.rk = Math.max(0, c) * 0.9 + 0.08;
    P.hy = BASE.stand.hy - 0.025 + Math.abs(c) * 0.025; P.sx = 0.1; P.hdx = 0.1; P.hRy = s * 0.06;
    if (u.rodProp) { P.rf = 0.75; P.re = 0.9; P.rod = 0.55; P.lf = 0.2 - s * 0.35; P.le = 0.4; } else { P.lf = 0.15 - s * 0.35; P.rf = 0.15 + s * 0.35; P.le = 0.4; P.re = 0.4; }
  },
};
// what a figure does next, by pose and props; [name, weight, minDur, maxDur]
function menu(u) {
  const p = u.pose;
  if (u.gunProp) return [['idle', 5, 3, 8], ['work', 2, 3, 6], ['look', 3, 3, 5], ['peek', 1, 3, 5], ['scratch', 1, 1.6, 2.2]];
  if (u.drive) return [['idle', 5, 4, 9], ['look', 3, 3, 5], ['scratch', 1, 1.6, 2.2]];
  if (p === 'stand') {
    const m = [['look', 3, 3, 5], ['scratch', 1.5, 1.6, 2.4], ['point', 1, 2.5, 3.5]];
    if (u.rodProp) m.push(['hold', 6, 4, 12], ['checkRod', 1.5, 2.5, 4]); else m.push(['idle', 3, 3, 8], ['hips', 3, 5, 12], ['cross', 3, 6, 14]);
    if (u.can) m.push(['drink', 2.5, 2.6, 3.4]);
    if (u.walk) m.push(['walk', u.rodProp ? 1.2 : 2, 0, 0]);
    return m;
  }
  if (p === 'sit' || p === 'sitEdge') {
    const m = [['idle', 3, 3, 8], ['sitBack', 3, 5, 14], ['sitLean', 3, 5, 12], ['look', 2, 3, 5], ['scratch', 1, 1.6, 2.4]];
    if (u.can) m.push(['drink', 3, 2.6, 3.4]);
    if (u.buddy) m.push(['chat', 3, 4, 9]);
    if (p === 'sitEdge') m.push(['kick', 2, 4, 9]);
    if (!u.rodProp) m.push(['point', 0.8, 2.5, 3.5]);
    return m;
  }
  return [['work', 6, 4, 10], ['look', 1.5, 3, 4], ['standUp', 2, 6, 10], ['scratch', 1, 1.6, 2.2]];
}
function startAct(u, name, dur) {
  u.act = name; u.actT = 0; u.actDur = dur; u.rate = 5;
  if (name === 'look' || name === 'point' || name === 'standUp') u.lookTo = (Math.random() - 0.5) * 1.6;
  if (name === 'chat' && u.buddy) { const b = u.buddy.userData; if (!b.act || b.act === 'idle' || b.act === 'sitBack' || b.act === 'hold') startAct(b, 'listen', dur); }
  if (name === 'walk') { // pick a spot along the bank stretch; duration from the distance
    const w = u.walk; const s = Math.random(); const tx = w.ax + (w.bx - w.ax) * s, tz = w.az + (w.bz - w.az) * s;
    const d = Math.hypot(tx - u.g.position.x, tz - u.g.position.z); if (d < 0.8) { u.act = 'idle'; u.actDur = 2; return; }
    u.walkTo = [tx, tz]; u.actDur = d / 0.8 + 0.3; u.walkPh = 0; u.rate = 10;
  }
  if (name === 'cast') { u.rate = 14; u.castFired = false; }
}
function nextAct(u) {
  const m = menu(u); let tot = 0; for (const e of m) tot += e[1]; let r = Math.random() * tot; let ch = m[0];
  for (const e of m) { r -= e[1]; if (r <= 0) { ch = e; break; } }
  startAct(u, ch[0], ch[2] + Math.random() * (ch[3] - ch[2]));
}

// per-frame life for one figure. boat = {x, z, speed} in world space; env may carry heightAt(x,z) for walkers.
const _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _l = new THREE.Vector3(), _b = new THREE.Vector3();
const P = { ...ZERO };
function localYaw(g, wx, wz) { g.getWorldPosition(_w); g.getWorldQuaternion(_q); _l.set(wx - _w.x, 0, wz - _w.z).applyQuaternion(_q.invert()); return Math.atan2(_l.x, _l.z); }
export function animatePerson(g, t, dt, boat, envIn) {
  const u = g.userData; u.g = g; const ph = u.ph; dt = Math.min(dt, 0.1);
  if (u.faceY === null) u.faceY = g.rotation.y;
  // --- what to do ---
  if (u.guide > 0) { u.act = 'guide'; u.actT = 0; u.actDur = 1; }
  else if (u.act === 'guide') u.act = null;
  u.actT += dt; if (!u.act || (u.actT >= u.actDur && u.act !== 'walk')) nextAct(u);
  if (u.act === 'walk') {
    const [tx, tz] = u.walkTo; const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz); let dy = want - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * (1 - Math.exp(-dt * 6));
    if (d > 0.15 && u.actT > 0.25) { const step = Math.min(d, 0.8 * dt); g.position.x += dx / d * step; g.position.z += dz / d * step; u.walkPh += dt * 5.8; if (envIn && envIn.heightAt) g.position.y = envIn.heightAt(g.position.x, g.position.z); }
    if (d <= 0.15 || u.actT > u.actDur + 1.5) { nextAct(u); if (u.act === 'walk') nextAct(u); }
  } else if (u.pose === 'stand' && u.walk) { let dy = u.faceY - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * (1 - Math.exp(-dt * 4)); }
  // --- target pose ---
  Object.assign(P, u.base);
  const k = u.actDur > 0 ? u.actT / u.actDur : 0;
  if (u.act === 'guide') { P.rf = 2.35 + Math.sin(t * 3.2) * 0.1; P.re = 0.75 + Math.sin(t * 3.2) * 0.55; P.ro = -0.2; P.sx = -0.05; P.hdx = -0.1; }
  else if (u.act && ACTS[u.act]) ACTS[u.act](u, P, k, t);
  const wrangle = Math.max(0, Math.min(1, Number(u.wrangle) || 0));
  if (wrangle > 0) {
    const fight = Math.sin(t * 5.2 + ph), brace = Math.sin(t * 2.1 + ph * 0.7);
    P.hy = lerp(P.hy, 0.58 + brace * 0.012, wrangle); P.sx = lerp(P.sx, 0.76 + fight * 0.045, wrangle); P.hdx = lerp(P.hdx, 0.42, wrangle);
    P.lf = lerp(P.lf, 1.34 + fight * 0.08, wrangle); P.lo = lerp(P.lo, -0.5, wrangle); P.le = lerp(P.le, 1.18 - fight * 0.1, wrangle);
    P.rf = lerp(P.rf, 1.42 - fight * 0.07, wrangle); P.ro = lerp(P.ro, -0.42, wrangle); P.re = lerp(P.re, 1.08 + fight * 0.1, wrangle);
    P.ltf = lerp(P.ltf, 0.72, wrangle); P.lk = lerp(P.lk, 1.28 + brace * 0.05, wrangle); P.rtf = lerp(P.rtf, 0.66, wrangle); P.rk = lerp(P.rk, 1.18 - brace * 0.05, wrangle);
  }
  if (u.routineState === RESIDENT_ROUTINE.BRACE) {
    P.sx += 0.32; P.hdx += 0.2; P.hy -= u.pose === 'stand' ? 0.1 : 0.035;
    P.lf = lerp(P.lf, 1.75, 0.72); P.lo = lerp(P.lo, -0.28, 0.72); P.le = lerp(P.le, 1.7, 0.72);
    P.rf = lerp(P.rf, 1.35, 0.62); P.ro = lerp(P.ro, 0.35, 0.62); P.re = lerp(P.re, 1.55, 0.62);
    P.lk += u.pose === 'stand' ? 0.34 : 0.08; P.rk += u.pose === 'stand' ? 0.34 : 0.08;
  } else if (u.routineState === RESIDENT_ROUTINE.WATCH && boat) {
    const bearing = localYaw(g, boat.x, boat.z), side = Math.max(-1.15, Math.min(1.15, bearing));
    P.hdy += side * 0.68; P.sy += side * 0.22; P.sx += 0.08;
    if (u.pose === 'stand' && !u.drive) {
      P.rf = lerp(P.rf, 1.42, 0.62); P.ro = lerp(P.ro, 0.28 - side * 0.12, 0.62); P.re = lerp(P.re, 0.18, 0.62);
      P.lf = lerp(P.lf, 0.65, 0.45); P.le = lerp(P.le, 1.45, 0.45);
    } else P.sx += 0.12;
  }
  // standing weight shift, changes side every so often
  if (u.pose === 'stand' && u.act !== 'walk') {
    u.sideT -= dt; if (u.sideT <= 0) { u.side = -u.side; u.sideT = 5 + Math.random() * 10; }
    P.hx += u.side * 0.035; P.hRz += u.side * 0.045; if (u.side > 0) { P.rk += 0.22; P.rtf += 0.1; } else { P.lk += 0.22; P.ltf += 0.1; }
  }
  // the wave: left arm up, hand rocking
  if (u.waveT > 0) { u.waveT -= dt; const e = Math.min(1, u.waveT * 2) * Math.min(1, (2.4 - u.waveT) * 3); P.lf = lerp(P.lf, 2.75, e); P.lo = lerp(P.lo, 0.3 + Math.sin(t * 9) * 0.35, e); P.le = lerp(P.le, 0.35, e); P.hdx = lerp(P.hdx, -0.1, e); }
  // breathing and a slow sway
  P.hy += Math.sin(t * 1.3 + ph) * 0.005; P.sx += Math.sin(t * 1.3 + ph) * 0.012; P.sz += Math.sin(t * 0.7 + ph) * 0.012;
  // --- ease the joints toward the target ---
  const w = 1 - Math.exp(-dt * u.rate);
  const c = u.cur; for (const ch of CHANNELS) c[ch] += (P[ch] - c[ch]) * w;
  // --- the head: the boat when it is close, a chatting mate, else a slow wander ---
  let look = 0, lookX = 0, lookRate = 3;
  if (u.act === 'chat' || u.act === 'listen') { if (u.buddy) { const a = localYaw(g, u.buddy.getWorldPosition(_b).x, _b.z); look = Math.max(-1.4, Math.min(1.4, a)); lookX = 0.05; } }
  if (boat) {
    g.getWorldPosition(_w); const d = Math.hypot(boat.x - _w.x, boat.z - _w.z);
    if (d < 45 && (boat.speed > 1.5 || d < 22 || u.act === 'idle' || u.act === 'hold')) { const a = localYaw(g, boat.x, boat.z); look = Math.max(-1.35, Math.min(1.35, a)); lookX = Math.abs(a) > 1.35 ? 0.35 : 0; }
  }
  if (look === 0 && lookX === 0) { u.wanderT -= dt; if (u.wanderT <= 0) { u.wanderT = 2 + Math.random() * 5; u.wander = (Math.random() - 0.5) * 0.7; } look = u.wander; lookRate = 1.5; }
  u.look += (look - u.look) * (1 - Math.exp(-dt * lookRate)); u.lookX += (lookX - u.lookX) * (1 - Math.exp(-dt * 3));
  u.tug = Math.max(0, (u.tug || 0) - dt);
  applyPose(u);
  u.head.rotation.y += Math.sin(t * 0.7 + ph) * 0.04; u.head.rotation.x += Math.sin(t * 0.5 + ph) * 0.02;
  u.castT = u.act === 'cast' ? u.actT : -1;
}
export function wave(g) { if (g.userData.waveT <= 0) g.userData.waveT = 2.4; }
export function setWranglePose(g, strength = 0) { if (g?.userData) g.userData.wrangle = Math.max(0, Math.min(1, Number(strength) || 0)); }
// start a cast; false if the figure is busy walking (try again next frame)
export function cast(g) { const u = g.userData; if (u.act === 'walk' || u.act === 'cast' || u.act === 'reel') return false; startAct(u, 'cast', 1.65); return true; }
export function rodTip(g, out) { return g.userData.tip ? g.userData.tip.getWorldPosition(out) : null; }
export function aim(g, dur = 3) { if (g.userData.act !== 'aim') startAct(g.userData, 'aim', dur); }
export function pair(a, b) { a.userData.buddy = b; b.userData.buddy = a; }
// a stretch of bank for a standing figure to wander along, world space
export function walkAlong(g, ax, az, bx, bz) { g.userData.walk = { ax, az, bx, bz }; }

// the rod: cast on a cooldown, line on the water for a while, sometimes a bite, then reel it in. Needs the figure to
// carry a fishingLine() in userData.line and a lineTarget vector; ctx = { bx, bz, emitStamp, audio, fish }.
const _tip = new THREE.Vector3(), _dir = new THREE.Vector3();
export function fishingUpdate(p, t, dt, waveFn, ctx) {
  const u = p.userData; if (!u.rod || !u.line) return;
  if (!u.onCast) u.onCast = (pp) => {
    rodTip(pp, _tip); pp.getWorldDirection(_dir); const r = 5 + Math.random() * 5;
    u.lineTarget.set(_tip.x + _dir.x * r, 0, _tip.z + _dir.z * r); u.lineOn = 14 + Math.random() * 14; u.line.visible = true;
    const d = Math.hypot(u.lineTarget.x - ctx.bx, u.lineTarget.z - ctx.bz);
    if (ctx.emitStamp) ctx.emitStamp(u.lineTarget.x, u.lineTarget.z, 0.45, 0.12, 0.5, 0.4);
    else ctx.stamps?.push({ x: u.lineTarget.x, z: u.lineTarget.z, radius: 0.45, height: 0.12, foam: 0.5, foamRadius: 0.4 });
    if (ctx.audio) ctx.audio.plip(0.3 * Math.max(0, 1 - d / 60), u.lineTarget.x, u.lineTarget.z);
    u.biteT = Math.random() < 0.35 ? 4 + Math.random() * 8 : -1;
  };
  if (u.lineOn > 0) {
    u.lineOn -= dt; rodTip(p, _tip); u.lineTarget.y = waveFn(u.lineTarget.x, u.lineTarget.z, t); setLine(u.line, _tip, u.lineTarget);
    if (u.biteT > 0) { u.biteT -= dt; if (u.biteT <= 0) { u.tug = 2.5; if (ctx.fish) ctx.fish.launch(u.lineTarget.x, u.lineTarget.z, 2.2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0.8, 1); } }
    if (u.lineOn <= 0) { u.reelT = 3 + Math.random() * 2.5; u.reelFrom = u.lineTarget.clone(); if (u.act !== 'walk') startAct(u, 'reel', u.reelT); }
  } else if (u.reelT > 0) {
    u.reelT -= dt; rodTip(p, _tip); const q = 1 - Math.max(0, u.reelT) / (u.act === 'reel' ? u.actDur : 4);
    u.lineTarget.x = lerp(u.reelFrom.x, _tip.x, q * 0.9); u.lineTarget.z = lerp(u.reelFrom.z, _tip.z, q * 0.9); u.lineTarget.y = waveFn(u.lineTarget.x, u.lineTarget.z, t) + q * 0.6;
    setLine(u.line, _tip, u.lineTarget);
    if (u.reelT <= 0) { u.line.visible = false; u.castCd = 4 + Math.random() * 16; }
  } else { u.castCd -= dt; if (u.castCd <= 0 && cast(p)) u.castCd = 1e9; }
}

// ---- props ----
export function cooler(rr) { const g = new THREE.Group(); const b = new THREE.Mesh(personGeometry('cooler-body', () => new THREE.BoxGeometry(0.58, 0.4, 0.38)), rr() < 0.5 ? PLASTIC : BLUE); b.position.y = 0.2; g.add(sh(b)); const lid = new THREE.Mesh(personGeometry('cooler-lid', () => new THREE.BoxGeometry(0.6, 0.06, 0.4)), PLASTIC); lid.position.y = 0.43; g.add(lid); return g; }
export function bucket() { const b = new THREE.Mesh(personGeometry('bucket', () => new THREE.CylinderGeometry(0.15, 0.13, 0.34, 10)), PLASTIC); b.position.y = 0.17; return sh(b); }
export function chair(rr) {
  const g = new THREE.Group(); const m = pick(rr, [BLUE, PLASTIC, SHIRT[3]]);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.48), m); seat.position.y = 0.45; g.add(sh(seat));
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.04), m); back.position.set(0, 0.72, -0.24); back.rotation.x = -0.15; g.add(sh(back));
  for (const sx of [-0.22, 0.22]) for (const sz of [-0.2, 0.2]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 5), GUN); l.position.set(sx, 0.225, sz); g.add(l); }
  return g;
}
export function rodHolder() { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), GUN); p.position.y = 0.3; g.add(p); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 2.2, 5), ROD); r.position.set(0, 1.2, 0.5); r.rotation.x = -0.5; g.add(r); return g; }
// a thin line from the rod tip to a point on the water; rebuilt each frame from two world points
export function fishingLine() { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); const l = new THREE.Line(geo, LINE); l.frustumCulled = false; return l; }
export function setLine(line, a, b) { const p = line.geometry.attributes.position.array; p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z; line.geometry.attributes.position.needsUpdate = true; }

// a canoe with two paddlers; userData.paddlers[] are person groups with a paddle in the right hand
export function canoe(rr) {
  const g = new THREE.Group();
  const hullM = new THREE.MeshStandardMaterial({ color: pick(rr, [0x3c7a3a, 0xb8352a, 0xd8c24a, 0x6f7570]), roughness: 0.5 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), hullM); hull.scale.set(0.9, 0.42, 4.6); hull.position.y = 0.02; g.add(sh(hull));
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 })); inner.scale.set(0.78, 0.3, 4.3); inner.position.y = 0.12; g.add(inner);
  for (const z of [-0.9, 0.9]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.25), WOOD); seat.position.set(0, 0.3, z); g.add(seat); }
  g.userData.paddlers = [];
  for (const [i, z] of [[0, 1.0], [1, -0.8]]) {
    const p = person(rr, { pose: 'sit', hat: true, vest: rr() < 0.7 }); p.position.set(0, -0.15, z); p.rotation.y = Math.PI; g.add(p);
    const fore = p.userData.arms[1].fore; const paddle = new THREE.Group(); paddle.position.y = -0.28; fore.add(paddle);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), WOOD); shaft.position.y = -0.4; paddle.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.02), WOOD); blade.position.y = -1.2; paddle.add(blade);
    p.userData.paddle = paddle; p.userData.side = i === 0 ? 1 : -1;
    g.userData.paddlers.push(p);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
// paddling stroke; k = 0..1 speed fraction. Writes the joints directly (paddlers do not run animatePerson).
export function paddleAnim(c, t, k) {
  for (const p of c.userData.paddlers) {
    const u = p.userData, s = u.side, ph = t * 2.2 + (s > 0 ? 0 : 0.4);
    const R = u.arms[1], L = u.arms[0];
    R.upper.rotation.set(-(0.9 + Math.sin(ph) * 0.55 * k), 0, 0.35 * s); R.fore.rotation.x = -(0.6 - Math.cos(ph) * 0.3 * k);
    L.upper.rotation.set(-(0.7 + Math.sin(ph) * 0.35 * k), 0, -0.5 * s); L.fore.rotation.x = -(0.9 + Math.cos(ph) * 0.2 * k);
    u.paddle.rotation.z = s * (0.85 + Math.sin(ph) * 0.1); u.paddle.rotation.x = Math.PI / 2 - 0.3 + Math.cos(ph) * 0.3 * k;
    u.spine.rotation.x = 0.15 + Math.cos(ph) * 0.1 * k; u.spine.rotation.y = -s * 0.15;
    u.head.rotation.y = Math.sin(t * 0.4 + u.ph) * 0.3;
  }
}
