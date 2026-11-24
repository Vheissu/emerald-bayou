import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './noise.js';
import { buildCatchDisplay, setCatchDisplay } from './skiffdockgear.js';
import { addBeam, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';

const castIron = waterfrontSurface(0xffffff, { metalness: 0.28, roughness: 0.58 });
const iceFinish = waterfrontSurface(0xffffff, { metalness: 0.04, roughness: 0.24 });
const dialSweep = Math.PI * 1.44;
const scaleLimit = 40;
let materials;
let counterMeshes;

function inkTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function timberTexture(ctx, width, height) {
  const random = mulberry32(741);
  ctx.fillStyle = '#9a876e';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 3100; i++) {
    const x = random() * width, y = random() * height, length = 6 + 100 * random();
    ctx.strokeStyle = random() < 0.6 ? 'rgba(68,48,36,.12)' : 'rgba(231,216,185,.16)';
    ctx.lineWidth = 0.24 + random() * 1.32;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + length * 0.41, y + random() * 2 - 1,
      x + length * 0.78, y - random() * 2, x + length, y + random() * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const x = 18 + random() * (width - 36), y = random() * height;
    for (let ring = 0; ring < 5; ring++) {
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(51,37,30,.17)' : 'rgba(70,50,35,.10)';
      ctx.lineWidth = 0.62;
      ctx.beginPath();
      ctx.ellipse(x, y, (ring + 2) * 5.4, (ring + 2) * 0.92, random() * 0.05, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

function galvanizedTexture(ctx, width, height) {
  const random = mulberry32(71290);
  ctx.fillStyle = '#a0a8a3';
  ctx.fillRect(0, 0, width, height);
  for (let y = -14; y < height + 14; y += 11) for (let x = -14; x < width + 14; x += 12) {
    const cx = x + random() * 13, cy = y + random() * 11, tint = 122 + Math.floor(random() * 52);
    ctx.fillStyle = `rgba(${tint},${tint + 7},${tint + 5},.21)`;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = k * Math.PI / 3, r = 3 + random() * 9;
      if (!k) ctx.moveTo(cx + r, cy);
      else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.fill();
  }
  for (let i = 0; i < 760; i++) {
    const x = random() * width, y = random() * height;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(238,239,226,.18)' : 'rgba(65,73,69,.14)';
    ctx.lineWidth = 0.2 + random() * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 7 + random() * 37, y + random() * 4 - 2);
    ctx.stroke();
  }
}

function dialFace(ctx, width, height) {
  const center = width / 2;
  const enamel = ctx.createRadialGradient(center, center, 70, center, center, center);
  enamel.addColorStop(0, '#e8dfc6');
  enamel.addColorStop(0.87, '#d8cdb1');
  enamel.addColorStop(1, '#a49175');
  ctx.fillStyle = enamel;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(center, center);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ctx.strokeStyle = '#3e4239';
  ctx.font = 'bold 22px Georgia';
  for (let n = 0; n <= scaleLimit; n++) {
    const angle = dialSweep * (n / scaleLimit - 0.5), major = n % 5 === 0;
    const sx = Math.sin(angle), sy = -Math.cos(angle), inner = major ? 103 : 113;
    ctx.lineWidth = major ? 2.6 : 1.25;
    ctx.beginPath();
    ctx.moveTo(sx * inner, sy * inner);
    ctx.lineTo(sx * 124, sy * 124);
    ctx.stroke();
    if (major) ctx.fillText(String(n), sx * 86, sy * 86);
  }
  ctx.font = 'bold 19px Georgia';
  ctx.fillText('POUNDS', 0, 53);
  ctx.font = '13px sans-serif';
  ctx.fillText('40 × 1 LB', 0, 81);
}

function docketPaper(ctx, width, height) {
  ctx.fillStyle = '#d3c7a7';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#575e52';
  ctx.font = 'bold 18px Georgia';
  ctx.fillText('LANDINGS', 17, 27);
  ctx.font = '10px sans-serif';
  ctx.fillText('FISH', 17, 46);
  ctx.fillText('WT.', 133, 46);
  ctx.fillText('PAID', 178, 46);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(129,96,76,.56)';
  for (let y = 53; y <= height - 10; y += 19) {
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(width - 16, y);
    ctx.stroke();
  }
  for (const x of [121, 164]) {
    ctx.beginPath();
    ctx.moveTo(x, 39);
    ctx.lineTo(x, height - 13);
    ctx.stroke();
  }
}

function counterMaterials() {
  return materials ??= {
    wood: waterfrontSurface(0xffffff, { roughness: 0.85, map: inkTexture(512, 256, timberTexture) }),
    zinc: waterfrontSurface(0xffffff, { metalness: 0.52, roughness: 0.49, map: inkTexture(512, 256, galvanizedTexture) }),
    face: new THREE.MeshStandardMaterial({ map: inkTexture(256, 256, dialFace), roughness: 0.71 }),
    ledger: new THREE.MeshStandardMaterial({ map: inkTexture(224, 192, docketPaper), roughness: 0.88 }),
    pointer: new THREE.MeshStandardMaterial({ color: 0x833d2c, metalness: 0.18, roughness: 0.46 }),
  };
}

function bevel(batch, tint, width, height, depth, x, y, z, radius = 0.012) {
  const geo = new RoundedBoxGeometry(width, height, depth, 1, radius).translate(x, y, z);
  geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
  tintGeometry(batch, geo, tint);
}

function bolt(batch, x, y, z, direction = 'up') {
  const head = new THREE.CylinderGeometry(0.008, 0.009, 0.003, 8);
  if (direction === 'front') head.rotateX(Math.PI / 2);
  tintGeometry(batch, head.translate(x, y, z), 0x887c68);
}

function makeBench(boards, fittings) {
  for (const x of [-0.56, 0.56]) for (const z of [0.067, 0.473]) {
    bevel(boards, 0xaba28b, 0.075, 0.72, 0.077, x, 0.36, z, 0.009);
    bevel(fittings, 0x4f5146, 0.079, 0.057, 0.081, x, 0.030, z, 0.006);
    bolt(fittings, x, 0.754, z);
  }
  for (const z of [0.035, 0.505]) bevel(boards, 0xaa9a79, 1.26, 0.113, 0.057, 0, 0.642, z);
  for (const x of [-0.56, 0.56]) {
    bevel(boards, 0x948a6f, 0.074, 0.089, 0.48, x, 0.259, 0.269);
    addBeam(boards, 0xa5957b, new THREE.Vector3(x, 0.29, 0.449),
      new THREE.Vector3(x, 0.63, 0.087), 0.041, 0.042);
  }
  const tops = [0xc7b894, 0xb4a98e, 0xcfbea3, 0xbfb09a, 0xc0ae92, 0xb2a58d, 0xcbbaa0];
  for (const [i, shade] of tops.entries()) {
    bevel(boards, shade, 1.30, 0.064, 0.076, 0, 0.72, 0.035 + 0.077 * i, 0.006);
  }
  for (const z of [0.091, 0.212, 0.333, 0.454]) bevel(boards, 0xa79b84, 1.15, 0.031, 0.114, 0, 0.304, z, 0.005);
  for (const x of [-0.56, 0.56]) for (const y of [0.611, 0.673]) bolt(fittings, x, y, 0.534, 'front');
}

function makeScale(fittings, silver) {
  bevel(fittings, 0x30392f, 0.614, 0.024, 0.372, -0.135, 0.763, 0.225, 0.012);
  bevel(fittings, 0x526e62, 0.578, 0.148, 0.346, -0.135, 0.842, 0.223, 0.028);
  bevel(fittings, 0x7a8a75, 0.544, 0.014, 0.306, -0.135, 0.912, 0.219, 0.009);
  for (const x of [-0.35, 0.08]) {
    bevel(silver, 0xe2d9bc, 0.053, 0.011, 0.054, x, 0.925, 0.223, 0.004);
    bolt(fittings, x, 0.839, 0.4, 'front');
  }
  // The radial bezel comes forward of the die-cast housing so it catches reflected light.
  tintGeometry(fittings, new THREE.CylinderGeometry(0.089, 0.1, 0.029, 36)
    .rotateX(Math.PI / 2).translate(-0.135, 0.831, 0.401), 0x465349);
  tintGeometry(silver, new THREE.TorusGeometry(0.079, 0.0064, 8, 36)
    .translate(-0.135, 0.831, 0.417), 0xf0e7d1);
  bevel(fittings, 0x64695e, 0.232, 0.018, 0.216, 0.426, 0.76, 0.24, 0.006);
  bevel(fittings, 0xd1c6a8, 0.210, 0.012, 0.196, 0.423, 0.774, 0.242, 0.005);
  bevel(silver, 0xbbbda7, 0.071, 0.022, 0.023, 0.425, 0.788, 0.145, 0.004);

  // A folded towel hangs over the side of the drain shelf.
  const folds = [[0.09, 0.32, 0.1], [0.08, 0.23, 0.19], [0.08, 0.18, 0.24]];
  const fabric = [0xa09878, 0xb0a78b, 0x948b70];
  for (const [i, [width, y, z]] of folds.entries()) bevel(fittings, fabric[i],
    width + 0.09, 0.024, 0.197, 0.347 + 0.023 * i, y, z, 0.009);
}

function makePan() {
  // Each ring follows the zinc sheet through the floor, raised walls and rolled rim.
  const profile = [
    [0.359, 0.173, 0], [0.371, 0.184, 0.008], [0.408, 0.219, 0.042],
    [0.408, 0.219, 0.049], [0.399, 0.209, 0.053], [0.39, 0.201, 0.049],
    [0.391, 0.202, 0.041], [0.355, 0.169, 0.015],
  ];
  const positions = [], uv = [], indices = [], zinc = [];
  for (let j = 0; j < profile.length; j++) {
    const [x, z, y] = profile[j], corner = 0.043;
    const ring = [[-x + corner, -z], [x - corner, -z], [x, -z + corner], [x, z - corner],
      [x - corner, z], [-x + corner, z], [-x, z - corner], [-x, -z + corner]];
    for (let i = 0; i < ring.length; i++) {
      const [rx, rz] = ring[i], row = j * ring.length, a = row + i;
      positions.push(rx - 0.135, y + 0.931, rz + 0.232);
      uv.push(0.5 + rx * 1.13 + y * 0.45, 0.5 + rz * 1.14 + y * 0.78);
      if (j === profile.length - 1) continue;
      const b = row + (i + 1) % ring.length;
      indices.push(a, a + ring.length, b, b, a + ring.length, b + ring.length);
    }
  }
  const tray = new THREE.BufferGeometry();
  tray.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  tray.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tray.setIndex(indices);
  tray.computeVertexNormals();
  tintGeometry(zinc, tray, 0xf7efda, (x, y) => 0.89 + 0.13 * Math.sin(x * 8) + 1.2 * (y - 0.931));
  bevel(zinc, 0xbfcac3, 0.721, 0.022, 0.341, -0.135, 0.943, 0.232, 0.015);
  for (const x of [-0.515, 0.245]) for (const z of [0.16, 0.30]) bolt(zinc, x, 0.975, z);
  return waterfrontMesh(zinc, counterMaterials().zinc);
}

function iceBed() {
  const batch = [], random = mulberry32(2122);
  const tones = [0xc9d8d4, 0xafc4c5, 0xe3ece4, 0xb4c6ce, 0xd2dddd];
  for (let i = 0; i < 210; i++) {
    const x = (random() - 0.5) * 0.694, z = (random() - 0.5) * 0.324;
    const size = 0.009 + random() * 0.015;
    const crystal = new THREE.IcosahedronGeometry(size, 0)
      .scale(0.57 + random() * 0.61, 0.42 + random() * 0.38, 0.72 + random() * 0.51)
      .rotateY(random() * Math.PI)
      .translate(x - 0.135, 0.964 + random() * 0.009, z + 0.232);
    crystal.setIndex(Array.from({ length: crystal.attributes.position.count }, (_, k) => k));
    tintGeometry(batch, crystal, tones[i % tones.length], (x, y, z) =>
      0.58 + (y - 0.952) * 9 + Math.sin(x * 98 + z * 87) * 0.13);
  }
  return waterfrontMesh(batch, iceFinish, false);
}

const receiptPoses = [
  [0.004, 1.015, 0.319, 0.17, 1.50, 0.98],
  [-0.223, 1.004, 0.171, Math.PI + 0.29, -1.47, 0.85],
  [-0.042, 1.008, 0.126, -0.23, 1.46, 0.88],
  [-0.226, 1.015, 0.303, Math.PI + 0.24, -1.56, 0.83],
  [0.020, 1.036, 0.214, 0.35, 1.59, 0.90],
  [-0.252, 1.036, 0.242, Math.PI + 0.06, -1.51, 0.85],
  [-0.048, 1.060, 0.240, -0.38, 1.31, 0.86],
  [-0.225, 1.060, 0.274, Math.PI - 0.35, -1.54, 0.84],
];

function sharedCounter() {
  if (counterMeshes) return counterMeshes;
  const wood = [], iron = [], steel = [];
  const finish = counterMaterials();
  makeBench(wood, iron);
  makeScale(iron, steel);
  counterMeshes = {
    bench: waterfrontMesh(wood, finish.wood),
    frame: waterfrontMesh(iron, castIron),
    hardware: waterfrontMesh(steel, finish.zinc),
    tray: makePan(),
    ice: iceBed(),
    dial: new THREE.CircleGeometry(0.075, 36),
    book: new THREE.PlaneGeometry(0.202, 0.186),
    pointer: new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(-0.006, -0.018), new THREE.Vector2(0.006, -0.018),
      new THREE.Vector2(0.002, 0.046), new THREE.Vector2(0, 0.064),
      new THREE.Vector2(-0.002, 0.046),
    ])),
    hub: new THREE.CircleGeometry(0.009, 14),
  };
  return counterMeshes;
}

export function buildFishCounter(group) {
  const model = sharedCounter(), finish = counterMaterials();
  const counter = new THREE.Group();
  counter.name = 'Fish receiving counter';
  counter.add(model.bench.clone(), model.frame.clone(), model.hardware.clone());
  const pan = new THREE.Group();
  pan.name = 'Spring-loaded galvanized pan';
  const ice = model.ice.clone();
  ice.name = 'Crushed ice in weighing tray';
  ice.visible = false;
  pan.add(model.tray.clone(), ice);
  const fish = buildCatchDisplay(pan, receiptPoses);
  const dial = new THREE.Mesh(model.dial, finish.face);
  dial.position.set(-0.135, 0.831, 0.417);
  dial.receiveShadow = true;
  const book = new THREE.Mesh(model.book, finish.ledger);
  book.rotation.x = -Math.PI / 2;
  book.position.set(0.423, 0.781, 0.243);
  book.receiveShadow = true;
  const needle = new THREE.Mesh(model.pointer, finish.pointer);
  needle.position.set(-0.135, 0.831, 0.419);
  const hub = new THREE.Mesh(model.hub, finish.pointer);
  hub.position.set(-0.135, 0.831, 0.42);
  counter.add(pan, dial, book, needle, hub);
  group.add(counter);
  return { pan, ice, fish, needle, receipt: undefined, load: 0 };
}

export function updateFishCounter(counter, receipt, dt, weighTime) {
  if (counter.receipt !== receipt) {
    counter.receipt = receipt;
    counter.ice.visible = !!receipt;
    setCatchDisplay(counter.fish, receipt?.count ?? 0, receipt?.items);
  }
  const target = receipt ? 3.1 + 2.4 * receipt.count : 0;
  counter.load = THREE.MathUtils.damp(counter.load, target, 7, dt);
  const elapsed = Math.max(0, 3.1 - weighTime);
  const settle = weighTime > 0 ? Math.sin(elapsed * 17) * Math.exp(-elapsed * 3.5) * 0.13 : 0;
  counter.needle.rotation.z = dialSweep * (0.5 - counter.load / scaleLimit) + settle;
  counter.pan.position.y = -0.024 * counter.load / scaleLimit + settle * 0.014;
}
