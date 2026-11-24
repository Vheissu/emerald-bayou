import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { attachDockResident, updateDockResidents } from './dockresidents.js';
import { bucket, chair, cooler, fishingLine, person, poseSwimmer } from './folk.js';
import { loadAuthoredLanding } from './mulletlanding.js';
import { animateSite } from './sites.js';
import { cageMesh, loadPaintedCypress, plank, scaleTextureUvs } from './textures.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { buildGulfCutBridge, placeFabFenders, updateGulfCutBridge } from './waterfrontbridge.js';
import { buildMooredSkiffs, updateMooredSkiffs } from './mooredskiffs.js';
import { COVE, FISHING_PIERS, GULF_CUT, WATERFRONT_HOUSES, swimmerStep } from './waterfrontlayout.js';

const cabin = waterfrontSurface(0xffffff);
const weatherboards = waterfrontSurface(0xffffff);
const steel = waterfrontSurface(0xffffff, { metalness: 0.43, roughness: 0.65 });
const glass = waterfrontSurface(0xffffff, { roughness: 0.2, metalness: 0.27, emissive: 0xd69f58, emissiveIntensity: 0 });
const greyCanvas = waterfrontSurface(0xffffff, { side: THREE.DoubleSide });
let wetTimber, warning, screenMesh;
const wood = () => wetTimber ??= waterfrontSurface(0xd9cdb4, { map: plank() });

function localGround(terrain, house, x, z) {
  return terrain.hf.compute(house.x + z, house.z - x) - house.floor;
}

function workPorch(group, h, rr, boards, fixtures, panes, roof) {
  const left = -h.width / 2, front = h.depth / 2;
  const railZ = front + 1.86, edge = -0.10, w = edge - left;
  for (const x of [left + 0.13, left + w * 0.52, edge]) {
    addBox(boards, 0x858e79, 0.13, 2.27, 0.13, x, 1.12, railZ);
  }
  addBox(boards, 0x9b9e80, w, 0.096, 0.10, left + w / 2, 2.22, railZ);
  addBox(boards, 0x92907c, w, 0.072, 0.11, left + w / 2, 1.33, railZ);
  addBox(boards, 0x788076, w, 0.32, 0.11, left + w / 2, 0.21, railZ);
  addBox(boards, 0x7f8070, 0.10, 0.32, 1.86, left + 0.13, 0.21, front + 0.93);
  const screening = screenMesh ??= new THREE.MeshStandardMaterial({
    map: cageMesh(), alphaTest: 0.55, side: THREE.DoubleSide, roughness: 0.88, color: 0x5a6255,
  });
  for (const [width, x, z, yaw] of [[w - 0.13, left + w / 2 + 0.08, railZ + 0.015, 0],
    [1.82, left + 0.143, front + 0.924, -Math.PI / 2]]) {
    const net = new THREE.PlaneGeometry(width, 1.84);
    scaleTextureUvs(net, width * 19, 33);
    const mesh = new THREE.Mesh(net, screening);
    mesh.rotation.y = yaw;
    mesh.position.set(x, 1.31, z);
    group.add(mesh);
  }
  // Scrubbing bench, sink and a hanging task light inside the screen room.
  const workX = left + 0.73, workZ = front + 1.06;
  addBox(boards, 0x83908a, 1.53, 0.105, 0.64, workX, 0.91, workZ);
  addBox(fixtures, 0x5f6c68, 1.41, 0.1, 0.45, workX, 0.44, workZ);
  for (const x of [workX - 0.64, workX + 0.64]) for (const z of [workZ - 0.25, workZ + 0.25]) {
    addBox(fixtures, 0x85897a, 0.08, 0.91, 0.075, x, 0.45, z);
  }
  addBox(fixtures, 0x9fa79c, 0.42, 0.115, 0.35, workX - 0.43, 0.96, workZ);
  addBox(fixtures, 0x64716a, 0.31, 0.05, 0.25, workX - 0.43, 1.022, workZ);
  addBox(fixtures, 0xa0a18b, 0.035, 0.25, 0.045, workX - 0.45, 1.15, workZ - 0.25);
  addBox(fixtures, 0x8b8c74, 0.033, 0.035, 0.145, workX - 0.45, 1.255, workZ - 0.195);
  addBox(roof, 0x777f6e, 0.83, 0.093, 0.19, workX, 2.11, workZ + 0.14);
  addBox(panes, 0xab9d76, 0.75, 0.035, 0.11, workX, 2.06, workZ + 0.14);
  for (let i = 0; i < 3; i++) {
    const x = edge - 0.25 - i * 0.17;
    addBeam(fixtures, 0xa08557, new THREE.Vector3(x, 0.07, railZ - 0.45),
      new THREE.Vector3(x - 0.32, 1.78 + i * 0.09, railZ - 0.68), 0.024, 0.024);
  }
  const seat = chair(rr), worker = person(rr, { pose: 'sit', work: true, hat: false });
  seat.position.set(left + 2.12, 0.06, front + 0.96);
  seat.rotation.y = -1.14;
  worker.name = 'Fish-cleaning room resident';
  worker.position.copy(seat.position);
  worker.rotation.y = seat.rotation.y;
  const tote = cooler(rr);
  tote.position.set(edge - 0.4, 0.06, front + 0.38);
  group.add(seat, worker, tote);
  return worker;
}

function buildWaterfrontHouse(h, terrain, rr) {
  const group = new THREE.Group();
  group.name = h.workroom ? 'Gulf Cut fish-cleaning room' : 'Gulf Cut stilt house';
  group.position.set(h.x, h.floor, h.z);
  group.rotation.y = Math.PI / 2;
  const frame = [], boards = [], cladding = [], panes = [], fixtures = [], roof = [];
  const { width: w, depth: d } = h;
  const front = d / 2, back = -front, room = h.workroom ? 2.38 : 2.65;
  const white = 0xbdb8a1, grain = 0xb8a893;

  for (const x of [-w / 2 + 0.35, 0, w / 2 - 0.35]) for (const z of [back + 0.4, 0.1, front + 1.62]) {
    const foot = Math.min(-0.22, localGround(terrain, h, x, z) - 0.48);
    addBox(frame, 0xa7a595, 0.22, -foot, 0.22, x, foot / 2, z);
    if (x !== 0 && z > front) {
      const otherSide = x - Math.sign(x) * 1.55;
      addBeam(frame, 0xa19982, new THREE.Vector3(x, foot * 0.57, z), new THREE.Vector3(otherSide, -0.19, z), 0.14, 0.12);
    }
  }
  for (const x of [-w * 0.42, 0, w * 0.42]) addBox(frame, 0x9e947d, 0.18, 0.27, d + 2.33, x, -0.17, 0.86);
  for (let i = 0; i < Math.ceil((d + 2) / 0.235); i++) {
    addBox(frame, i % 4 === 0 ? 0xd8c9b1 : grain, w + 0.43, 0.12, 0.23, 0, -0.045, back + i * 0.235);
  }
  addBox(boards, h.color, w - 0.15, room, d - 0.15, 0, room / 2, 0);
  const tone = new THREE.Color(), rows = Math.ceil(room / 0.158);
  for (let row = 0; row < rows; row++) {
    const y = 0.078 + row * room / rows, tint = tone.setHex(h.color).multiplyScalar(0.78 + 0.21 * rr()).getHex();
    const siding = (w, d, x, z, side) => {
      const part = new THREE.BoxGeometry(w, room / rows - 0.009, d);
      const uv = part.attributes.uv, p = part.attributes.position;
      const slice = rr();
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, slice + (side ? p.getZ(i) : p.getX(i)) * 0.71, slice * 1.41 + p.getY(i) * 1.48);
      }
      tintGeometry(cladding, part.translate(x, y, z), tint);
    };
    for (const sign of [-1, 1]) {
      siding(w, 0.061, 0, sign * front, false);
      siding(0.057, d, sign * w / 2, 0, true);
    }
  }
  for (const x of [-w / 2, w / 2]) {
    for (const z of [back, front]) addBox(boards, white, 0.13, room, 0.13, x, room / 2, z);
    addBox(frame, 0x8f896f, 0.115, room - 0.12, 0.115, x * 0.97, 1.3, front + 1.68);
  }
  const pane = (x, z, wide) => {
    addBox(boards, white, wide + 0.13, 0.91, 0.1, x, 1.55, z);
    addBox(panes, 0x384b4b, wide, 0.81, 0.081, x, 1.55, z + 0.047);
    addBox(boards, white, wide + 0.21, 0.077, 0.15, x, 1.078, z + 0.065);
    addBox(boards, h.color, wide, 0.045, 0.031, x, 1.57, z + 0.097);
    addBox(boards, h.color, 0.044, 0.82, 0.038, x, 1.55, z + 0.095);
  };
  if (h.workroom) pane(w * 0.1, front + 0.038, 1.91);
  else {
    pane(-w * 0.28, front + 0.038, 1.19);
    pane(w * 0.085, front + 0.038, 1.12);
  }
  const doorX = w * 0.32, doorFace = front + 0.075;
  addBox(boards, white, 0.91, 2.07, 0.098, doorX, 1.05, doorFace);
  addBox(boards, 0x666f5a, 0.73, 1.91, 0.075, doorX, 1.02, doorFace + 0.058);
  addBox(panes, 0x263630, 0.56, 1.26, 0.04, doorX, 1.29, doorFace + 0.097);
  addBox(boards, 0x888e73, 0.74, 0.102, 0.047, doorX, 0.65, doorFace + 0.1);
  addBox(fixtures, 0xc2a881, 0.06, 0.07, 0.06, doorX + 0.28, 0.93, doorFace + 0.14);
  addBox(fixtures, 0x515d56, 0.22, 0.24, 0.10, doorX - 0.65, 1.99, front + 0.097);
  addBox(panes, 0xb2b59b, 0.15, 0.15, 0.12, doorX - 0.65, 1.98, front + 0.139);
  // Broad tin roofs, with a lower porch apron and a gutter into a water butt.
  const pitch = 0.34, edge = w / 2 + 0.32;
  if (h.workroom) {
    const length = d + 2.92;
    for (let x = -edge; x < edge; x += 0.19) {
      const geometry = new THREE.BoxGeometry(0.195, 0.063, length).rotateX(0.1).translate(x, 2.71, 0.91);
      tintGeometry(roof, geometry, tone.setHex(h.roof).multiplyScalar(0.66 + rr() * 0.34).getHex());
      const rib = new THREE.BoxGeometry(0.021, 0.023, length).rotateX(0.1).translate(x - 0.084, 2.747, 0.91);
      tintGeometry(roof, rib, 0x82908b);
    }
    addBox(boards, 0x849287, w + 0.38, 0.51, 0.14, 0, 2.59, back + 0.04);
    addBox(roof, 0x899393, w + 0.74, 0.15, 0.105, 0, 2.29, front + 2.32);
    group.userData.worker = workPorch(group, h, rr, boards, fixtures, panes, roof);
  } else for (const side of [-1, 1]) {
    for (let z = back - 0.3; z < front + 0.4; z += 0.23) {
      const geometry = new THREE.BoxGeometry(edge / Math.cos(pitch) + 0.035, 0.067, 0.238)
        .rotateZ(-side * pitch).translate(side * edge / 2, 2.69 + edge * Math.tan(pitch) / 2, z);
      tintGeometry(roof, geometry, tone.setHex(h.roof).multiplyScalar(0.73 + rr() * 0.3).getHex());
    }
    const gable = new THREE.BufferGeometry();
    const ridge = 2.67 + edge * Math.tan(pitch);
    gable.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 2.6, side * (front - 0.02), w / 2, 2.6,
      side * (front - 0.02), 0, ridge, side * (front - 0.02)], 3));
    gable.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    gable.setIndex(side > 0 ? [0, 1, 2] : [2, 1, 0]);
    gable.computeVertexNormals();
    tintGeometry(boards, gable, h.color);
  }
  for (let x = -w / 2 - 0.21; !h.workroom && x < w / 2 + 0.19; x += 0.22) {
    const geometry = new THREE.BoxGeometry(0.23, 0.052, 2.15).rotateX(0.12).translate(x, 2.43, front + 0.94);
    tintGeometry(roof, geometry, tone.setHex(h.roof).multiplyScalar(0.69 + rr() * 0.24).getHex());
  }
  addBox(fixtures, 0x969688, w + 0.47, 0.12, 0.18, 0, 2.3, front + 2.04);
  addBox(fixtures, 0x879083, 0.065, 2.34, 0.066, w / 2 - 0.5, 1.15, front + 2.05);
  const butt = new THREE.CylinderGeometry(0.34, 0.36, 0.85, 14).translate(w / 2 - 0.5, 0.43, front + 1.54);
  tintGeometry(fixtures, butt, 0x688273);

  const stairX = h.workroom ? w * 0.28 : h.z > 30 ? w * 0.24 : -w * 0.22;
  const stairZ = front + 1.94;
  const stairEnd = stairZ + 3.2, bottom = Math.min(-0.56, localGround(terrain, h, stairX, stairEnd) + 0.03);
  const steps = Math.ceil(-bottom / 0.22);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    addBox(frame, grain, 1.13, 0.11, 3.2 / steps + 0.05, stairX, f * bottom - 0.045, stairZ + f * 3.2);
  }
  for (const side of [-0.52, 0.52]) {
    const x = stairX + side;
    addBeam(frame, 0xa6967c, new THREE.Vector3(x, -0.19, stairZ), new THREE.Vector3(x, bottom - 0.18, stairEnd), 0.15, 0.15);
    addBeam(frame, 0xaf9e88, new THREE.Vector3(x, 0.91, stairZ), new THREE.Vector3(x, bottom + 0.91, stairEnd), 0.075, 0.085);
    for (const f of [0, 0.5, 1]) addBox(frame, 0xbca988, 0.095, 1.03, 0.09, x, f * bottom + 0.43, stairZ + f * 3.2);
  }
  for (const span of [[h.workroom ? -0.05 : -w / 2, stairX - 0.60], [stairX + 0.61, w / 2]]) {
    const [a, b] = span;
    addBox(frame, grain, b - a, 0.076, 0.082, (a + b) / 2, 0.94, stairZ);
    addBox(frame, grain, b - a, 0.11, 0.09, (a + b) / 2, 0.16, stairZ);
    for (let x = a + 0.16; x < b - 0.07; x += 0.38) addBox(frame, 0xb9ab8c, 0.049, 0.8, 0.063, x, 0.54, stairZ);
  }

  if (!h.workroom) {
    const bedX = w / 2 - 0.97, bedZ = front + 0.62;
    addBox(boards, 0x968368, 0.83, 0.076, 0.4, bedX, 0.43, bedZ);
    addBox(boards, 0x9f8e72, 0.83, 0.24, 0.06, bedX, 0.59, bedZ - 0.21);
    for (const x of [bedX - 0.33, bedX + 0.33]) addBox(boards, 0x867355, 0.05, 0.42, 0.34, x, 0.21, bedZ);
  }
  group.add(waterfrontMesh(frame, wood()), waterfrontMesh(boards, cabin), waterfrontMesh(cladding, weatherboards), waterfrontMesh(panes, glass, false),
    waterfrontMesh(roof, steel), waterfrontMesh(fixtures, steel));
  return group;
}

function buildFishingPier(pier, terrain, rr) {
  const group = new THREE.Group(), support = [], flooring = [], metal = [];
  group.name = 'Fishing pier';
  const { x, head, z, deck } = pier;
  const length = head - x, backX = head - 3.55;
  for (let along = x + 0.25; along < head + 0.1; along += 2.55) for (const side of [-1, 1]) {
    const oz = side * (along > backX ? 1.32 : 0.64);
    const foot = Math.min(deck - 0.25, terrain.hf.compute(along, z + oz) - 0.55);
    const pile = new THREE.CylinderGeometry(0.11, 0.135, deck - foot, 8, 5).translate(along, (deck + foot) / 2, z + oz);
    tintGeometry(support, pile, 0xa3977a, (u, y) => 0.65 + 0.35 * THREE.MathUtils.smoothstep(y, 0.03, 0.5));
  }
  addBox(support, 0x9c8872, length + 0.88, 0.17, 1.72, x + length / 2, deck - 0.18, z);
  const planks = [0xc8b79d, 0xb9ae91, 0xb4aa96, 0xd0c0a7];
  for (let a = x; a < backX - 0.1; a += 0.23) {
    addBox(support, planks[Math.floor(rr() * planks.length)], 0.217, 0.1, 1.91, a, deck - 0.05, z);
  }
  for (let a = backX; a < head + 0.3; a += 0.195) {
    addBox(flooring, planks[Math.floor(rr() * planks.length)], 0.185, 0.095, 3.17, a, deck - 0.0475, z);
  }
  for (const side of [-1, 1]) {
    for (let a = x + 0.15; a < backX - 0.1; a += 1.88) addBox(support, 0xa59980, 0.094, 0.94, 0.095, a, deck + 0.47, z + side * 0.93);
    addBox(support, 0xb0a088, backX - x, 0.08, 0.078, (x + backX) / 2, deck + 0.91, z + side * 0.93);
  }
  // An open rail section at the head is low enough to cast over or sit on.
  for (const side of [-1, 1]) {
    addBox(support, 0xaa9679, 3.92, 0.12, 0.09, head - 1.6, deck + 0.46, z + 1.5 * side);
    for (const along of [head - 2.7, head - 0.02]) addBox(support, 0xaa9679, 0.106, 0.56, 0.091, along, deck + 0.25, z + side * 1.5);
  }
  addBox(support, 0x8e7d65, 0.22, 0.12, 2.45, x + 2.3, deck + 2.27, z);
  for (const offset of [-1, 1]) addBox(support, 0x9d8b71, 0.14, 2.36, 0.14, x + 2.3, deck + 1.14, z + offset * 0.91);
  const roof = new THREE.BoxGeometry(3.75, 0.08, 2.42).rotateX(0.12).translate(x + 1.7, deck + 2.31, z);
  tintGeometry(metal, roof, 0x737e76);
  addBox(metal, 0x7f8178, 3.8, 0.12, 0.07, x + 1.7, deck + 2.18, z + 1.225);

  const deckFallback = waterfrontMesh(flooring, wood());
  deckFallback.name = 'Fishing pier floor';
  group.add(waterfrontMesh(support, wood()), deckFallback, waterfrontMesh(metal, steel));
  for (const [along, side] of [[head - 1.6, -0.71], [head - 2.75, 0.61]]) {
    const gear = side > 0 ? cooler(rr) : bucket();
    gear.position.set(along, deck, z + side);
    gear.rotation.y = 0.2 + rr() * 4;
    group.add(gear);
  }
  return { group, deckFallback };
}

function addAngler(pier, owner, root, rr, side) {
  const { x, head, z, deck } = pier;
  const p = person(rr, { pose: side > 0 ? 'stand' : 'sitEdge', rod: true, hat: true });
  p.name = 'Gulf Cut angler';
  p.position.set(head - 0.34, deck, z + side * 0.71);
  p.rotation.y = Math.PI / 2 + side * 0.09;
  owner.add(p);
  const line = fishingLine();
  line.visible = false;
  root.add(line);
  p.userData.line = line;
  p.userData.lineTarget = new THREE.Vector3();
  p.userData.castCd = side > 0 ? 1.4 : 6;
  const shelter = x + 2.3;
  attachDockResident(p, [p.position, new THREE.Vector3(head - 1.5, deck, z), new THREE.Vector3(shelter, deck, z),
    new THREE.Vector3(shelter, deck, z + side * 0.38)]);
  root.userData.people.push(p);
  root.userData.dockResidents.push(p);
}

function createBuoy(geo) {
  const color = [0xff862f, 0xf0e2c4, 0xff862f];
  const points = [[0.095, -0.16], [0.168, -0.115], [0.199, -0.034], [0.199, 0.07],
    [0.154, 0.146], [0.109, 0.19], [0.033, 0.222], [0.0, 0.22]];
  const meshes = [];
  for (let j = 0; j < 3; j++) {
    const range = [[0, 3], [2, 5], [4, 8]][j];
    if (!geo[j]) geo[j] = new THREE.LatheGeometry(points.slice(...range).map(([x, y]) => new THREE.Vector2(x, y)), 15);
    const material = buoyMaterials[j] ??= new THREE.MeshStandardMaterial({ color: color[j], roughness: 0.56 });
    meshes.push(new THREE.Mesh(geo[j], material));
  }
  const buoy = new THREE.Group();
  buoy.name = 'Swim boundary buoy';
  buoy.add(...meshes);
  return buoy;
}
const buoyMaterials = [];

function coveSign() {
  if (warning) return warning;
  const c = document.createElement('canvas'); c.width = 448; c.height = 230;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9ddc0'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#344639'; ctx.lineWidth = 8; ctx.strokeRect(13, 13, c.width - 26, c.height - 26);
  ctx.fillStyle = '#37493d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 59px Georgia'; ctx.fillText('SWIM COVE', 224, 84);
  ctx.font = 'bold 37px Georgia'; ctx.fillText('IDLE SPEED', 224, 163);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  warning = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.76 });
  return warning;
}

function buildCove(terrain, root, rr) {
  const buoys = [], buoyGeometry = [];
  for (const z of [4.2, 9.1, 14.4, 19.5]) {
    const buoy = createBuoy(buoyGeometry);
    buoy.position.set(-8.7 + Math.sin(z * 0.2) * 0.45, 0.1, z);
    root.add(buoy); buoys.push(buoy);
  }
  const letterboard = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 0.94), coveSign());
  letterboard.name = 'Swim cove sign';
  letterboard.rotation.y = Math.PI / 2;
  letterboard.position.set(-20.45, 1.48, 16);
  const stakes = [];
  for (const z of [15.35, 16.65]) {
    const bed = terrain.hf.compute(-20.55, z);
    addBox(stakes, 0x776953, 0.11, 2.0 - bed, 0.11, -20.55, (2.0 + bed) / 2 - 0.04, z);
  }
  root.add(letterboard, waterfrontMesh(stakes, wood()));
  const swimmers = [];
  for (const [i, z] of [7.9, 15.7, 12.4].entries()) {
    const model = new THREE.Group(), figure = person(rr, { hat: false, vest: i === 2, swimming: true });
    model.name = 'Gulf Cut swimmer';
    const scale = [1.03, 0.95, 0.87][i];
    model.scale.setScalar(scale);
    model.position.set(-14.1 - i * 1.2, -0.85 * scale, z);
    model.rotation.y = Math.PI / 2;
    model.add(figure); root.add(model);
    poseSwimmer(figure, i * 9.77, 1, 0.72);
    swimmers.push({ model, figure, originZ: z, shoreX: -25.7, shoreZ: z + i * 0.12, mode: 'swim',
      clearFor: 0, time: i * 9.77, turnHold: 0, kickT: 0.2 * i, submerged: 1, phase: i * 1.95 });
  }
  return { buoys, swimmers };
}

function landscapeWaterfront(group, terrain, vegetation, rr) {
  if (!vegetation) return;
  for (const [x, z, scale] of [[-34, 9, 0.63], [-34, 26, 0.45], [-26.8, 40.8, 0.52], [-34.8, -4.2, 0.54]]) {
    const oak = vegetation.buildCampOak();
    oak.position.set(x, terrain.hf.compute(x, z) - 0.15, z);
    oak.rotation.y = rr() * Math.PI * 2;
    oak.scale.setScalar(scale);
    group.add(oak);
  }
  const reeds = vegetation.reed;
  const coveReeds = new THREE.InstancedMesh(reeds.geo, new THREE.MeshStandardMaterial({
    map: reeds.mat.map, alphaTest: 0.46, side: THREE.DoubleSide, roughness: 0.9, color: 0xaab78e,
  }), 42);
  coveReeds.name = 'Cove reeds';
  coveReeds.receiveShadow = true;
  const clump = new THREE.Object3D();
  let count = 0;
  for (const [x, z] of [[-20.7, 2.9], [-23, 18.4], [-21.3, 24.7], [-18.8, 33.0], [-19.4, 38.8], [-26.5, -3.91]]) {
    for (let i = 0; i < 7; i++) {
      const wx = x + (rr() - 0.5) * 1.65, wz = z + (rr() - 0.5) * 3.5;
      const h = terrain.hf.compute(wx, wz);
      if (h < -1.25) continue;
      clump.position.set(wx, h - 0.04, wz);
      clump.rotation.y = rr() * Math.PI;
      clump.scale.set(0.45 + rr() * 0.45, 0.65 + rr() * 0.95, 0.45 + rr() * 0.45);
      clump.updateMatrix();
      coveReeds.setMatrixAt(count++, clump.matrix);
    }
  }
  coveReeds.count = count;
  group.add(coveReeds);
}

export function buildWaterfront(terrain, vegetation) {
  const group = new THREE.Group();
  group.name = 'Gulf Cut waterfront';
  group.userData.people = [];
  group.userData.dockResidents = [];
  group.userData.site = COVE;
  const rr = mulberry32(31117);
  const bridge = buildGulfCutBridge(terrain);
  group.add(bridge.group);
  const houses = WATERFRONT_HOUSES.map(h => buildWaterfrontHouse(h, terrain, rr));
  group.add(...houses);
  for (const house of houses) if (house.userData.worker) group.userData.people.push(house.userData.worker);
  loadPaintedCypress()?.then(texture => {
    if (!texture) return;
    weatherboards.color.setHex(0xe7e5dc);
    weatherboards.map = texture;
    weatherboards.bumpMap = texture;
    weatherboards.bumpScale = 0.013;
    weatherboards.needsUpdate = true;
  });
  const docks = FISHING_PIERS.map(pier => buildFishingPier(pier, terrain, rr));
  for (const [i, dock] of docks.entries()) {
    group.add(dock.group);
    addAngler(FISHING_PIERS[i], dock.group, group, rr, i > 0 ? 1 : -1);
  }
  const laundry = [];
  const linePosts = [];
  const a = new THREE.Vector3(-29, 3.06, -3.57), b = new THREE.Vector3(-29, 3.06, -8.4);
  addBeam(linePosts, 0x776447, a, b, 0.011, 0.012);
  for (const p of [a, b]) addBox(linePosts, 0x8a8370, 0.086, 3.23 - terrain.hf.compute(p.x, p.z), 0.086,
    p.x, (3.23 + terrain.hf.compute(p.x, p.z)) / 2, p.z);
  group.add(waterfrontMesh(linePosts, wood()));
  for (let i = 0; i < 4; i++) {
    const parts = [], cloth = new THREE.PlaneGeometry(0.69 + rr() * 0.21, 0.83 + rr() * 0.26, 2, 3).translate(0, -0.45, 0);
    tintGeometry(parts, cloth, [0x9d7566, 0xbcb094, 0x557776, 0x979e83][i]);
    const m = waterfrontMesh(parts, greyCanvas, false);
    m.position.set(a.x, a.y, a.z - 0.75 - i * 1.05);
    m.rotation.y = Math.PI / 2;
    laundry.push(m); group.add(m);
  }
  const cove = buildCove(terrain, group, rr);
  landscapeWaterfront(group, terrain, vegetation, rr);
  loadAuthoredLanding()?.then(parts => {
    if (!parts) return;
    placeFabFenders(bridge.group, parts.cabinWall);
    for (const [i, dock] of docks.entries()) {
      if (!parts.deck) break;
      const { head, z, deck } = FISHING_PIERS[i], surface = parts.deck.clone(true);
      surface.position.set(head - 1.6, deck, z);
      surface.rotation.set(0, Math.PI / 2, 0);
      surface.scale.set(3.17 / 2.30, 0.64, 3.96 / 2.56);
      dock.deckFallback.visible = false;
      dock.group.add(surface);
    }
    if (parts.cabinWall) for (const [i, house] of houses.entries()) {
      const spec = WATERFRONT_HOUSES[i], wall = parts.cabinWall.clone(true);
      // Cladding below the two front windows ends at the screen door casing.
      wall.position.set(-spec.width * 0.15, 0.56, spec.depth / 2 + 0.042);
      wall.rotation.set(0, -Math.PI / 2, 0);
      wall.scale.set(1, 1.21, spec.width * 0.64 / 3.25);
      house.add(wall);
    }
  });
  const mooredSkiffs = buildMooredSkiffs(group);
  return { group, bridge, cove, laundry, mooredSkiffs, mooringColliders: mooredSkiffs.map(boat => boat.obstacle) };
}

function updateSwimmer(s, dt, terrain, time, waveAt, ctx, weather) {
  const { model, figure } = s;
  const waterLevel = weather?.waterLevel ?? 0;
  const distance = Math.hypot(model.position.x - ctx.bx, model.position.z - ctx.bz);
  const wake = ctx.playerWakeAt?.(model.position.x, model.position.z, time) ?? 0;
  const nearBoat = distance < 10;
  const fastPass = distance < 23 && ctx.speed > 3.6;
  const storm = (weather?.sampleStormAt(COVE.x, COVE.z) ?? 0) > 0.36;
  const dry = waterLevel - terrain.hf.compute(-14.8, s.originZ) < 0.84;
  const shoreDistance = Math.hypot(model.position.x - s.shoreX, model.position.z - s.shoreZ);
  swimmerStep(s, {
    dt, threat: nearBoat || fastPass || Math.abs(wake) > 0.09, storm, dry,
    safe: shoreDistance < 0.08, daylight: (weather?.daylight ?? 1) > 0.12,
  });
  // Lingering wake speed keeps residents ashore after the hull is gone.
  s.time += dt;
  const phase = s.time * 0.098 + s.phase, active = s.mode === 'swim';
  const tx = active ? -15.45 + Math.sin(phase) * 2.1 : s.shoreX;
  const tz = active ? s.originZ + Math.cos(phase * 1.22) * 2.8 : s.shoreZ;
  const dx = tx - model.position.x, dz = tz - model.position.z, targetDistance = Math.hypot(dx, dz);
  const speed = active ? 0.61 : 0.97;
  const effort = Math.min(1, targetDistance * 3.2) * (active ? 0.72 : 1);
  if (targetDistance > 0.025) {
    const movement = Math.min(targetDistance, dt * speed);
    model.position.x += dx * movement / targetDistance;
    model.position.z += dz * movement / targetDistance;
    const yaw = Math.atan2(dx, dz) - model.rotation.y;
    model.rotation.y += Math.atan2(Math.sin(yaw), Math.cos(yaw)) * -Math.expm1(-dt * 3.9);
  }
  const { x, z } = model.position;
  const floor = terrain.heightAt(x, z);
  const intended = THREE.MathUtils.smoothstep(waterLevel - floor, 0.43, 1.15);
  s.submerged += (intended - s.submerged) * -Math.expm1(-dt * 4.8);
  const surface = waveAt(x, z, time) + Math.max(-0.11, Math.min(0.16, wake)) * s.submerged;
  model.position.y = THREE.MathUtils.lerp(floor + 0.018, surface - 0.85 * model.scale.x, s.submerged);
  const towardBoat = Math.atan2(ctx.bx - x, ctx.bz - z) - model.rotation.y;
  const look = distance < 22 ? Math.atan2(Math.sin(towardBoat), Math.cos(towardBoat)) * 0.42 : 0;
  poseSwimmer(figure, s.time, s.submerged, effort, THREE.MathUtils.clamp(look, -0.75, 0.75));
  s.kickT -= dt;
  if (s.kickT <= 0 && distance < 95 && s.submerged > 0.35) {
    const foam = (0.16 + 0.32 * effort) * s.submerged;
    ctx.emitStamp(x, z, 0.5, 0.044 * effort, foam, 0.58);
    if (distance < 16) ctx.audio?.plip(0.09 * (1 - distance / 18), x, z);
    s.kickT = 0.71 + Math.sin(s.time * 4.8) * 0.12;
  }
}

export function updateWaterfront(waterfront, terrain, time, waveAt, wind, ctx, environment) {
  if (!waterfront.group.visible) return;
  const distZ = ctx.bz - GULF_CUT.z;
  if (distZ * distZ + ctx.bx * ctx.bx < 610 ** 2) updateGulfCutBridge(waterfront.bridge, time, environment?.night ?? 0, environment);
  if ((ctx.bx - COVE.x) ** 2 + (ctx.bz - COVE.z) ** 2 > 205 ** 2) return;
  glass.emissiveIntensity = (environment?.night ?? 0) * 0.44;
  updateMooredSkiffs(waterfront.mooredSkiffs, time, waveAt, ctx, environment);
  for (const [i, cloth] of waterfront.laundry.entries()) {
    const gust = (wind?.y ?? 0.6) * 0.19;
    cloth.rotation.set(Math.sin(time * 2.3 + i * 2.1) * gust, Math.PI / 2, Math.sin(time * 3.4 + i) * gust * 0.48);
  }
  for (const buoy of waterfront.cove.buoys) {
    const { x, z } = buoy.position;
    buoy.position.y = waveAt(x, z, time) + (ctx.playerWakeAt?.(x, z, time) ?? 0);
    buoy.rotation.z = Math.sin(time * 1.85 + z) * 0.19;
  }
  updateDockResidents(waterfront.group, time, ctx);
  animateSite(waterfront.group, time, waveAt, wind, ctx);
  if (!ctx.residentDt) return;
  for (const swimmer of waterfront.cove.swimmers) updateSwimmer(swimmer, ctx.residentDt, terrain, time, waveAt, ctx, environment);
}
