import * as THREE from 'three';
import * as TEX from './textures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WORLD_HALF } from './heightfield.js';

// Boat local frame: +X starboard, +Y up, -Z forward (bow at -Z).
// The player boat and scheduled traffic use the same detailed hull. Keep one immutable render template so its
// expensive cage, hull and texture data live in GPU/JS memory once; each caller still receives its own transform tree.
let airboatTemplate = null;
function createAirboatTemplate() {
  const g = new THREE.Group(); g.name = 'airboat';
  const geometryCache = new Map();
  const cachedGeometry = (type, args, create) => {
    const key = `${type}:${args.join(':')}`;
    if (!geometryCache.has(key)) geometryCache.set(key, create());
    return geometryCache.get(key);
  };
  const boxGeo = (...args) => cachedGeometry('box', args, () => new THREE.BoxGeometry(...args));
  const cylinderGeo = (...args) => cachedGeometry('cylinder', args, () => new THREE.CylinderGeometry(...args));
  const torusGeo = (...args) => cachedGeometry('torus', args, () => new THREE.TorusGeometry(...args));
  const capsuleGeo = (...args) => cachedGeometry('capsule', args, () => new THREE.CapsuleGeometry(...args));
  const circleGeo = (...args) => cachedGeometry('circle', args, () => new THREE.CircleGeometry(...args));
  const black = new THREE.MeshStandardMaterial({ color: 0x141616, roughness: 0.5, metalness: 0.55 });
  const darkAlu = new THREE.MeshStandardMaterial({ color: 0x2b2e2d, roughness: 0.45, metalness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6d6a, roughness: 0.35, metalness: 0.9 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1c, roughness: 0.6, metalness: 0.6 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x232424, roughness: 0.85 });

  // box-projected UVs (world-ish metres * scale) for extruded / arbitrary geometry
  const boxUV = (geo, scale = 0.5) => {
    const pos = geo.attributes.position, nrm = geo.attributes.normal; const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      let u, v; if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
      uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
  };
  // hull: welded aluminium panels with rivet rows (map + normal + roughness), polymer slick bottom, spray chines
  const hp = TEX.hullPanels();
  const hullMat = new THREE.MeshStandardMaterial({ map: hp.map, normalMap: hp.normalMap, roughnessMap: hp.roughnessMap, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xd8dcda, roughness: 1.0, metalness: 0.72 });
  const shape = new THREE.Shape();
  const pts = [[0, -2.95], [0.55, -2.75], [1.0, -2.2], [1.22, -1.4], [1.25, 2.45], [-1.25, 2.45], [-1.22, -1.4], [-1.0, -2.2], [-0.55, -2.75]];
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1]);
  shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.58, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  hullGeo.rotateX(-Math.PI / 2);
  boxUV(hullGeo, 0.42);
  const hull = new THREE.Mesh(hullGeo, hullMat); hull.castShadow = true; hull.receiveShadow = true; g.add(hull);
  // polymer bottom sheet (slightly proud of the hull, lighter grey)
  const polyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }); polyGeo.rotateX(-Math.PI / 2); polyGeo.translate(0, -0.055, 0); boxUV(polyGeo, 0.42);
  const poly = new THREE.Mesh(polyGeo, new THREE.MeshStandardMaterial({ color: 0x6d7174, roughness: 0.55, metalness: 0.1 })); poly.scale.set(1.012, 1, 1.006); g.add(poly);
  // spray chines along the waterline
  for (const sx of [-1, 1]) {
    const chine = new THREE.Mesh(boxGeo(0.11, 0.05, 3.9), hullMat); chine.position.set(sx * 1.27, 0.12, 0.35); chine.rotation.z = -sx * 0.35; g.add(chine);
  }
  // deck: aluminium diamond plate
  const dp = TEX.diamondPlate(); dp.map.repeat.set(5, 11); dp.normalMap.repeat.set(5, 11);
  const deckMat = new THREE.MeshStandardMaterial({ map: dp.map, normalMap: dp.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), color: 0xb9bdbc, roughness: 0.55, metalness: 0.75 });
  const deck = new THREE.Mesh(boxGeo(2.2, 0.04, 4.9), deckMat); deck.position.set(0, 0.62, -0.1); deck.receiveShadow = true; g.add(deck);
  // gunwale rub-rails (rounded, pale polymer) + inner lip
  const rubMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.7, metalness: 0.05 });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(capsuleGeo(0.045, 4.2, 4, 10), rubMat); rail.rotation.x = Math.PI / 2; rail.position.set(sx * 1.24, 0.6, 0.1); g.add(rail);
    const lip = new THREE.Mesh(boxGeo(0.06, 0.09, 4.3), darkAlu); lip.position.set(sx * 1.16, 0.66, 0.1); g.add(lip);
  }
  const bowRub = new THREE.Mesh(torusGeo(0.62, 0.045, 8, 24, Math.PI), rubMat); bowRub.rotation.x = Math.PI / 2; bowRub.rotation.z = Math.PI; bowRub.position.set(0, 0.6, -2.35); g.add(bowRub);
  // grab rail around bow
  const bowRail = new THREE.Mesh(torusGeo(0.9, 0.025, 8, 24, Math.PI), steel);
  bowRail.rotation.x = Math.PI / 2; bowRail.rotation.z = Math.PI; bowRail.position.set(0, 1.0, -1.9); g.add(bowRail);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(cylinderGeo(0.025, 0.025, 0.4, 8), steel); p.position.set(sx * 0.9, 0.82, -1.9); g.add(p); }

  // front bench seat
  const bench = new THREE.Mesh(boxGeo(1.9, 0.14, 0.55), seatMat); bench.position.set(0, 1.0, -0.75); bench.castShadow = true; g.add(bench);
  const benchBack = new THREE.Mesh(boxGeo(1.9, 0.5, 0.1), seatMat); benchBack.position.set(0, 1.3, -0.5); benchBack.castShadow = true; g.add(benchBack);
  for (const sx of [-0.8, 0.8]) for (const sz of [-1.0, -0.5]) { const p = new THREE.Mesh(cylinderGeo(0.03, 0.03, 0.38, 8), steel); p.position.set(sx, 0.82, sz); g.add(p); }

  // driver's station: footrest platform on posts; the seat pedestal comes with the driver model
  const seatY = 1.62;
  const footrest = new THREE.Mesh(boxGeo(0.9, 0.04, 0.6), deckMat); footrest.position.set(0, 1.03, -0.05); footrest.castShadow = true; g.add(footrest);
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.28, 0.2]) { const p = new THREE.Mesh(cylinderGeo(0.03, 0.03, 0.41, 8), steel); p.position.set(sx, 0.825, sz); g.add(p); }
  const seatBack = new THREE.Mesh(boxGeo(0.6, 0.5, 0.08), seatMat); seatBack.position.set(0, 1.86, 0.92); seatBack.castShadow = true; g.add(seatBack);
  for (const sx of [-0.25, 0.25]) { const p = new THREE.Mesh(cylinderGeo(0.02, 0.02, 0.6, 8), steel); p.position.set(sx, 1.55, 0.92); g.add(p); }
  // control stick on the left, reaching the driver's hand
  const stick = new THREE.Mesh(cylinderGeo(0.018, 0.018, 0.85, 8), steel); stick.position.set(-0.4, 1.75, 0.1); stick.rotation.z = -0.35; stick.rotation.x = 0.25; g.add(stick);
  const stickBase = new THREE.Mesh(boxGeo(0.1, 0.5, 0.1), darkAlu); stickBase.position.set(-0.55, 1.2, 0.2); g.add(stickBase);

  // engine
  const eng = new THREE.Group(); eng.position.set(0, 1.05, 1.75);
  const block = new THREE.Mesh(boxGeo(0.75, 0.55, 0.7), engineMat); block.castShadow = true; eng.add(block);
  for (const sx of [-1, 1]) { const head = new THREE.Mesh(boxGeo(0.28, 0.32, 0.72), engineMat); head.position.set(sx * 0.3, 0.4, 0); head.rotation.z = -sx * 0.5; eng.add(head); }
  const intake = new THREE.Mesh(cylinderGeo(0.16, 0.2, 0.16, 16), darkAlu); intake.position.set(0, 0.62, 0); eng.add(intake);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(cylinderGeo(0.035, 0.035, 0.5, 8), steel); pipe.position.set(sx * 0.5, 0.05 - i * 0.02, -0.25 + i * 0.16); pipe.rotation.z = sx * 0.9; eng.add(pipe);
  }
  const shaft = new THREE.Mesh(cylinderGeo(0.06, 0.06, 0.55, 12), steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(0, 0.7, 0.5); eng.add(shaft);
  const engMount = new THREE.Mesh(boxGeo(0.9, 0.12, 0.9), darkAlu); engMount.position.set(0, -0.35, 0); eng.add(engMount);
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.4, 0.4]) { const p = new THREE.Mesh(cylinderGeo(0.03, 0.03, 0.4, 8), steel); p.position.set(sx, -0.55, sz); eng.add(p); }
  g.add(eng);

  // fuel tank
  const tank = new THREE.Mesh(boxGeo(0.6, 0.35, 0.6), darkAlu); tank.position.set(0.7, 0.82, 1.9); tank.castShadow = true; g.add(tank);
  const tank2 = tank.clone(); tank2.position.x = -0.7; g.add(tank2);

  // ---- cage: short drum at the front, deep spherical dome at the back ----
  const cage = new THREE.Group(); cage.name = 'airboat cage'; cage.position.set(0, 1.8, 2.35);
  const R = 1.3, depth = 0.5, domeD = 0.62;
  const ringMat = steel;
  // dome profile: radius/z as a function of u in [0,1]
  const domePt = (u) => { const a = u * Math.PI / 2; return { r: R * Math.pow(Math.cos(a), 0.78), z: depth / 2 + domeD * Math.sin(a) }; };
  const profile = [new THREE.Vector3(R, -depth / 2, 0), new THREE.Vector3(R, depth / 2, 0)];
  for (let i = 1; i <= 10; i++) { const d = domePt(i / 10); profile.push(new THREE.Vector3(d.r, d.z, 0)); }
  // rings / hoops
  const hoop = (r, z, tube) => { const h = new THREE.Mesh(torusGeo(r, tube, 8, 72), ringMat); h.position.z = z; cage.add(h); };
  hoop(R, -depth / 2, 0.03); hoop(R, depth / 2, 0.03);
  for (const u of [0.32, 0.6, 0.82]) { const d = domePt(u); hoop(d.r, d.z, 0.018); }
  // bars: run straight along the drum then curve in over the dome to the apex
  const barPts = profile.map(p => new THREE.Vector3(p.x, 0, p.y)); barPts.push(new THREE.Vector3(0, 0, depth / 2 + domeD + 0.01));
  const barCurve = new THREE.CatmullRomCurve3(barPts, false, 'centripetal', 0.5);
  const barGeo = new THREE.TubeGeometry(barCurve, 26, 0.014, 6, false);
  const NB = 30;
  for (let i = 0; i < NB; i++) {
    const bar = new THREE.Mesh(barGeo, ringMat); bar.rotation.z = (i / NB) * Math.PI * 2; cage.add(bar);
  }
  // front face: radial spokes + inner rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(cylinderGeo(0.012, 0.012, R, 6), ringMat);
    spoke.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, -depth / 2); spoke.rotation.z = a + Math.PI / 2; cage.add(spoke);
  }
  for (const rr of [0.5, 0.95]) hoop(rr, -depth / 2, 0.012);
  // wire mesh: lathe over the profile for drum + dome, flat disc at the front
  const meshTex = TEX.cageMesh();
  const meshMat = new THREE.MeshStandardMaterial({ map: meshTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, color: 0x2a2c2b, roughness: 0.6, metalness: 0.6 });
  const lathePts = profile.map(p => new THREE.Vector2(p.x, p.y));
  const latheGeo = new THREE.LatheGeometry(lathePts, 72); latheGeo.rotateX(Math.PI / 2);
  const drumTex = meshTex.clone(); drumTex.repeat.set(64, 6); drumTex.needsUpdate = true;
  const drum = new THREE.Mesh(latheGeo, meshMat.clone()); drum.material.map = drumTex; cage.add(drum);
  const discTex = meshTex.clone(); discTex.repeat.set(24, 24); discTex.needsUpdate = true;
  const discMat = meshMat.clone(); discMat.map = discTex;
  const discF = new THREE.Mesh(circleGeo(R, 72), discMat); discF.position.z = -depth / 2; cage.add(discF);
  // cage support frame down to hull
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(cylinderGeo(0.03, 0.03, 1.8, 8), ringMat); post.position.set(sx * 1.05, -1.15 + 0.35, 0); cage.add(post);
    const post2 = post.clone(); post2.position.z = -depth / 2; post2.scale.y = 0.85; post2.position.y = -0.98; cage.add(post2);
    const brace = new THREE.Mesh(cylinderGeo(0.02, 0.02, 1.2, 6), ringMat); brace.position.set(sx * 0.85, -1.1, -0.9); brace.rotation.x = 0.9; brace.rotation.z = sx * 0.3; cage.add(brace);
  }
  const bumper = new THREE.Mesh(boxGeo(2.6, 0.06, 0.06), ringMat); bumper.position.set(0, -R - 0.02, 0); cage.add(bumper);
  const bumper2 = new THREE.Mesh(boxGeo(2.6, 0.06, 0.06), ringMat); bumper2.position.set(0, R + 0.02, 0); cage.add(bumper2);
  // propeller
  const prop = new THREE.Group(); prop.name = 'airboat propeller';
  const hub = new THREE.Mesh(cylinderGeo(0.12, 0.12, 0.2, 16), darkAlu); hub.rotation.x = Math.PI / 2; prop.add(hub);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2f2a22, roughness: 0.5, metalness: 0.3 });
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(boxGeo(0.17, R - 0.12, 0.025), bladeMat);
    blade.position.y = (i === 0 ? 1 : -1) * (R - 0.12) / 2; blade.rotation.y = (i === 0 ? 1 : -1) * 0.35; blade.rotation.z = i === 0 ? 0 : Math.PI;
    prop.add(blade);
  }
  const blur = new THREE.Mesh(circleGeo(R - 0.1, 48), new THREE.MeshBasicMaterial({ color: 0x1a1c1a, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
  blur.name = 'airboat prop blur';
  prop.add(blur);
  cage.add(prop);
  g.add(cage);
  // rudders
  const rudders = [];
  for (const sx of [-0.45, 0.45]) {
    const piv = new THREE.Group(); piv.position.set(sx, 1.8, 3.45);
    piv.name = sx < 0 ? 'airboat rudder port' : 'airboat rudder starboard';
    const r = new THREE.Mesh(boxGeo(0.04, 1.9, 0.62), darkAlu); r.position.z = 0.31; r.castShadow = true; piv.add(r);
    const frame = new THREE.Mesh(boxGeo(0.06, 2.0, 0.06), steel); piv.add(frame);
    g.add(piv); rudders.push(piv);
  }
  const rudderBar = new THREE.Mesh(boxGeo(1.0, 0.04, 0.04), steel); rudderBar.position.set(0, 2.85, 3.6); g.add(rudderBar);
  const rudderBarLo = new THREE.Mesh(boxGeo(1.0, 0.04, 0.04), steel); rudderBarLo.position.set(0, 0.78, 3.6); g.add(rudderBarLo);
  // hangers from the cage frame to the rudder assembly
  for (const sx of [-0.5, 0.5]) for (const y of [0.78, 2.85]) { const h = new THREE.Mesh(cylinderGeo(0.018, 0.018, 1.3, 6), steel); h.rotation.x = Math.PI / 2; h.position.set(sx, y, 2.95); g.add(h); }

  // bow spotlight & cleats
  const light = new THREE.Mesh(cylinderGeo(0.06, 0.08, 0.14, 12), steel); light.rotation.x = Math.PI / 2; light.position.set(0, 0.85, -2.5); g.add(light);
  for (const sx of [-1, 1]) for (const sz of [-2.0, 2.2]) { const c = new THREE.Mesh(boxGeo(0.16, 0.05, 0.05), steel); c.position.set(sx * 1.05, 0.66, sz); g.add(c); }

  g.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow || true; o.receiveShadow = true; } });
  return { group: g, prop, blur, rudders, cage };
}

export function buildAirboat() {
  if (!airboatTemplate) airboatTemplate = createAirboatTemplate();
  const group = airboatTemplate.group.clone(true);
  const prop = group.getObjectByName('airboat propeller');
  const blur = group.getObjectByName('airboat prop blur');
  const cage = group.getObjectByName('airboat cage');
  const rudders = [group.getObjectByName('airboat rudder port'), group.getObjectByName('airboat rudder starboard')];
  // Opacity is driven independently by each engine's RPM; everything else on the template is immutable and shared.
  blur.material = blur.material.clone();
  return { group, prop, blur, rudders, cage };
}

// Photogrammetry-style seated driver (Meshy export). The source is loaded once; clones share its 1K texture,
// geometry and material instead of paying that GPU cost again for every working boat.
let driverTemplatePromise = null;
function driverTemplate() {
  if (!driverTemplatePromise) driverTemplatePromise = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/driver.glb`).then(gltf => {
    const root = gltf.scene; root.name = 'seated driver template';
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mat = o.material; if (mat) { mat.roughness = 0.9; mat.metalness = 0.0; if (mat.map) { mat.map.anisotropy = 8; mat.map.colorSpace = THREE.SRGBColorSpace; } }
    });
    return root;
  });
  return driverTemplatePromise;
}
export function loadDriver(group, { scale = 0.65, position = [0, 1.7, 0.4], yaw = Math.PI } = {}) {
  return driverTemplate().then(root => {
    const m = root.clone(true); m.name = 'seated driver'; m.scale.setScalar(scale); m.rotation.y = yaw; m.position.fromArray(position); m.userData.baseYaw = yaw; group.add(m); return m;
  });
}

// ---------------- physics ----------------
const DRAFT = 0.32; // hull bottom sits this far below the hull reference point
const G = 9.8;

export class AirboatPhysics {
  constructor(terrain, x = 0, z = 60, heading = 0) {
    this.T = terrain;
    this.pos = new THREE.Vector2(x, z);
    this.vel = new THREE.Vector2();
    this.heading = heading; // radians, forward = (-sin h, -cos h)
    this.angVel = 0;
    this.throttle = 0; this.steer = 0; this.rpm = 0;
    this.y = 0; this.vy = 0; // hull reference height (world) and vertical velocity
    this.pitch = 0; this.roll = 0;
    this.pitchVel = 0; this.rollVel = 0;
    this.speed = 0;
    this.wet = 1; this.landFac = 0; this.contact = true; this.airborne = false; this.airTime = 0; this.airPeak = 0;
    this.impact = 0; // vertical landing impact (m/s) on the frame it happens
    this.hit = 0; this.hitNormal = new THREE.Vector2(); // collision speed into an obstacle this frame
    this.surfH = 0; this.prevFloor = null; this.groundH = 0; this.waterH = 0;
    this.grounded = 0; this.bob = 0;
    this.obstacles = []; // [{x,z,r}] or [{ax,az,bx,bz,r}] capsules
    this.trunkGrid = new Map(); this.cell = 10; this.nearTrunks = [];
    this.dyn = new Map(); // keyed obstacle sets that come and go with the streamed world (docks, logs, other boats)
    this.hitTag = ''; this.hitObj = null;
    this.lastFloat = new THREE.Vector2(x, z);
    this.loaded = 0; // passenger / cargo mass factor
    this.towDrag = 0; // extra quadratic drag from something on a rope behind the boat
    this.powerScale = 1; this.steerScale = 1; this.damageLoad = 0; this.damageList = 0; this.damageTrim = 0;
    this.landedFrame = false; this.takeoffFrame = false;
    this.landQuality = ''; // '', 'clean', 'hard', 'stuffed', 'wipeout' on the landing frame
    this.noseIn = 0; this.tailIn = 0; this.wipeT = 0; this.stuffT = 0;
    this.lastSurfVel = 0; this.spinIn = 0;
    this.topSpeed = 0;
    this.current = new THREE.Vector2(); this.waterSpeed = 0;
    this._g = new THREE.Vector2(); this._n = new THREE.Vector2();
  }
  forward(out = new THREE.Vector2()) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); }
  right(out = new THREE.Vector2()) { return out.set(-Math.cos(this.heading), Math.sin(this.heading)); }
  // trunk colliders arrive and leave with the streamed terrain chunks
  addTrunks(key, list) {
    for (const t of list) {
      const k = `${Math.floor(t.x / this.cell)},${Math.floor(t.z / this.cell)}`;
      if (!this.trunkGrid.has(k)) this.trunkGrid.set(k, []);
      this.trunkGrid.get(k).push({ x: t.x, z: t.z, r: t.r, chunk: key });
    }
  }
  removeTrunks(key) {
    for (const [k, l] of this.trunkGrid) {
      let n = 0; for (const t of l) if (t.chunk !== key) l[n++] = t;
      l.length = n; if (!n) this.trunkGrid.delete(k);
    }
  }
  addObs(key, list) { this.dyn.set(key, list); }
  removeObs(key) { this.dyn.delete(key); }
  trunksNear(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.trunkGrid.get(`${cx + i},${cz + j}`); if (l) for (const t of l) out.push(t);
    }
    return out;
  }
  reset(x, z, heading = this.heading) {
    this.pos.set(x, z); this.vel.set(0, 0); this.heading = heading; this.angVel = 0; this.y = 0; this.vy = 0;
    this.pitch = this.roll = this.pitchVel = this.rollVel = 0; this.prevFloor = null; this.airTime = 0; this.airPeak = 0; this.lastFloat.set(x, z);
    this.airborne = false; this.landedFrame = false; this.takeoffFrame = false; this.landQuality = ''; this.wipeT = 0; this.stuffT = 0; this.impact = 0; this.hit = 0;
    this.current.set(0, 0); this.waterSpeed = 0;
  }

  update(dt, input, waveFn, t, flow = null) {
    dt = Math.min(dt, 1 / 30);
    const T = this.T;
    const tgtThrottle = input.throttle; // -0.35..1
    this.throttle += (tgtThrottle - this.throttle) * (1 - Math.exp(-dt * (tgtThrottle > this.throttle ? 2.2 : 4.0)));
    this.steer += (input.steer - this.steer) * (1 - Math.exp(-dt * 6));
    const powerScale = Math.max(0, Math.min(1, this.powerScale ?? 1));
    const rpmTarget = powerScale > 0.01 ? (0.18 + Math.max(0, this.throttle) * 0.82) * Math.max(0.28, powerScale) : 0;
    this.rpm += (rpmTarget - this.rpm) * (1 - Math.exp(-dt * 2.5));

    const fwd = this.forward(), rgt = this.right();
    const massF = 1 + this.loaded * 0.18 + (this.damageLoad || 0);
    this.hit = 0; this.hitTag = ''; this.hitObj = null;

    // ---- support surfaces under the hull ----
    const px = this.pos.x, pz = this.pos.y;
    const hAt = (ox, oz) => T.heightAt(px + rgt.x * ox + fwd.x * (-oz), pz + rgt.y * ox + fwd.y * (-oz));
    const hC = T.heightAt(px, pz), hBow = hAt(0, -2.6), hStern = hAt(0, 2.3);
    const hL = (hAt(-1.1, -1.0) + hAt(-1.1, 1.6)) * 0.5, hR = (hAt(1.1, -1.0) + hAt(1.1, 1.6)) * 0.5;
    const hMean = (hC * 2 + hBow + hStern + hL + hR) / 6;
    const floor = Math.max(hC, hMean) + DRAFT;
    const waterC = waveFn(px, pz, t);
    this.groundH = hC; this.waterH = waterC;
    // the hull rides whichever is higher: the water it floats on or the ground under it. Only that support surface can
    // throw the hull upward - a river bed rising toward the surface under a floating hull is not a ramp
    const support = Math.max(floor, waterC);
    if (this.prevFloor === null) { this.prevFloor = support; if (floor > this.y) this.y = floor; }
    const surfVel = Math.max(-20, Math.min(20, (support - this.prevFloor) / dt));
    this.prevFloor = support; this.surfVel = surfVel; this.floor = floor; this.support = support;

    // ---- vertical dynamics: gravity, buoyancy, ground contact ----
    const sub = Math.max(0, Math.min(2.2, (waterC + DRAFT - this.y) / DRAFT)); // 1 = floating at equilibrium
    const buoy = G * sub * (1 + Math.max(0, sub - 1) * 0.6);
    const ay = -G + buoy / massF - this.vy * (3.8 * Math.min(sub, 1)) - this.vy * 0.04;
    this.vy += ay * dt;
    this.y += this.vy * dt;
    let impact = 0, contact = false;
    const vyBefore = this.vy;
    if (this.y <= floor + 0.005) {
      // only the hull's own downward speed counts as an impact (a ramp rising under a floating hull is not a landing)
      impact = Math.max(0, -this.vy) * Math.min(1, Math.max(0, (this.y - waterC) / 0.6 + 0.2));
      this.y = floor; contact = true;
      if (this.vy < surfVel) this.vy = surfVel + impact * 0.10; // small bounce
    }
    this.contact = contact;
    this.wet = Math.max(0, Math.min(1, (waterC + DRAFT + 0.12 - this.y) / (DRAFT + 0.12)));
    this.landFac = contact ? Math.max(0, Math.min(1, (floor - (waterC + DRAFT * 0.25)) / 0.4)) : 0;
    const wasAir = this.airborne;
    this.airborne = !contact && this.wet <= 0.02;
    this.landedFrame = wasAir && !this.airborne;
    this.takeoffFrame = !wasAir && this.airborne;
    this.hop = this.airborne && this.airTime < 0.25; // little skips off wave tops are not jumps
    if (this.landedFrame) impact = Math.max(impact, Math.max(0, -vyBefore));
    this.impact = impact;
    this.landQuality = '';
    if (this.airborne) { this.airTime += dt; this.airPeak = Math.max(this.airPeak, this.y - Math.max(waterC, floor - DRAFT)); }
    else if (!this.landedFrame) { this.airTime = 0; this.airPeak = 0; } // (landing frame keeps the stats for the trick system)
    if (!this.airborne) this.lastSurfVel = contact ? surfVel : 0;
    this.wipeT = Math.max(0, this.wipeT - dt); this.stuffT = Math.max(0, this.stuffT - dt);
    const wiped = this.wipeT > 0; // spun out after a bad landing: no control for a moment
    // Hydrodynamic forces act on speed through the water, not speed over the ground. At idle this lets a floating hull
    // settle into the tidal stream; the instant it clears the surface, the current stops carrying it through the air.
    const flowScale = this.airborne ? 0 : this.wet;
    const cx = flow ? flow.x * flowScale : 0, cz = flow ? flow.y * flowScale : 0;
    this.current.set(cx, cz);
    const rvx = this.vel.x - cx, rvz = this.vel.y - cz;
    const vf = rvx * fwd.x + rvz * fwd.y, vl = rvx * rgt.x + rvz * rgt.y;
    this.waterSpeed = Math.hypot(rvx, rvz);

    // ---- yaw ----
    const wash = (0.25 + Math.max(this.throttle, 0) * 0.75) * powerScale;
    const wet = this.wet, land = this.landFac;
    const steer = wiped ? 0 : this.steer * (this.steerScale ?? 1);
    // the rudders sit in the prop wash, so an airboat can still yaw with the hull clear of the water (that is how spins work)
    let torque = this.airborne ? steer * 6.0 * wash : steer * (0.8 * wash + Math.abs(vf) * 0.045 * wet);
    torque -= this.angVel * ((this.airborne ? 1.0 : 0.55) + (1.35 + Math.abs(vf) * 0.08) * wet + land * 1.2);
    torque -= vl * 0.045 * wet * (vf >= 0 ? 1 : -1);
    this.angVel += torque * dt;
    this.heading += this.angVel * dt;

    // ---- horizontal forces ----
    const thrust = (wiped ? 0 : (this.throttle > 0 ? this.throttle * 6.6 : this.throttle * 2.5)) * powerScale / massF * (this.airborne ? 0.45 : 1);
    const df = (-vf * Math.abs(vf) * (0.012 + this.towDrag) - vf * 0.12) * wet;
    const dl = (-vl * Math.abs(vl) * 0.22 - vl * 0.9) * wet;
    let ax = fwd.x * (thrust + df) + rgt.x * dl;
    let az = fwd.y * (thrust + df) + rgt.y * dl;
    // air drag
    const sp0 = this.vel.length();
    ax -= this.vel.x * sp0 * 0.012; az -= this.vel.y * sp0 * 0.012;
    // land: friction (wet mud slides, dry grass grabs), sideways scrub, slope gravity
    const grad = T.gradAt(px, pz, this._g);
    if (land > 0.001) {
      const mu = 0.10 + this.smooth(0.2, 2.2, hC) * 0.22 + this.smooth(3.5, 6.5, hC) * 0.45; // wet mud slides; dry grass grabs; the pine flats at the rim of the world bog the hull down
      const dec = mu * G * land;
      if (sp0 > 0.05) { ax -= this.vel.x / sp0 * Math.min(dec, sp0 / dt); az -= this.vel.y / sp0 * Math.min(dec, sp0 / dt); }
      ax -= rgt.x * vl * 2.2 * land; az -= rgt.y * vl * 2.2 * land;
      ax -= G * grad.x * land * 0.9; az -= G * grad.y * land * 0.9;
    }
    this.vel.x += ax * dt; this.vel.y += az * dt;
    // steep bank in the direction of travel acts as a wall
    if (contact && sp0 > 0.3) {
      const vx = this.vel.x / sp0, vz = this.vel.y / sp0;
      const along = grad.x * vx + grad.y * vz;
      if (along > 0.85) {
        const gl = grad.length() || 1; const nx = -grad.x / gl, nz = -grad.y / gl;
        const into = this.vel.x * nx + this.vel.y * nz;
        if (into < 0) { this.vel.x -= into * nx * 1.3; this.vel.y -= into * nz * 1.3; this.hit = Math.max(this.hit, -into); this.hitNormal.set(nx, nz); }
        this.vel.multiplyScalar(0.6);
      }
    }
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt;
    if (hC < -0.6 && !this.airborne) this.lastFloat.copy(this.pos);
    // map edge
    const lim = WORLD_HALF - 60;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.y) > lim) {
      this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x)); this.pos.y = Math.max(-lim, Math.min(lim, this.pos.y)); this.vel.multiplyScalar(0.5);
    }

    // ---- obstacles: dock, tower, tree trunks ----
    const circles = [[0, -1.7, 1.2], [0, 0, 1.3], [0, 1.6, 1.25]];
    const resolve = (cx, cz, r, o = null) => {
      for (const [ox, oz, cr] of circles) {
        const hx = this.pos.x + fwd.x * (-oz), hz = this.pos.y + fwd.y * (-oz);
        const dx = hx - cx, dz = hz - cz; const dd = Math.hypot(dx, dz); const R = r + cr;
        if (dd >= R) continue;
        const nx = dx / (dd || 1), nz = dz / (dd || 1);
        const pen = R - dd;
        this.pos.x += nx * pen; this.pos.y += nz * pen;
        const into = this.vel.x * nx + this.vel.y * nz;
        if (into < 0) {
          this.vel.x -= into * nx * 1.35; this.vel.y -= into * nz * 1.35;
          if (-into >= this.hit) { this.hit = -into; this.hitNormal.set(nx, nz); this.hitTag = o && o.tag || ''; this.hitObj = o; }
          if (o && o.onHit) o.onHit(-into, nx, nz, this);
          // glance: spin the hull about the contact point
          const lx = hx - this.pos.x, lz = hz - this.pos.y;
          this.angVel += (lx * (-into * nz) - lz * (-into * nx)) * 0.12;
          this.vel.multiplyScalar(0.82);
        }
      }
    };
    const obs = (o) => {
      let cx = o.x, cz = o.z;
      if (o.ax !== undefined) { // capsule segment
        const abx = o.bx - o.ax, abz = o.bz - o.az; const l2 = abx * abx + abz * abz;
        let tt = ((this.pos.x - o.ax) * abx + (this.pos.y - o.az) * abz) / (l2 || 1); tt = Math.max(0, Math.min(1, tt));
        cx = o.ax + abx * tt; cz = o.az + abz * tt;
      }
      if (Math.abs(cx - this.pos.x) > 12 || Math.abs(cz - this.pos.y) > 12) return;
      resolve(cx, cz, o.r, o);
    };
    for (const o of this.obstacles) obs(o);
    for (const l of this.dyn.values()) for (const o of l) obs(o);
    const near = this.trunksNear(this.pos.x, this.pos.y, this.nearTrunks);
    for (const tr of near) resolve(tr.x, tr.z, tr.r);
    this.speed = this.vel.length();
    this.grounded = land;

    // ---- attitude ----
    const hw = (ox, oz) => waveFn(px + rgt.x * ox + fwd.x * (-oz), pz + rgt.y * ox + fwd.y * (-oz), t);
    const wb = hw(0, -2.5), ws = hw(0, 2.3), wl = hw(-1.1, 0), wr = hw(1.1, 0);
    const wavePitch = Math.atan2(wb - ws, 4.8) * wet, waveRoll = Math.atan2(wr - wl, 2.2) * wet;
    const landPitch = Math.atan2(hBow - hStern, 4.9) * land, landRoll = Math.atan2(hR - hL, 2.2) * land;
    const accelF = thrust + df;
    const surfPitch = wavePitch + landPitch; // slope of whatever the hull is sitting on (bow-up positive)
    let tgtPitch, tgtRoll;
    if (this.airborne) {
      // no aero surfaces: the hull keeps the rotation it left the lip with, drifting slowly toward the flight path,
      // and the driver can lean (S = nose up, W = nose down) to set up the landing
      tgtPitch = Math.atan2(this.vy, Math.max(this.speed, 3)) * 0.25;
      tgtRoll = this.angVel * 0.08;
    } else {
      tgtPitch = accelF * 0.012 * wet + Math.min(vf, 14) * 0.0035 * wet + surfPitch + (this.damageTrim || 0) * wet;
      tgtRoll = -vl * 0.02 * wet + this.angVel * vf * 0.012 + waveRoll + landRoll + (this.damageList || 0) * wet;
    }
    const spring = (v, tgt, vel, k, d) => { const a = (tgt - v) * k - vel * d; return vel + a * dt; };
    if (this.takeoffFrame) {
      // the stern is still on the ramp as the bow clears it: a nose-up pop proportional to how hard the lip was rising
      this.pitchVel += Math.max(0, Math.min(0.8, this.lastSurfVel * 0.1));
      this.spinIn = this.angVel;
      if (this.lastSurfVel > 2.5) this.vy += this.lastSurfVel * 0.08; // the lip
    }
    if (this.airborne) {
      const lean = wiped ? 0 : (input.pitch || 0);
      this.pitchVel += lean * 2.2 * dt;
      this.pitchVel = spring(this.pitch, tgtPitch, this.pitchVel, 1.0, 1.8);
      this.pitch += this.pitchVel * dt;
      this.pitch = Math.max(-0.8, Math.min(0.75, this.pitch));
      this.rollVel = spring(this.roll, tgtRoll, this.rollVel, 6, 2.5); this.roll += this.rollVel * dt;
    } else {
      const kP = this.landedFrame ? 14 : 30, dP = this.landedFrame ? 4 : 6;
      this.pitchVel = spring(this.pitch, tgtPitch, this.pitchVel, kP, dP); this.pitch += this.pitchVel * dt;
      this.rollVel = spring(this.roll, tgtRoll, this.rollVel, 28, 5.5); this.roll += this.rollVel * dt;
    }
    // ---- landing quality: how the hull met the surface decides whether it skips, slams or stuffs the bow ----
    this.surfPitch = surfPitch;
    if (this.landedFrame && this.airTime > 0.25) {
      const noseIn = Math.max(0, surfPitch - this.pitch), tailIn = Math.max(0, this.pitch - surfPitch);
      this.noseIn = noseIn; this.tailIn = tailIn;
      const rollBad = Math.abs(this.roll);
      const onWater = floor < waterC + 0.05; // the ground under the hull is below the surface: a water landing
      let q = 'clean';
      const sp = this.speed;
      if (onWater) {
        if (noseIn > 0.5 && sp > 7) q = 'wipeout';
        else if (noseIn > 0.26 && sp > 5) q = 'stuffed';
        else if (rollBad > 0.9 || impact > 13) q = 'wipeout';
        else if (impact > 9.5 || rollBad > 0.55 || noseIn > 0.16 || tailIn > 0.5 || Math.abs(this.angVel) > 2.8) q = 'hard';
      } else {
        if (noseIn > 0.4 && sp > 6) q = 'wipeout';
        else if (rollBad > 0.75 || impact > 8.5) q = 'wipeout';
        else if (impact > 5 || rollBad > 0.45 || noseIn > 0.18 || Math.abs(this.angVel) > 2.2) q = 'hard';
      }
      if (Math.abs(this.angVel) > 1.5) this.angVel *= 0.45; // the water grabs a spinning hull
      if (q === 'stuffed') {
        // the bow digs in: the water grabs the hull, the stern comes round
        const keep = Math.max(0.3, 1 - noseIn * 1.6);
        this.vel.multiplyScalar(keep); this.vy = Math.max(this.vy, 0.6);
        this.pitchVel -= 2.0 + noseIn * 2.0; this.angVel += (Math.random() < 0.5 ? -1 : 1) * (0.8 + noseIn);
        this.stuffT = 0.7; impact = Math.max(impact, 6 + noseIn * 6);
      } else if (q === 'wipeout') {
        const keep = onWater ? 0.22 : 0.35;
        this.vel.multiplyScalar(keep); this.vy = onWater ? Math.max(this.vy, 0.8) : this.vy;
        this.angVel += (this.angVel >= 0 ? 1 : -1) * (2.2 + Math.random() * 1.2);
        this.pitchVel -= 1.5; this.rollVel += (this.roll >= 0 ? 1 : -1) * 3.0;
        this.wipeT = 1.4; impact = Math.max(impact, 9);
      } else if (q === 'hard') {
        this.vel.multiplyScalar(onWater ? 0.9 : 0.8);
      } else if (tailIn > 0.12 && onWater) {
        // tail-first on the water skips the hull along: a clean, fast landing
        this.vel.multiplyScalar(1.0);
      }
      this.landQuality = q;
      this.impact = impact;
    }
    // landing jolt
    if (impact > 0.5) { this.pitchVel -= impact * 0.35; this.rollVel += (Math.random() - 0.5) * impact * 0.3; }
    // collision jolt: lean away from the trunk / bank you just hit
    if (this.hit > 1.5) { const side = this.hitNormal.dot(rgt); this.rollVel += side * Math.min(this.hit, 8) * 0.16; this.pitchVel -= Math.min(this.hit, 8) * 0.1; }
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.bob = this.y;
  }
  smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
}
