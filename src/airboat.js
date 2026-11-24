import * as THREE from 'three';
import { anchorConstraintForce } from './anchor.js';
import * as TEX from './textures.js';
import { WORLD_HALF } from './heightfield.js';
import { loadModel } from './models.js';
import { STOCK_BOAT_TUNING } from './boatmods.js';
import { installAirboatLivery } from './airboatlivery.js';
import { HullDamageMaterial } from './hulldamage.js';
import { person } from './folk.js';
import { mulberry32 } from './noise.js';
import { registerWetMaterial } from './surfacewetness.js';
import { bottomStrikeSeverity } from './boatdamage.js';
import { instanceStaticChildren } from './staticinstances.js';
import { airboatGrilleTexture, airboatWearTextures, bakeParts, propBladeGeometry } from './airboatdetail.js';

// Boat local frame: +X starboard, +Y up, -Z forward (bow at -Z).
// The player boat and scheduled traffic use the same detailed hull. Keep one immutable render template so its
// expensive cage, hull and texture data live in GPU/JS memory once; each caller still receives its own transform tree.
let airboatTemplate = null;
const EMPTY_WET_SURFACES = Object.freeze([]);
const unit = value => {
  const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

// Rain lays down a continuous film, chine spray reaches the deck only once the hull is moving, and a landing slap
// delivers a one-frame wash. Drying remains deliberately slow in humid shade but picks up with sun and wind.
export function airboatSprayExposure({ speed = 0, wet = 0, rpm = 0 } = {}) {
  const speedN = unit((Number(speed) - 2.5) / 10.5), rpmN = unit((Number(rpm) - 0.15) / 0.85);
  return unit(wet) * speedN * speedN * (0.35 + rpmN * 0.65);
}

export function airboatWetnessStep(current = 0, { rain = 0, spray = 0, splash = 0, wind = 0, daylight = 0, dt = 0 } = {}) {
  let next = unit(current);
  const seconds = Math.max(0, Math.min(0.25, Number.isFinite(Number(dt)) ? Number(dt) : 0));
  if (!seconds) return next;
  const rainN = unit(rain), sprayN = unit(spray), splashN = unit(splash);
  const deposition = 1 - Math.exp(-seconds * (rainN * 1.05 + sprayN * 0.65));
  next += (1 - next) * deposition;
  if (splashN) next += (1 - next) * splashN * 0.72;
  const windN = unit((Number(wind) || 0) / 36);
  const dryRate = (0.003 + unit(daylight) * 0.0045 + windN * 0.0065) * (1 - rainN) * (1 - sprayN * 0.82);
  return unit(next - seconds * dryRate);
}

// Clone each unique PBR material once for the player only. Geometry and texture references remain shared with the
// immutable traffic template, while the retained records let every frame update uniforms without a scene traversal.
export function prepareAirboatWetSurfaces(group) {
  if (!group?.traverse) return EMPTY_WET_SURFACES;
  const clones = new Map(), damageClones = new Map(), surfaces = [];
  const wetMaterial = (original, damageSurface = false) => {
    if (!original?.isMeshStandardMaterial) return original;
    const registry = damageSurface ? damageClones : clones;
    const found = registry.get(original); if (found) return found.material;
    const material = original.clone(), metalness = unit(material.metalness), dryRoughness = unit(material.roughness);
    const record = {
      material, damageSurface,
      dryRoughness,
      minRoughness: Math.min(dryRoughness, 0.16),
      roughnessDrop: 0.44 + (1 - metalness) * 0.18,
      dryEnvMapIntensity: Number.isFinite(material.envMapIntensity) ? material.envMapIntensity : 1,
      envLift: 0.28 + metalness * 0.4,
      dryR: material.color.r, dryG: material.color.g, dryB: material.color.b,
      colorDarkening: 0.035 + (1 - metalness) * Math.max(0.35, dryRoughness) * 0.16,
      dryNormalX: material.normalMap ? material.normalScale.x : 0,
      dryNormalY: material.normalMap ? material.normalScale.y : 0,
    };
    registry.set(original, record); surfaces.push(record); return material;
  };
  group.traverse(object => {
    if (!object.isMesh) return;
    const damageSurface = object.userData.hullDamageSurface === true;
    if (Array.isArray(object.material)) object.material = object.material.map(material => wetMaterial(material, damageSurface));
    else object.material = wetMaterial(object.material, damageSurface);
  });
  return surfaces;
}

export function setAirboatWetness(boat, value = 0) {
  const wetness = unit(value), surfaces = boat?.wetSurfaceMaterials || EMPTY_WET_SURFACES;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i], material = s.material;
    material.roughness = Math.max(s.minRoughness, s.dryRoughness * (1 - s.roughnessDrop * wetness));
    material.envMapIntensity = s.dryEnvMapIntensity * (1 + s.envLift * wetness);
    const shade = 1 - s.colorDarkening * wetness;
    material.color.setRGB(s.dryR * shade, s.dryG * shade, s.dryB * shade);
    if (material.normalMap) {
      const film = 1 - wetness * 0.16;
      material.normalScale.set(s.dryNormalX * film, s.dryNormalY * film);
    }
  }
  if (boat) boat.surfaceWetness = wetness;
  return wetness;
}

export function updateAirboatWetness(boat, conditions) {
  return setAirboatWetness(boat, airboatWetnessStep(boat?.surfaceWetness, conditions));
}

// One player-only line buffer suggests vines and splintered brush wound through the prop disc. It is created once,
// hidden when the cage is clear and never rebuilt as fouling changes.
export function makePropWrapVisual() {
  const turns = 24, positions = new Float32Array(turns * 2 * 3 + 8 * 2 * 3);
  let cursor = 0;
  const point = (x, y, z) => { positions[cursor++] = x; positions[cursor++] = y; positions[cursor++] = z; };
  for (let i = 0; i < turns; i++) {
    const a0 = i / turns * Math.PI * 3.6 - 0.6, a1 = (i + 1) / turns * Math.PI * 3.6 - 0.6;
    const r0 = 0.2 + i / turns * 0.92, r1 = 0.2 + (i + 1) / turns * 0.92;
    point(Math.cos(a0) * r0, Math.sin(a0) * r0, -0.035); point(Math.cos(a1) * r1, Math.sin(a1) * r1, -0.035);
  }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + 0.23, bend = 0.15 * Math.sin(i * 2.7);
    point(Math.cos(a) * 1.08, Math.sin(a) * 1.08, -0.045);
    point(Math.cos(a + 1.72) * (0.31 + bend), Math.sin(a + 1.72) * (0.31 + bend), -0.055);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.computeBoundingSphere();
  const material = new THREE.LineBasicMaterial({ color: 0x83734a, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: true });
  const wrap = new THREE.LineSegments(geometry, material); wrap.name = 'airboat prop wrap'; wrap.visible = false; wrap.renderOrder = 4;
  return wrap;
}

// Persistent world airboats share the immutable template's PBR materials, so one global storm-film registration
// makes every copy react to rain, hail and dew without per-boat clones. The player keeps its independent spray film.
export function registerAirboatEnvironmentWetness(group) {
  if (!group?.traverse || group.userData?.airboatDynamicWetness) return 0;
  const materials = new Set();
  group.traverse(object => {
    if (!object.isMesh || !object.material) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    for (let i = 0; i < source.length; i++) {
      const material = source[i];
      if (!material?.isMeshStandardMaterial || materials.has(material)) continue;
      materials.add(material); registerWetMaterial(material);
    }
  });
  group.userData.airboatEnvironmentWetSurfaces = materials.size;
  return materials.size;
}

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
  // A unit cylinder stretched between two points. Only used for parts that are baked or batched, never mirrored.
  const strutTo = new THREE.Vector3(), strutUp = new THREE.Vector3(0, 1, 0);
  const strut = (parent, ax, ay, az, bx, by, bz, radius, sides = 8) => {
    strutTo.set(bx - ax, by - ay, bz - az); const length = strutTo.length();
    const m = new THREE.Mesh(cylinderGeo(radius, radius, 1, sides)); m.scale.set(1, length, 1);
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.quaternion.setFromUnitVectors(strutUp, strutTo.normalize());
    parent.add(m); return m;
  };
  const part = (parent, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };

  // One shared weathering pair (grime runs, tannin staining, bright scratches) tints every working part. The base
  // roughness values below are scaled by the map's 0.4-1.0 green channel.
  const wear = airboatWearTextures();
  const worn = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ map: wear.map, roughnessMap: wear.roughnessMap, color, roughness, metalness });
  const darkAlu = worn(0x3a3d3c, 0.62, 0.72);
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6d6a, roughness: 0.35, metalness: 0.9 });
  const galv = worn(0xaeb1ab, 0.6, 0.82);
  const bareAlu = worn(0x9a9d98, 0.68, 0.7);
  const castAlu = worn(0x85877f, 0.82, 0.55);
  const enamel = worn(0x6b2f24, 0.78, 0.22);
  const exhaustMat = worn(0x4f4136, 1.0, 0.5);
  const rudderPaint = worn(0x343734, 0.85, 0.35);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1c1b, roughness: 0.9, metalness: 0.0 });
  const seatMat = worn(0x2c2d2b, 1.0, 0.0);
  const reflectorMat = new THREE.MeshStandardMaterial({ color: 0x8a1a10, roughness: 0.3, metalness: 0.0 });

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
  // hull: welded aluminium panels with rivet rows (map + normal + roughness), polymer slick bottom, spray chines.
  // Traffic liveries recolour by this exact base hex, so wear lives in the maps rather than the colour.
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
  const hull = new THREE.Mesh(hullGeo, hullMat); hull.name = 'airboat hull'; hull.userData.hullDamageSurface = true;
  hull.castShadow = true; hull.receiveShadow = true; g.add(hull);
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
  // gunwale rub-rails (rounded, pale polymer) + inner lip; a matching strip closes the transom
  const rubMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.7, metalness: 0.05 });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(capsuleGeo(0.045, 4.2, 4, 10), rubMat); rail.rotation.x = Math.PI / 2; rail.position.set(sx * 1.24, 0.6, 0.1); g.add(rail);
    const lip = new THREE.Mesh(boxGeo(0.06, 0.09, 4.3), darkAlu); lip.position.set(sx * 1.16, 0.66, 0.1); g.add(lip);
  }
  const sternRub = new THREE.Mesh(capsuleGeo(0.045, 2.32, 4, 10), rubMat); sternRub.rotation.z = Math.PI / 2; sternRub.position.set(0, 0.6, 2.5); g.add(sternRub);
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
  const footrest = new THREE.Mesh(boxGeo(0.9, 0.04, 0.6), deckMat); footrest.position.set(0, 1.03, -0.05); footrest.castShadow = true; g.add(footrest);
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.28, 0.2]) { const p = new THREE.Mesh(cylinderGeo(0.03, 0.03, 0.41, 8), steel); p.position.set(sx, 0.825, sz); g.add(p); }
  const seatBack = new THREE.Mesh(boxGeo(0.6, 0.5, 0.08), seatMat); seatBack.position.set(0, 1.86, 0.92); seatBack.castShadow = true; g.add(seatBack);
  for (const sx of [-0.25, 0.25]) { const p = new THREE.Mesh(cylinderGeo(0.02, 0.02, 0.6, 8), steel); p.position.set(sx, 1.55, 0.92); g.add(p); }
  // control stick on the left, reaching the driver's hand
  const stick = new THREE.Mesh(cylinderGeo(0.018, 0.018, 0.85, 8), steel); stick.position.set(-0.4, 1.75, 0.1); stick.rotation.z = -0.35; stick.rotation.x = 0.25; g.add(stick);
  const stickBase = new THREE.Mesh(boxGeo(0.1, 0.5, 0.1), darkAlu); stickBase.position.set(-0.55, 1.2, 0.2); g.add(stickBase);

  // engine: faded enamel block, cast heads and air cleaner, and the belt reduction drive that lifts the crank up to
  // the prop shaft. The redrive sits right behind the hub, so it is the machinery the chase camera sees through the guard.
  const eng = new THREE.Group(); eng.position.set(0, 1.05, 1.75);
  const block = new THREE.Mesh(boxGeo(0.75, 0.55, 0.7), enamel); block.castShadow = true; eng.add(block);
  const sump = new THREE.Mesh(boxGeo(0.6, 0.14, 0.62), castAlu); sump.position.set(0, -0.33, 0); eng.add(sump);
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(boxGeo(0.28, 0.32, 0.72), castAlu); head.position.set(sx * 0.3, 0.4, 0); head.rotation.z = -sx * 0.5; eng.add(head);
    const cover = new THREE.Mesh(boxGeo(0.2, 0.07, 0.66), enamel); cover.position.set(sx * 0.39, 0.53, 0); cover.rotation.z = -sx * 0.5; eng.add(cover);
  }
  const intake = new THREE.Mesh(cylinderGeo(0.1, 0.13, 0.14, 16), castAlu); intake.position.set(0, 0.56, -0.12); eng.add(intake);
  const filter = new THREE.Mesh(cylinderGeo(0.21, 0.21, 0.1, 28), rubber); filter.position.set(0, 0.68, -0.12); eng.add(filter);
  const filterLid = new THREE.Mesh(cylinderGeo(0.225, 0.225, 0.025, 28), steel); filterLid.position.set(0, 0.745, -0.12); eng.add(filterLid);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(cylinderGeo(0.035, 0.035, 0.5, 8), exhaustMat); pipe.position.set(sx * 0.5, 0.05 - i * 0.02, -0.25 + i * 0.16); pipe.rotation.z = sx * 0.9; eng.add(pipe);
  }
  const shaft = new THREE.Mesh(cylinderGeo(0.06, 0.06, 0.55, 12), steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(0, 0.75, 0.5); eng.add(shaft);
  const redriveParts = new THREE.Group();
  part(redriveParts, cylinderGeo(0.22, 0.22, 0.12, 28), 0, 0.75, 0.29, Math.PI / 2);
  part(redriveParts, cylinderGeo(0.12, 0.12, 0.12, 20), 0, 0.12, 0.29, Math.PI / 2);
  part(redriveParts, boxGeo(0.26, 0.62, 0.11), 0, 0.43, 0.29);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; part(redriveParts, cylinderGeo(0.018, 0.018, 0.04, 6), Math.cos(a) * 0.16, 0.75 + Math.sin(a) * 0.16, 0.36, Math.PI / 2); }
  const redrive = new THREE.Mesh(bakeParts(redriveParts), castAlu); redrive.name = 'airboat redrive'; eng.add(redrive);
  const engMount = new THREE.Mesh(boxGeo(0.9, 0.12, 0.9), darkAlu); engMount.position.set(0, -0.35, 0); eng.add(engMount);
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.4, 0.4]) { const p = new THREE.Mesh(cylinderGeo(0.03, 0.03, 0.4, 8), steel); p.position.set(sx, -0.55, sz); eng.add(p); }
  g.add(eng);
  // Twin stacks rise from the headers and end just under the cage crown, where the condition plume already spawns.
  const stackParts = new THREE.Group();
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.52, 1.26, 1.86), new THREE.Vector3(sx * 0.6, 1.5, 1.8), new THREE.Vector3(sx * 0.46, 1.98, 1.7),
      new THREE.Vector3(sx * 0.32, 2.42, 1.68), new THREE.Vector3(sx * 0.3, 2.94, 1.68),
    ]);
    stackParts.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.045, 8, false)));
    part(stackParts, cylinderGeo(0.056, 0.056, 0.07, 10), sx * 0.3, 2.92, 1.68);
    part(stackParts, cylinderGeo(0.07, 0.07, 0.03, 10), sx * 0.49, 1.36, 1.83, 0, 0, sx * 0.9);
  }
  const stacks = new THREE.Mesh(bakeParts(stackParts), exhaustMat); stacks.name = 'airboat exhaust stacks'; g.add(stacks);
  stackParts.traverse(o => { if (o.isMesh && o.geometry.type === 'TubeGeometry') o.geometry.dispose(); });

  // fuel tanks: bare welded aluminium with filler caps and a fuel line toward the engine
  const tanks = new THREE.Group(); tanks.name = 'airboat fuel tanks'; tanks.position.set(0, 0.645, 1.9);
  for (const sx of [-1, 1]) {
    const tank = new THREE.Mesh(boxGeo(0.6, 0.35, 0.6), bareAlu); tank.position.set(sx * 0.7, 0.175, 0); tank.castShadow = true; tanks.add(tank);
    const cap = new THREE.Mesh(cylinderGeo(0.055, 0.055, 0.05, 12), steel); cap.position.set(sx * 0.84, 0.375, -0.16); tanks.add(cap);
    const strap = new THREE.Mesh(boxGeo(0.64, 0.02, 0.05), rubber); strap.position.set(sx * 0.7, 0.355, 0.15); tanks.add(strap);
  }
  g.add(tanks);

  // ---- cage: short drum at the front, deep spherical dome at the back ----
  const cage = new THREE.Group(); cage.name = 'airboat cage'; cage.position.set(0, 1.8, 2.35);
  const R = 1.3, depth = 0.5, domeD = 0.62;
  // dome profile: radius/z as a function of u in [0,1]
  const domePt = (u) => { const a = u * Math.PI / 2; return { r: R * Math.pow(Math.cos(a), 0.78), z: depth / 2 + domeD * Math.sin(a) }; };
  const profile = [new THREE.Vector3(R, -depth / 2, 0), new THREE.Vector3(R, depth / 2, 0)];
  for (let i = 1; i <= 10; i++) { const d = domePt(i / 10); profile.push(new THREE.Vector3(d.r, d.z, 0)); }
  // The whole welded frame (hoops, ribs, face spokes, rear frame, stanchions) is baked into one galvanised mesh.
  const frameParts = new THREE.Group();
  part(frameParts, torusGeo(R, 0.032, 8, 72), 0, 0, -depth / 2); part(frameParts, torusGeo(R, 0.032, 8, 72), 0, 0, depth / 2);
  for (const u of [0.2, 0.38, 0.55, 0.7, 0.83, 0.93]) { const d = domePt(u); part(frameParts, torusGeo(d.r, 0.015, 5, 48), 0, 0, d.z); }
  const apex = domePt(0.975); part(frameParts, torusGeo(apex.r + 0.02, 0.02, 6, 24), 0, 0, apex.z);
  // ribs: run straight along the drum then curve in over the dome to the apex
  const barPts = profile.map(p => new THREE.Vector3(p.x, 0, p.y)); barPts.push(new THREE.Vector3(0, 0, depth / 2 + domeD + 0.01));
  const barGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts, false, 'centripetal', 0.5), 18, 0.014, 5, false);
  for (let i = 0; i < 36; i++) part(frameParts, barGeo, 0, 0, 0, 0, 0, (i / 36) * Math.PI * 2);
  // front face: radial spokes + inner rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    part(frameParts, cylinderGeo(0.012, 0.012, R, 6), Math.cos(a) * R / 2, Math.sin(a) * R / 2, -depth / 2, 0, 0, a + Math.PI / 2);
  }
  for (const rr of [0.5, 0.95]) part(frameParts, torusGeo(rr, 0.012, 6, 56), 0, 0, -depth / 2);
  // rear frame: tall corner posts tangent to the hoops, a top rail for the marker lights and a deck crossbar
  const deckY = 0.64 - 1.8, postX = R + 0.01;
  for (const sx of [-1, 1]) {
    strut(frameParts, sx * postX, deckY, depth / 2, sx * postX, R + 0.04, depth / 2, 0.03);
    strut(frameParts, sx * postX, deckY, -depth / 2, sx * postX, 0.15, -depth / 2, 0.026);
    strut(frameParts, sx * postX, -0.35, -depth / 2, sx * 1.08, deckY, -1.25, 0.022);
    strut(frameParts, sx * 1.0, deckY, -depth / 2, sx * 1.0, -Math.sqrt(R * R - 1.0) + 0.02, -depth / 2, 0.022);
    part(frameParts, boxGeo(0.12, 0.02, 0.6), sx * postX, deckY + 0.01, 0);
  }
  strut(frameParts, -postX, R + 0.04, depth / 2, postX, R + 0.04, depth / 2, 0.028);
  strut(frameParts, -postX, deckY + 0.05, depth / 2, postX, deckY + 0.05, depth / 2, 0.03);
  strut(frameParts, -postX, deckY + 0.05, -depth / 2, postX, deckY + 0.05, -depth / 2, 0.03);
  const cageFrame = new THREE.Mesh(bakeParts(frameParts), galv); cageFrame.name = 'airboat cage frame'; cage.add(cageFrame);
  barGeo.dispose();
  for (const sx of [-1, 1]) { const lens = new THREE.Mesh(boxGeo(0.07, 0.05, 0.07), reflectorMat); lens.position.set(sx * postX, R + 0.09, depth / 2); cage.add(lens); }
  // Fine welded wire guard over the drum, dome and driver-side face. UVs are re-laid by arc length so every cell is
  // about 6 cm; the texture's dithered mips keep the guard reading as a grey haze at range instead of vanishing.
  const grilleCell = 0.24, lathePts = profile.map(p => new THREE.Vector2(p.x, p.y));
  const latheGeo = new THREE.LatheGeometry(lathePts, 72), latheUv = latheGeo.getAttribute('uv'), arc = [0];
  for (let j = 1; j < lathePts.length; j++) arc.push(arc[j - 1] + lathePts[j].distanceTo(lathePts[j - 1]));
  const aroundRepeat = Math.round(Math.PI * 2 * R / grilleCell);
  for (let i = 0; i <= 72; i++) for (let j = 0; j < lathePts.length; j++) latheUv.setXY(i * lathePts.length + j, i / 72 * aroundRepeat, arc[j] / grilleCell);
  latheGeo.rotateX(Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(R, 72); TEX.scaleTextureUvs(discGeo, 2 * R / grilleCell, 2 * R / grilleCell);
  const grilleParts = new THREE.Group(); part(grilleParts, latheGeo); part(grilleParts, discGeo, 0, 0, -depth / 2);
  const grilleMat = new THREE.MeshStandardMaterial({ map: airboatGrilleTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, color: 0x7d807b, roughness: 0.52, metalness: 0.72 });
  const grille = new THREE.Mesh(bakeParts(grilleParts), grilleMat); grille.name = 'airboat cage grille'; cage.add(grille);
  latheGeo.dispose(); discGeo.dispose();
  // propeller: twisted two-blade laminate with nickel leading edges and painted tips on a bolted hub and spinner
  const prop = new THREE.Group(); prop.name = 'airboat propeller';
  const hubParts = new THREE.Group();
  part(hubParts, cylinderGeo(0.16, 0.16, 0.18, 20), 0, 0, 0, Math.PI / 2);
  part(hubParts, cylinderGeo(0.02, 0.15, 0.2, 20), 0, 0, 0.19, Math.PI / 2);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.26; part(hubParts, cylinderGeo(0.018, 0.018, 0.04, 6), Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.1, Math.PI / 2); }
  const hub = new THREE.Mesh(bakeParts(hubParts), castAlu); hub.name = 'airboat prop hub'; prop.add(hub);
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
  const blades = new THREE.Mesh(propBladeGeometry({ root: 0.13, tip: R - 0.12 }), bladeMat); blades.name = 'airboat prop blades'; prop.add(blades);
  const blur = new THREE.Mesh(circleGeo(R - 0.1, 48), new THREE.MeshBasicMaterial({ color: 0x1a1c1a, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
  blur.name = 'airboat prop blur';
  prop.add(blur);
  cage.add(prop);
  g.add(cage);
  // rudders: aluminium skins on a tube spar with pressed stiffeners; one baked frame geometry serves both
  const rudderFrameParts = new THREE.Group();
  part(rudderFrameParts, cylinderGeo(0.03, 0.03, 2.0, 10));
  part(rudderFrameParts, cylinderGeo(0.016, 0.016, 1.9, 8), 0, 0, 0.62);
  for (const y of [-0.95, 0.95]) part(rudderFrameParts, boxGeo(0.06, 0.04, 0.64), 0, y, 0.31);
  for (const y of [-0.5, 0.02, 0.52]) part(rudderFrameParts, boxGeo(0.055, 0.03, 0.58), 0, y, 0.32);
  const rudderFrameGeo = bakeParts(rudderFrameParts), rudderSkinGeo = boxGeo(0.032, 1.9, 0.6);
  const rudders = [];
  for (const sx of [-0.45, 0.45]) {
    const piv = new THREE.Group(); piv.position.set(sx, 1.8, 3.45);
    piv.name = sx < 0 ? 'airboat rudder port' : 'airboat rudder starboard';
    const r = new THREE.Mesh(rudderSkinGeo, rudderPaint); r.position.z = 0.31; r.castShadow = true; piv.add(r);
    const frame = new THREE.Mesh(rudderFrameGeo, galv); piv.add(frame);
    g.add(piv); rudders.push(piv);
  }
  const rudderBar = new THREE.Mesh(boxGeo(1.0, 0.04, 0.04), steel); rudderBar.position.set(0, 2.85, 3.6); g.add(rudderBar);
  const rudderBarLo = new THREE.Mesh(boxGeo(1.0, 0.04, 0.04), steel); rudderBarLo.position.set(0, 0.78, 3.6); g.add(rudderBarLo);
  // hangers from the cage frame to the rudder assembly
  for (const sx of [-0.5, 0.5]) for (const y of [0.78, 2.85]) { const h = new THREE.Mesh(cylinderGeo(0.018, 0.018, 1.3, 6), galv); h.rotation.x = Math.PI / 2; h.position.set(sx, y, 2.95); g.add(h); }

  // bow spotlight, cleats and transom reflectors
  const light = new THREE.Mesh(cylinderGeo(0.06, 0.08, 0.14, 12), steel); light.rotation.x = Math.PI / 2; light.position.set(0, 0.85, -2.5); g.add(light);
  for (const sx of [-1, 1]) for (const sz of [-2.0, 2.2]) { const c = new THREE.Mesh(boxGeo(0.16, 0.05, 0.05), steel); c.position.set(sx * 1.05, 0.66, sz); g.add(c); }
  for (const sx of [-1, 1]) { const tail = new THREE.Mesh(boxGeo(0.12, 0.05, 0.03), reflectorMat); tail.position.set(sx * 0.95, 0.46, 2.515); g.add(tail); }

  g.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow || true; o.receiveShadow = true; } });
  g.userData.batchedDraws = instanceStaticChildren(g, new Set([prop, ...rudders]));
  return { group: g, prop, blur, rudders, cage };
}

export function buildAirboat({ dynamicWetness = false, initialWetness = 0.06, profile = {} } = {}) {
  if (!airboatTemplate) airboatTemplate = createAirboatTemplate();
  const group = airboatTemplate.group.clone(true);
  const prop = group.getObjectByName('airboat propeller');
  const blur = group.getObjectByName('airboat prop blur');
  const cage = group.getObjectByName('airboat cage');
  const rudders = [group.getObjectByName('airboat rudder port'), group.getObjectByName('airboat rudder starboard')];
  // Opacity is driven independently by each engine's RPM. Ambient boats keep every PBR material shared; only the
  // player requests the small unique set whose roughness and colour respond to rain and spray.
  blur.material = blur.material.clone();
  group.userData.airboatDynamicWetness = dynamicWetness;
  const boat = { group, prop, blur, rudders, cage, propWrap: null, wetSurfaceMaterials: EMPTY_WET_SURFACES, surfaceWetness: 0, hullDamage: null };
  if (dynamicWetness) {
    boat.wetSurfaceMaterials = prepareAirboatWetSurfaces(group);
    const damageSurface = boat.wetSurfaceMaterials.find(surface => surface.damageSurface);
    if (damageSurface) {
      boat.hullDamage = new HullDamageMaterial(damageSurface.material, profile);
      installAirboatLivery(damageSurface.material);
    }
    boat.propWrap = makePropWrapVisual(); prop.add(boat.propWrap);
    setAirboatWetness(boat, initialWetness);
  }
  return boat;
}

// Photogrammetry-style seated driver (Meshy export). The source is loaded once; clones share its 1K texture,
// geometry and material instead of paying that GPU cost again for every working boat.
let driverTemplatePromise = null;
function driverTemplate() {
  if (!driverTemplatePromise) driverTemplatePromise = loadModel('driver').then(root => {
    if (!root) return null;
    root.name = 'seated driver template';
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mat = o.material; if (mat) { mat.roughness = 0.9; mat.metalness = 0.0; if (mat.map) { mat.map.anisotropy = 8; mat.map.colorSpace = THREE.SRGBColorSpace; } }
    });
    return root;
  });
  return driverTemplatePromise;
}
export function createSeatedDriverMount(root, { scale = 0.65, position = [0, 1.7, 0.4], yaw = Math.PI } = {}) {
  // Keep the authored yaw/scale below a boat-local mount. The source is a single static mesh, so this retained
  // mount gives the player a convincing seated-body response without another model, material, draw call or mixer.
  const mount = new THREE.Group(); mount.name = 'seated driver'; mount.position.fromArray(position); mount.userData.baseYaw = 0;
  const model = root.clone(true); model.name = 'seated driver model'; model.scale.setScalar(scale); model.rotation.y = yaw;
  mount.userData.model = model; mount.add(model); return mount;
}

let proceduralDriverSeatResources = null, proceduralDriverSerial = 0;
function fallbackDriverSeatResources() {
  if (!proceduralDriverSeatResources) proceduralDriverSeatResources = {
    cushionGeometry: new THREE.BoxGeometry(0.58, 0.12, 0.52),
    pedestalGeometry: new THREE.CylinderGeometry(0.075, 0.1, 0.5, 8),
    cushionMaterial: new THREE.MeshStandardMaterial({ color: 0x242625, roughness: 0.88 }),
    pedestalMaterial: new THREE.MeshStandardMaterial({ color: 0x4c5150, roughness: 0.4, metalness: 0.72 }),
  };
  return proceduralDriverSeatResources;
}

// Fallback and Performance deliberately skip the optional 563 kB driver GLB. Keep a real operator at the helm on
// those tiers by reusing the jointed resident body resources; only the tiny seat cushion and pedestal are unique.
export function createProceduralDriverMount({ seed = 0x51a7b0a7, position = [0, 1.7, 0.4], yaw = Math.PI } = {}) {
  const root = new THREE.Group(); root.name = 'procedural seated driver root';
  const operator = person(mulberry32(Number(seed) >>> 0), { pose: 'sit', drive: true, hat: true, vest: true });
  operator.name = 'procedural airboat operator';
  // The authored model's mount stays fixed. These child offsets put the hips on the 1.62 m seat and the boots over
  // the existing footrest, letting an eventual GLB swap preserve the whole-body spring state without a visible pop.
  operator.position.set(0, -0.55, -0.22); root.add(operator);
  const resources = fallbackDriverSeatResources();
  const cushion = new THREE.Mesh(resources.cushionGeometry, resources.cushionMaterial); cushion.name = 'procedural driver seat'; cushion.position.set(0, -0.14, -0.3); cushion.castShadow = true; root.add(cushion);
  const pedestal = new THREE.Mesh(resources.pedestalGeometry, resources.pedestalMaterial); pedestal.name = 'procedural driver pedestal'; pedestal.position.set(0, -0.41, -0.3); pedestal.castShadow = true; root.add(pedestal);
  const mount = createSeatedDriverMount(root, { scale: 1, position, yaw });
  mount.userData.fallback = true; mount.userData.operator = mount.userData.model.getObjectByName('procedural airboat operator');
  return mount;
}

export function replaceSeatedDriverModel(mount, root, { scale = 0.65, yaw = Math.PI } = {}) {
  if (!mount?.isGroup || !root) return null;
  const previous = mount.userData.model, model = root.clone(true);
  model.name = 'seated driver model'; model.scale.setScalar(scale); model.rotation.y = yaw;
  if (previous) mount.remove(previous);
  mount.add(model); mount.userData.model = model; mount.userData.operator = null; mount.userData.fallback = false;
  return model;
}

// Installs a visible operator synchronously, then upgrades that same animated mount if the authored model is allowed
// to load. The retained promise is cleared after settlement so low-memory sessions do not keep loader bookkeeping.
export function installDriver(group, options = {}) {
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : 0x51a7b0a7 + proceduralDriverSerial++ * 977;
  const position = options.position || [0, 1.7, 0.4], yaw = Number.isFinite(Number(options.yaw)) ? Number(options.yaw) : Math.PI;
  const mount = createProceduralDriverMount({ seed, position, yaw }); group.add(mount);
  const ready = driverTemplate().then(root => {
    if (root) replaceSeatedDriverModel(mount, root, { scale: options.scale, yaw });
    mount.userData.modelReady = null; return mount;
  }).catch(error => {
    mount.userData.modelReady = null; mount.userData.modelLoadFailed = true;
    console.warn('driver model upgrade failed', error); return mount;
  });
  mount.userData.modelReady = ready; return mount;
}

export function loadDriver(group, options = {}) {
  return driverTemplate().then(root => {
    if (!root) return null;
    const mount = createSeatedDriverMount(root, options); group.add(mount); return mount;
  });
}

const poseNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const poseClamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Boat-local targets: +pitch braces aft under acceleration, +roll leans to port, and +yaw looks into a port turn.
// `out` is caller-owned because the player pose is evaluated every active frame.
export function seatedDriverPoseTargets(physics = {}, acceleration = 0, out = {}) {
  const steer = poseClamp(poseNumber(physics.steer), -1, 1);
  const turn = poseClamp(steer * 0.34 + poseNumber(physics.angVel) * 0.46, -1, 1);
  const apparentWind = poseClamp(poseNumber(physics.apparentWind) / 50, 0, 1);
  const wipeout = poseClamp(poseNumber(physics.wipeT) / 1.4, 0, 1);
  out.pitch = poseClamp(poseNumber(acceleration) * 0.009 - poseNumber(physics.pitch) * 0.2 - apparentWind * 0.022 - wipeout * 0.035, -0.12, 0.12);
  out.roll = poseClamp(turn * 0.085 - poseNumber(physics.roll) * 0.3, -0.13, 0.13);
  out.yaw = poseClamp(turn * 0.052 + steer * 0.024, -0.08, 0.08);
  out.height = physics.airborne ? -poseClamp(poseNumber(physics.airTime) * 0.008, 0, 0.014) : 0;
  return out;
}

function seatedDriverPoseState(driver, physics) {
  const state = {
    baseX: driver.position.x, baseY: driver.position.y, baseZ: driver.position.z,
    basePitch: driver.rotation.x, baseYaw: driver.rotation.y, baseRoll: driver.rotation.z,
    pitch: 0, roll: 0, yaw: 0, height: 0,
    pitchVelocity: 0, rollVelocity: 0, yawVelocity: 0, heightVelocity: 0,
    acceleration: 0, previousSpeed: poseNumber(physics?.speed), target: { pitch: 0, roll: 0, yaw: 0, height: 0 },
  };
  driver.rotation.order = 'YXZ'; driver.userData.seatedDriverPose = state; return state;
}

function seatedDriverSpring(state, valueKey, velocityKey, target, stiffness, damping, dt, limit) {
  state[velocityKey] += ((target - state[valueKey]) * stiffness - state[velocityKey] * damping) * dt;
  state[valueKey] = poseClamp(state[valueKey] + state[velocityKey] * dt, -limit, limit);
}

// One retained state object and one retained target record are reused for the life of each animated driver. Callers
// apply animation LOD before invoking this for ambient operators, so distant traffic pays no pose update cost.
export function updateSeatedDriverPose(driver, physics = {}, dt = 0, time = 0) {
  if (!driver) return null;
  const step = poseClamp(poseNumber(dt), 0, 0.05);
  const state = driver.userData.seatedDriverPose || seatedDriverPoseState(driver, physics);
  if (!step) return state;

  const speed = Math.max(0, poseNumber(physics.speed));
  const rawAcceleration = poseClamp((speed - state.previousSpeed) / step, -10, 8);
  state.previousSpeed = speed;
  state.acceleration += (rawAcceleration - state.acceleration) * (1 - Math.exp(-step * 4.5));
  seatedDriverPoseTargets(physics, state.acceleration, state.target);

  const impact = Math.max(0, poseNumber(physics.impact)), hit = Math.max(0, poseNumber(physics.hit));
  if (impact > 0.5) {
    state.pitchVelocity -= Math.min(0.24, impact * 0.012);
    state.heightVelocity -= Math.min(0.42, impact * 0.026);
  }
  if (hit > 1.5) {
    state.pitchVelocity -= Math.min(0.4, hit * 0.028);
    const heading = poseNumber(physics.heading), normalX = poseNumber(physics.hitNormal?.x), normalZ = poseNumber(physics.hitNormal?.y);
    const side = normalX * -Math.cos(heading) + normalZ * Math.sin(heading);
    state.rollVelocity -= poseClamp(side * hit * 0.032, -0.34, 0.34);
    state.yawVelocity -= poseClamp(side * hit * 0.016, -0.18, 0.18);
  }

  seatedDriverSpring(state, 'pitch', 'pitchVelocity', state.target.pitch, 42, 11.5, step, 0.17);
  seatedDriverSpring(state, 'roll', 'rollVelocity', state.target.roll, 46, 12.5, step, 0.18);
  seatedDriverSpring(state, 'yaw', 'yawVelocity', state.target.yaw, 36, 10.5, step, 0.11);
  seatedDriverSpring(state, 'height', 'heightVelocity', state.target.height, 68, 14.5, step, 0.035);

  const seconds = poseNumber(time), rpm = poseClamp(poseNumber(physics.rpm), 0, 1);
  const breathing = Math.sin(seconds * 1.2) * 0.0018;
  const enginePulse = Math.sin(seconds * (18 + rpm * 8)) * rpm * 0.0009;
  driver.position.set(state.baseX, state.baseY + state.height + breathing + enginePulse, state.baseZ);
  driver.rotation.set(state.basePitch + state.pitch + enginePulse * 0.45, state.baseYaw + state.yaw, state.baseRoll + state.roll, 'YXZ');
  return state;
}

// ---------------- physics ----------------
const DRAFT = 0.32; // hull bottom sits this far below the hull reference point
const G = 9.8;
const WATER_PROBES = [
  { along: 0, across: 0, area: 0.38 },
  { along: 2.5, across: 0, area: 0.115 },
  { along: -2.3, across: 0, area: 0.125 },
  { along: 0, across: -1.1, area: 0.19 },
  { along: 0, across: 1.1, area: 0.19 },
];
// The forward and aft shares balance their moments on flat water. Use the corresponding
// second moments to scale angular acceleration about the hull reference.
const PITCH_INERTIA = 1.38;
const ROLL_INERTIA = 0.46;
const HULL_COLLISION_CIRCLES = [0, -1.7, 1.2, 0, 0, 1.3, 0, 1.6, 1.25];
const hullHeightAt = (terrain, px, pz, right, forward, ox, oz) => terrain.heightAt(px + right.x * ox + forward.x * (-oz), pz + right.y * ox + forward.y * (-oz));
const springStep = (value, target, velocity, stiffness, damping, dt) => velocity + ((target - value) * stiffness - velocity * damping) * dt;

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
    this.bottomStrike = 0; // fast first contact with a submerged bed
    this.hit = 0; this.hitNormal = new THREE.Vector2(); // collision speed into an obstacle this frame
    this.surfH = 0; this.prevFloor = null; this.groundH = 0; this.waterH = 0;
    this.waterSlopeForward = 0; this.waterSlopeRight = 0;
    this.grounded = 0; this.bob = 0;
    this.obstacles = []; // [{x,z,r}] or [{ax,az,bx,bz,r}] capsules
    this.trunkGrid = new Map(); this.cell = 10; this.nearTrunks = [];
    this.dyn = new Map(); // keyed obstacle sets that come and go with the streamed world (docks, logs, other boats)
    this.hitTag = ''; this.hitObj = null;
    this.lastFloat = new THREE.Vector2(x, z);
    this.loaded = 0; // passenger / mission cargo mass factor
    this.freightLoad = 0; // fish, ice and trade tote
    this.towDrag = 0; // extra quadratic drag from something on a rope behind the boat
    this.tuning = STOCK_BOAT_TUNING;
    this.powerScale = 1; this.steerScale = 1; this.damageLoad = 0; this.damageList = 0; this.damageTrim = 0; this.damageSink = 0;
    this.landedFrame = false; this.takeoffFrame = false;
    this.landQuality = ''; // '', 'clean', 'hard', 'stuffed', 'wipeout' on the landing frame
    this.noseIn = 0; this.tailIn = 0; this.wipeT = 0; this.stuffT = 0;
    this.lastSurfVel = 0; this.spinIn = 0;
    this.topSpeed = 0;
    this.windHeel = 0; this.apparentWind = 0; this.crosswind = 0;
    this.current = new THREE.Vector2(); this.waterSpeed = 0;
    this.anchorConstraint = null;
    this._anchorForce = { x: 0, z: 0, force: 0, load: 0, distance: 0, extension: 0, taut: false };
    this._g = new THREE.Vector2(); this._n = new THREE.Vector2(); this._f = new THREE.Vector2(); this._r = new THREE.Vector2();
    this._waterDepths = new Float64Array(WATER_PROBES.length);
    this._previousWaterHeights = new Float64Array(WATER_PROBES.length);
    this._buoyancy = { lift: 0, pitchMoment: 0, rollMoment: 0 };
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
  resolveCircle(cx, cz, radius, obstacle, forward) {
    for (let i = 0; i < HULL_COLLISION_CIRCLES.length; i += 3) {
      const ox = HULL_COLLISION_CIRCLES[i], oz = HULL_COLLISION_CIRCLES[i + 1], circleRadius = HULL_COLLISION_CIRCLES[i + 2];
      const hx = this.pos.x + forward.x * (-oz) + this._r.x * ox, hz = this.pos.y + forward.y * (-oz) + this._r.y * ox;
      const dx = hx - cx, dz = hz - cz, distance = Math.hypot(dx, dz), combinedRadius = radius + circleRadius;
      if (distance >= combinedRadius) continue;
      const nx = dx / (distance || 1), nz = dz / (distance || 1), penetration = combinedRadius - distance;
      this.pos.x += nx * penetration; this.pos.y += nz * penetration;
      const into = this.vel.x * nx + this.vel.y * nz;
      if (into >= 0) continue;
      this.vel.x -= into * nx * 1.35; this.vel.y -= into * nz * 1.35;
      if (-into >= this.hit) { this.hit = -into; this.hitNormal.set(nx, nz); this.hitTag = obstacle && obstacle.tag || ''; this.hitObj = obstacle; }
      if (obstacle && obstacle.onHit) obstacle.onHit(-into, nx, nz, this);
      // Glancing contact turns the hull about the point that struck the obstacle.
      const lx = hx - this.pos.x, lz = hz - this.pos.y;
      this.angVel += (lx * (-into * nz) - lz * (-into * nx)) * 0.12;
      this.vel.multiplyScalar(0.82);
    }
  }
  resolveObstacle(obstacle, forward) {
    let cx = obstacle.x, cz = obstacle.z;
    if (obstacle.ax !== undefined) {
      const abx = obstacle.bx - obstacle.ax, abz = obstacle.bz - obstacle.az, lengthSq = abx * abx + abz * abz;
      let along = ((this.pos.x - obstacle.ax) * abx + (this.pos.y - obstacle.az) * abz) / (lengthSq || 1);
      along = Math.max(0, Math.min(1, along)); cx = obstacle.ax + abx * along; cz = obstacle.az + abz * along;
    }
    if (Math.abs(cx - this.pos.x) > 12 || Math.abs(cz - this.pos.y) > 12) return;
    this.resolveCircle(cx, cz, obstacle.r, obstacle, forward);
  }
  reset(x, z, heading = this.heading) {
    if (this.anchorConstraint) this.anchorConstraint.resetRequested = true;
    this.anchorConstraint = null;
    this.pos.set(x, z); this.vel.set(0, 0); this.heading = heading; this.angVel = 0; this.y = 0; this.vy = 0;
    this.speed = 0; this.throttle = 0; this.steer = 0;
    this.pitch = this.roll = this.pitchVel = this.rollVel = 0; this.prevFloor = null; this.lastSurfVel = 0;
    this.airTime = 0; this.airPeak = 0; this.lastFloat.set(x, z);
    this.airborne = false; this.landedFrame = false; this.takeoffFrame = false; this.landQuality = ''; this.wipeT = 0; this.stuffT = 0; this.impact = 0; this.bottomStrike = 0; this.hit = 0;
    this.wet = 1; this.landFac = 0; this.grounded = 0; this.contact = true;
    this.windHeel = 0; this.apparentWind = 0; this.crosswind = 0;
    this.current.set(0, 0); this.waterSpeed = 0;
  }

  sampleBuoyancy(waveFn, t, dt, forward, right, planingLift) {
    const heights = this._previousWaterHeights, depths = this._waterDepths;
    const pitch = Math.sin(this.pitch), roll = Math.sin(this.roll);
    const pitchRate = Math.cos(this.pitch) * this.pitchVel, rollRate = Math.cos(this.roll) * this.rollVel;
    const firstSample = this.prevFloor === null;
    let lift = 0, pitchMoment = 0, rollMoment = 0;
    for (let i = 0; i < WATER_PROBES.length; i++) {
      const { along, across, area } = WATER_PROBES[i];
      const wx = this.pos.x + forward.x * along + right.x * across;
      const wz = this.pos.y + forward.y * along + right.y * across;
      const height = waveFn(wx, wz, t);
      // Physics right points along local -X. Positive render roll lifts the local +X chine.
      const depth = height - (this.y - DRAFT + along * pitch - across * roll);
      const submersion = Math.min(2.2, Math.max(0, depth / DRAFT));
      const waterRate = firstSample ? 0 : Math.max(-1.6, Math.min(1.6, (height - heights[i]) / dt));
      const relativeRate = this.vy + along * pitchRate - across * rollRate - waterRate;
      depths[i] = depth;
      heights[i] = height;
      const pressure = G * submersion * (planingLift + Math.max(0, submersion - 1) * 0.6);
      const force = area * Math.max(0, pressure - relativeRate * 3.8 * Math.min(1, submersion));
      lift += force;
      pitchMoment += along * force;
      rollMoment -= across * force;
    }
    this._buoyancy.lift = lift;
    this._buoyancy.pitchMoment = pitchMoment;
    this._buoyancy.rollMoment = rollMoment;
    this.waterSlopeForward = (heights[1] - heights[2]) / 4.8;
    this.waterSlopeRight = (heights[4] - heights[3]) / 2.2;
    return heights[0];
  }

  update(dt, input, waveFn, t, flow = null) {
    dt = Math.min(dt, 1 / 30);
    if (!(dt > 0)) return;
    const T = this.T;
    const tgtThrottle = input.throttle; // -0.35..1
    this.throttle += (tgtThrottle - this.throttle) * (1 - Math.exp(-dt * (tgtThrottle > this.throttle ? 2.2 : 4.0)));
    this.steer += (input.steer - this.steer) * (1 - Math.exp(-dt * 6));
    const powerScale = Math.max(0, Math.min(1, this.powerScale ?? 1));
    const rpmTarget = powerScale > 0.01 ? (0.18 + Math.max(0, this.throttle) * 0.82) * Math.max(0.28, powerScale) : 0;
    this.rpm += (rpmTarget - this.rpm) * (1 - Math.exp(-dt * 2.5));

    const fwd = this.forward(this._f), rgt = this.right(this._r);
    const tune = this.tuning;
    const massF = tune.mass + (this.loaded + this.freightLoad) * 0.18 + (this.damageLoad || 0), previousGrounded = this.grounded;
    this.hit = 0; this.hitTag = ''; this.hitObj = null; this.bottomStrike = 0;

    // ---- support surfaces under the hull ----
    const px = this.pos.x, pz = this.pos.y;
    const hC = T.heightAt(px, pz), hBow = hullHeightAt(T, px, pz, rgt, fwd, 0, -2.6), hStern = hullHeightAt(T, px, pz, rgt, fwd, 0, 2.3);
    const hL = (hullHeightAt(T, px, pz, rgt, fwd, -1.1, -1.0) + hullHeightAt(T, px, pz, rgt, fwd, -1.1, 1.6)) * 0.5;
    const hR = (hullHeightAt(T, px, pz, rgt, fwd, 1.1, -1.0) + hullHeightAt(T, px, pz, rgt, fwd, 1.1, 1.6)) * 0.5;
    const hMean = (hC * 2 + hBow + hStern + hL + hR) / 6;
    const floor = Math.max(hC, hMean) + DRAFT;
    if (this.prevFloor === null && floor > this.y) this.y = floor;
    const throughWater = (this.vel.x - (flow?.x || 0)) * fwd.x + (this.vel.y - (flow?.y || 0)) * fwd.y;
    const planingLift = 1 + 0.21 * this.smooth(5, 13, throughWater);
    const waterC = this.sampleBuoyancy(waveFn, t, dt, fwd, rgt, planingLift);
    this.groundH = hC; this.waterH = waterC;
    // the hull rides whichever is higher: the water it floats on or the ground under it. Only that support surface can
    // throw the hull upward - a river bed rising toward the surface under a floating hull is not a ramp
    const support = Math.max(floor, waterC);
    if (this.prevFloor === null) this.prevFloor = support;
    const surfVel = Math.max(-20, Math.min(20, (support - this.prevFloor) / dt));
    this.prevFloor = support; this.surfVel = surfVel; this.floor = floor; this.support = support;

    // ---- vertical dynamics: gravity, buoyancy, ground contact ----
    const previousY = this.y;
    const ay = -G + this._buoyancy.lift / massF - this.vy * 0.04;
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
    // The next attitude step has not happened yet. Apply only the heave and ground
    // correction to the cached depths to tell whether any part of the hull has touched.
    const rise = this.y - previousY;
    let immersed = 0, deepest = 0;
    for (let i = 0; i < WATER_PROBES.length; i++) {
      const depth = Math.max(0, this._waterDepths[i] - rise);
      immersed += depth * WATER_PROBES[i].area;
      deepest = Math.max(deepest, depth);
    }
    this.contact = contact;
    this.landFac = contact ? Math.max(0, Math.min(1, (floor - (waterC + DRAFT * 0.25)) / 0.4)) : 0;
    const wasAir = this.airborne;
    this.airborne = !contact && deepest <= 0.008;
    // The hull already has full lateral grip just before reaching its planing draft.
    this.wet = this.airborne ? 0 : Math.min(1, immersed * planingLift / (DRAFT * 0.96));
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
    this.bottomStrike = tune.bottomStrike * bottomStrikeSeverity(this.waterSpeed, previousGrounded, this.landFac, waterC - Math.max(hC, hMean), hBow - Math.max(hC, hStern));
    const anchor = this.anchorConstraint, anchorForce = this._anchorForce;
    if (anchor?.active && anchor.engaged && this.wet > 0.2 && !this.airborne) {
      anchorConstraintForce(anchor, px + fwd.x * 2.2, pz + fwd.y * 2.2, this.vel.x, this.vel.y, anchorForce);
    } else {
      anchorForce.x = 0; anchorForce.z = 0; anchorForce.force = 0; anchorForce.load = 0; anchorForce.distance = 0; anchorForce.extension = 0; anchorForce.taut = false;
      if (anchor) { anchor.load = 0; anchor.force = 0; anchor.taut = false; }
    }

    // ---- yaw ----
    const wash = (0.25 + Math.max(this.throttle, 0) * 0.75) * powerScale;
    const wet = this.wet, land = this.landFac;
    const steer = wiped ? 0 : this.steer * (this.steerScale ?? 1) * tune.steer;
    // the rudders sit in the prop wash, so an airboat can still yaw with the hull clear of the water (that is how spins work)
    let torque = this.airborne ? steer * 6.0 * wash : steer * (0.8 * wash + Math.abs(vf) * 0.045 * wet);
    torque -= this.angVel * ((this.airborne ? 1.0 : 0.55) + (1.35 + Math.abs(vf) * 0.08) * wet + land * 1.2);
    torque -= vl * 0.045 * wet * (vf >= 0 ? 1 : -1);
    if (anchorForce.taut) torque -= (fwd.x * 2.2 * anchorForce.z - fwd.y * 2.2 * anchorForce.x) * 0.055 / massF;
    this.angVel += torque * dt;
    this.heading += this.angVel * dt;

    // ---- horizontal forces ----
    const thrust = (wiped ? 0 : (this.throttle > 0 ? this.throttle * 6.6 : this.throttle * 2.5)) * powerScale * tune.thrust / massF * (this.airborne ? 0.45 : 1);
    const df = (-vf * Math.abs(vf) * (0.012 * tune.drag + this.towDrag) - vf * 0.12 * tune.drag) * wet;
    const dl = (-vl * Math.abs(vl) * 0.22 - vl * 0.9) * wet * tune.sideGrip;
    let ax = fwd.x * (thrust + df) + rgt.x * dl;
    let az = fwd.y * (thrust + df) + rgt.y * dl;
    ax += anchorForce.x / massF; az += anchorForce.z / massF;
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
    for (const obstacle of this.obstacles) this.resolveObstacle(obstacle, fwd);
    for (const list of this.dyn.values()) for (const obstacle of list) this.resolveObstacle(obstacle, fwd);
    const near = this.trunksNear(this.pos.x, this.pos.y, this.nearTrunks);
    for (const trunk of near) this.resolveCircle(trunk.x, trunk.z, trunk.r, null, fwd);
    this.speed = this.vel.length();
    this.grounded = land;

    // ---- attitude ----
    const landPitch = Math.atan2(hBow - hStern, 4.9), landRoll = Math.atan2(hL - hR, 2.2);
    const accelF = thrust + df;
    const surfPitch = Math.atan(this.waterSlopeForward) * (1 - land) + landPitch * land;
    if (this.takeoffFrame) {
      // the stern is still on the ramp as the bow clears it: a nose-up pop proportional to how hard the lip was rising
      this.pitchVel += Math.max(0, Math.min(0.8, this.lastSurfVel * 0.1));
      this.spinIn = this.angVel;
      if (this.lastSurfVel > 2.5) this.vy += this.lastSurfVel * 0.08; // the lip
    }
    if (this.airborne) {
      // In flight the hull drifts toward the flight path and the driver can set up the landing.
      const tgtPitch = Math.atan2(this.vy, Math.max(this.speed, 3)) * 0.25;
      const tgtRoll = this.angVel * 0.08 + this.windHeel * 0.4;
      const lean = wiped ? 0 : (input.pitch || 0);
      this.pitchVel += lean * 2.2 * dt;
      this.pitchVel = springStep(this.pitch, tgtPitch, this.pitchVel, 1.0, 1.8, dt);
      this.pitch += this.pitchVel * dt;
      this.pitch = Math.max(-0.8, Math.min(0.75, this.pitch));
      this.rollVel = springStep(this.roll, tgtRoll, this.rollVel, 6, 2.5, dt); this.roll += this.rollVel * dt;
    } else {
      const kP = this.landedFrame ? 14 : 30, dP = this.landedFrame ? 4 : 6;
      const pitchTrim = (accelF * 0.012 + Math.min(vf, 14) * 0.0035 + (this.damageTrim || 0)) * wet;
      const rollTrim = (-vl * 0.02 + (this.damageList || 0)) * wet + this.angVel * vf * 0.012 + this.windHeel;
      const waterPitchAcceleration = this._buoyancy.pitchMoment / (PITCH_INERTIA * massF) + kP * pitchTrim - 2 * this.pitchVel;
      const waterRollAcceleration = this._buoyancy.rollMoment / (ROLL_INERTIA * massF) + 33 * rollTrim - 1.7 * this.rollVel;
      const landPitchAcceleration = (landPitch + pitchTrim - this.pitch) * kP - dP * this.pitchVel;
      const landRollAcceleration = (landRoll + rollTrim - this.roll) * 28 - 5.5 * this.rollVel;
      this.pitchVel += (waterPitchAcceleration * (1 - land) + landPitchAcceleration * land) * dt;
      this.rollVel += (waterRollAcceleration * (1 - land) + landRollAcceleration * land) * dt;
      this.pitch += this.pitchVel * dt;
      this.roll += this.rollVel * dt;
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
