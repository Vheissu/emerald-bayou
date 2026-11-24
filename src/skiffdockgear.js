import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './noise.js';
import { addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';

// Coordinates at the underside of the shell, in the same frame the crew
// animator moves. Both boxes are carried sideways so the hands frame the load.
export const TOTE_HANDLES = Object.freeze([
  Object.freeze({ x: -0.278, y: 0.215, z: 0.02 }),
  Object.freeze({ x: 0.278, y: 0.215, z: 0.02 }),
]);
export const PAIL_HANDLE = Object.freeze({ x: 0, y: 0.417, z: 0 });

const shellFinish = waterfrontSurface(0xffffff, { roughness: 0.78 });
const timber = waterfrontSurface(0xffffff, { roughness: 0.91 });
const fishFinish = new THREE.MeshStandardMaterial({
  color: 0xffffff, vertexColors: true, roughness: 0.31, metalness: 0.19, side: THREE.DoubleSide,
});
const iceFinish = new THREE.MeshStandardMaterial({
  color: 0xffffff, vertexColors: true, roughness: 0.26, metalness: 0.02,
});
const maxFish = 4;
const models = [];

function rounded(batch, tint, width, height, depth, x, y, z, radius = 0.012, shade) {
  // waterfrontMesh merges indexed parts. RoundedBoxGeometry comes expanded.
  const geometry = new RoundedBoxGeometry(width, height, depth, 1, radius).translate(x, y, z);
  geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
  tintGeometry(batch, geometry, tint, shade);
}

function handle(batch, x, y, z) {
  // Dark rubber grip with the metal hinge arms standing proud of the shell.
  rounded(batch, 0x30342e, 0.064, 0.028, 0.135, x, y, z, 0.013);
  const sign = Math.sign(x);
  for (const end of [-1, 1]) {
    rounded(batch, 0xb0a798, 0.034, 0.032, 0.024, x - sign * 0.019, y, z + end * 0.075);
    rounded(batch, 0x5b5c52, 0.023, 0.053, 0.046, x - sign * 0.031, y - 0.018, z + end * 0.076);
  }
}

function buildLid(index) {
  const batch = [];
  rounded(batch, index === 0 ? 0xd1c2a7 : 0xb5b1a1, 0.552, 0.04, 0.337, 0, 0.012, 0.164, 0.014);
  rounded(batch, 0x756e5c, 0.496, 0.012, 0.292, 0, -0.007, 0.164, 0.005);
  rounded(batch, 0xb3ab94, 0.469, 0.014, 0.266, 0, -0.012, 0.165, 0.009);
  for (const x of [-0.15, 0.15]) {
    addBox(batch, 0xa3a092, 0.046, 0.018, 0.024, x, 0.006, 0.339);
    addBox(batch, 0x727160, 0.059, 0.027, 0.024, x, -0.014, -0.003);
  }
  return waterfrontMesh(batch, shellFinish).geometry;
}

function buildPail(index) {
  const batch = [];
  const profile = [
    [0, 0], [0.09, 0], [0.104, 0.012], [0.113, 0.041], [0.132, 0.296],
    [0.143, 0.308], [0.143, 0.322], [0.105, 0.327], [0, 0.327],
  ];
  const paint = index === 0 ? 0x777f64 : 0x8c7a58;
  tintGeometry(batch, new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 20), paint,
    (x, y, z) => 0.78 + 0.23 * y + 0.1 * Math.sin(x * 43 + z * 71));
  tintGeometry(batch, new THREE.CylinderGeometry(0.14, 0.131, 0.026, 20).translate(0, 0.321, 0), 0x464d46);
  for (const side of [-1, 1]) {
    addBox(batch, 0x4f5448, 0.036, 0.054, 0.044, side * 0.127, 0.255, 0);
  }
  const arc = [], pivotY = 0.256, arcDepth = 0.162;
  for (let n = 0; n <= 12; n++) {
    const angle = Math.PI * n / 12;
    arc.push(new THREE.Vector3(Math.cos(angle) * 0.137, pivotY + Math.sin(angle) * arcDepth, 0));
  }
  tintGeometry(batch, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 18, 0.006, 5, false), 0xabaa97);
  rounded(batch, 0x343931, 0.087, 0.027, 0.03, PAIL_HANDLE.x, PAIL_HANDLE.y, PAIL_HANDLE.z, 0.01);
  // A worn label stripe and a scale stay legible in silhouette at the pier.
  rounded(batch, 0xbbac89, 0.095, 0.07, 0.019, 0, 0.16, 0.122, 0.009);
  for (const y of [0.148, 0.159, 0.17]) addBox(batch, 0x5d5542, 0.059, 0.003, 0.002, 0, y, 0.133);
  return waterfrontMesh(batch, shellFinish).geometry;
}

// Rounded walls and stacking ribs leave an open insulated interior beneath the lid.
function buildCooler(index) {
  const batch = [], paint = index === 0 ? 0x9f6351 : 0x6b795f;
  const shadedWall = (x, y, z) => 0.72 + 0.23 * (y / 0.23) + 0.09 * Math.sin(x * 39 + z * 18);
  rounded(batch, 0x5b5a4d, 0.508, 0.024, 0.292, 0, 0.012, 0, 0.008);
  rounded(batch, paint, 0.51, 0.033, 0.288, 0, 0.024, 0, 0.015);
  for (const side of [-1, 1]) {
    rounded(batch, paint, 0.52, 0.188, 0.035, 0, 0.118, side * 0.151, 0.015, shadedWall);
    rounded(batch, paint, 0.026, 0.188, 0.272, side * 0.247, 0.118, 0, 0.012);
    rounded(batch, 0x647265, 0.563, 0.047, 0.036, 0, 0.228, side * 0.151, 0.011);
    rounded(batch, 0x647265, 0.037, 0.047, 0.309, side * 0.263, 0.228, 0, 0.011);
    rounded(batch, 0x33463e, 0.501, 0.022, 0.023, 0, 0.011, side * 0.124, 0.008);
    for (let strip = -4; strip <= 4; strip++) {
      addBox(batch, paint, 0.012, 0.131, 0.013, strip * 0.057, 0.124, side * 0.169);
    }
  }
  for (const x of [-0.15, 0.15]) {
    rounded(batch, 0x464842, 0.071, 0.081, 0.021, x, 0.185, 0.177, 0.006);
  }
  for (const grip of TOTE_HANDLES) handle(batch, grip.x, grip.y, grip.z);
  return waterfrontMesh(batch, shellFinish).geometry;
}

function buildIce(index) {
  const batch = [], rnd = mulberry32(6227 + index);
  for (let i = 0; i < 35; i++) {
    const x = (rnd() - 0.5) * 0.445, z = (rnd() - 0.5) * 0.249;
    const size = 0.022 + rnd() * 0.027;
    const ice = new THREE.IcosahedronGeometry(1, 0).scale(size * 1.24, size * 0.66, size)
      .rotateY(rnd() * Math.PI * 2).rotateX(rnd()).translate(x, 0.071 + rnd() * 0.029, z);
    const tone = [0xb1c8c4, 0xe2e5d8, 0x97bbb9, 0xcadbd5][i % 4];
    ice.setIndex(Array.from({ length: ice.attributes.position.count }, (_, k) => k));
    tintGeometry(batch, ice, tone);
  }
  return waterfrontMesh(batch, iceFinish, false).geometry;
}

function makeFish() {
  // Nine tapered cross-sections keep the small heads and split tails distinct
  // at dock distance. The side carries bands laid into the scales themselves.
  const stations = [
    [-0.153, 0.008, 0.011], [-0.137, 0.022, 0.023], [-0.104, 0.034, 0.031],
    [-0.051, 0.037, 0.033], [0.013, 0.033, 0.029], [0.066, 0.026, 0.023],
    [0.115, 0.015, 0.015], [0.151, 0.011, 0.01], [0.164, 0.004, 0.004],
  ];
  const radial = 14, positions = [], uvs = [], indices = [], batch = [];
  for (let j = 0; j < stations.length; j++) {
    const [x, height, beam] = stations[j];
    for (let k = 0; k < radial; k++) {
      const angle = k * Math.PI * 2 / radial;
      positions.push(x, Math.cos(angle) * height, Math.sin(angle) * beam);
      uvs.push(j / (stations.length - 1), k / radial);
      if (j === stations.length - 1) continue;
      const a = j * radial + k, b = j * radial + (k + 1) % radial;
      indices.push(a, b, a + radial, b, b + radial, a + radial);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  tintGeometry(batch, geometry, 0xb6cbc4, (x, y, z) => {
    const flank = Math.min(1, Math.abs(z) / 0.033);
    const scales = 0.042 * Math.sin(140 * x + 715 * y);
    const bands = 0.095 * Math.sin((Math.abs(y) + x * 0.01) * 430) * flank;
    return y > 0 ? 0.85 - y * 12 + scales + bands : 1.04 + scales + bands;
  });
  const fin = (name, color) => {
    const pts = name.map(p => new THREE.Vector3(...p));
    const triangles = new THREE.BufferGeometry().setFromPoints(pts);
    triangles.setIndex([0, 1, 2, 0, 2, 3]);
    triangles.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    triangles.computeVertexNormals();
    tintGeometry(batch, triangles, color);
  };
  fin([[0.139, 0.009, 0], [0.235, 0.061, 0], [0.196, 0, 0], [0.145, -0.01, 0]], 0x7d8d7e);
  fin([[0.145, -0.01, 0], [0.196, 0, 0], [0.229, -0.056, 0], [0.15, -0.017, 0]], 0x748b83);
  fin([[-0.054, 0.032, 0], [-0.013, 0.067, 0], [0.033, 0.028, 0], [-0.021, 0.028, 0]], 0x75877b);
  fin([[0.060, 0.024, 0], [0.100, 0.048, 0], [0.132, 0.014, 0], [0.080, 0.019, 0]], 0x839083);
  for (const side of [-1, 1]) {
    fin([[-0.081, -0.011, side * 0.024], [-0.052, -0.031, side * 0.064],
      [0.007, -0.029, side * 0.041], [-0.059, -0.013, side * 0.028]], 0x96a89b);
    tintGeometry(batch, new THREE.SphereGeometry(0.009, 9, 5).scale(1.15, 1, 0.43)
      .translate(-0.116, 0.008, side * 0.0235), 0x6b684a);
    tintGeometry(batch, new THREE.SphereGeometry(0.0048, 9, 5).scale(1, 1, 0.47)
      .translate(-0.118, 0.0075, side * 0.027), 0x1b2422);
    const gill = new THREE.CatmullRomCurve3([
      [-0.094, -0.023, 0.021], [-0.085, -0.01, 0.030], [-0.085, 0.008, 0.030], [-0.091, 0.025, 0.020],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, side * z)));
    tintGeometry(batch, new THREE.TubeGeometry(gill, 7, 0.0018, 4, false), 0x777859);
  }
  return waterfrontMesh(batch, fishFinish, false).geometry;
}

let fish;
const fishPoses = [
  [-0.020, 0.126, -0.050, 0.03, 1.12, 0.91],
  [0.050, 0.126, 0.052, Math.PI - 0.18, -1.52, 0.85],
  [-0.030, 0.153, 0.017, 0.30, 1.28, 0.94],
  [0.047, 0.160, -0.068, Math.PI + 0.16, -1.37, 0.78],
];

const panFishPoses = [
  [-0.022, 0.023, 0.014, Math.PI * 0.27, 1.48, 0.63],
  [0.042, 0.038, -0.009, Math.PI * 1.29, -1.36, 0.68],
  [-0.037, 0.054, -0.030, Math.PI * 0.31, 1.20, 0.56],
  [0.054, 0.072, 0.012, Math.PI * 1.36, -1.72, 0.60],
];

function addFish(parent, poses) {
  const contents = new THREE.InstancedMesh(fish ??= makeFish(), fishFinish, maxFish);
  contents.name = 'Mullet on ice';
  contents.receiveShadow = true;
  const pose = new THREE.Object3D();
  poses.forEach(([x, y, z, yaw, roll, size], index) => {
    pose.position.set(x, y, z);
    pose.rotation.set(roll, yaw, 0, 'YXZ');
    pose.scale.setScalar(size);
    pose.updateMatrix();
    contents.setMatrixAt(index, pose.matrix);
  });
  contents.computeBoundingSphere();
  contents.count = 0;
  contents.visible = false;
  parent.add(contents);
  return contents;
}

function makeBench(berth, parent) {
  const batch = [], { pier, side } = berth;
  const benchX = pier.x + 2.96, benchZ = pier.z + side * 0.49;
  for (const x of [-0.48, 0.54]) for (const z of [-0.21, 0.21]) {
    rounded(batch, 0x7d7661, 0.071, 0.76, 0.073, x, 0.38, z, 0.009);
    rounded(batch, 0x6e6d61, 0.078, 0.09, 0.08, x, 0.046, z, 0.009);
  }
  for (const z of [-0.22, 0.22]) addBox(batch, 0x9a8f74, 1.13, 0.105, 0.075, 0.04, 0.701, z);
  for (const z of [-0.183, 0, 0.183]) {
    rounded(batch, 0xaca088, 1.22, 0.072, 0.174, 0.04, 0.784, z, 0.013,
      (x, y) => 0.84 + 0.13 * Math.sin(x * 18) + 0.07 * Math.sin(y * 71 + x * 125));
    addBox(batch, 0x887c64, 0.97, 0.027, 0.157, 0, 0.196, z);
  }
  // The galvanized pan sits just beyond the cooler handle and cannot cross
  // into the gangway as the boat crew set their gear down.
  const panX = 0.46;
  rounded(batch, 0xa4aa98, 0.28, 0.021, 0.272, panX, 0.834, 0, 0.009);
  for (const dx of [-0.143, 0.143]) rounded(batch, 0xadada0, 0.021, 0.046, 0.272, panX + dx, 0.853, 0, 0.007);
  for (const z of [-0.132, 0.132]) rounded(batch, 0xb4b4a6, 0.303, 0.046, 0.02, panX, 0.854, z, 0.007);
  rounded(batch, 0x6e745d, 0.25, 0.055, 0.165, 0.32, 0.230, 0.064, 0.013);
  const bench = waterfrontMesh(batch, timber);
  bench.name = 'Catch bench';
  bench.position.set(benchX, pier.deck, benchZ);

  const landedFish = addFish(bench, panFishPoses);
  landedFish.name = 'Catch on the bench';
  landedFish.position.set(panX, 0.853, 0);
  parent.add(bench);
  return { bench, landedFish, panPoint: new THREE.Vector3(benchX + panX, pier.deck + 0.853, benchZ) };
}

export function createCreelFish() {
  const carrier = new THREE.Group();
  carrier.name = 'Mullet on the line';
  const mesh = new THREE.Mesh(fish ??= makeFish(), fishFinish);
  mesh.position.y = -0.153;
  mesh.rotation.z = -Math.PI / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  carrier.add(mesh);
  return carrier;
}

export function buildDockGear(boat, index, parent) {
  const geometry = models[index] ??= {
    cooler: buildCooler(index), tackle: buildPail(index), lid: buildLid(index).rotateY(index === 0 ? Math.PI : 0), ice: buildIce(index),
  };
  const cooler = new THREE.Mesh(geometry.cooler, shellFinish);
  const tackle = new THREE.Mesh(geometry.tackle, shellFinish);
  const lid = new THREE.Mesh(geometry.lid, shellFinish);
  const ice = new THREE.Mesh(geometry.ice, iceFinish);
  cooler.name = 'Insulated catch cooler';
  tackle.name = 'Bait pail';
  lid.name = 'Cooler lid';
  ice.name = 'Ice bed';
  // The two benches face opposite ways. Keep the open lid beyond the fish,
  // leaving both hands a clear path between the ice and the receiving pan.
  const hingeSide = boat.berth.side;
  lid.position.set(0, 0.238, hingeSide * 0.164);
  ice.receiveShadow = true;
  cooler.add(ice, lid);
  const contents = addFish(cooler, fishPoses);
  const { pier, side } = boat.berth;
  cooler.position.set(pier.x + 1.6, pier.deck, pier.z - side * 0.52);
  tackle.position.set(pier.x + 1.7, pier.deck, pier.z + side * 0.52);
  for (const prop of [cooler, tackle, lid]) prop.castShadow = prop.receiveShadow = true;
  parent.add(cooler, tackle);
  return { cooler, tackle, lid, hingeSide, contents, ...makeBench(boat.berth, parent) };
}

function showFish(mesh, count) {
  mesh.count = Number.isFinite(count) ? Math.min(maxFish, Math.max(0, Math.floor(count))) : 0;
  mesh.visible = mesh.count > 0;
}

export function setDockCatch(gear, count, open = 0, landedCount = 0) {
  showFish(gear.contents, count);
  showFish(gear.landedFish, landedCount);
  gear.lid.rotation.x = gear.hingeSide * THREE.MathUtils.clamp(open, 0, 1) * 1.64;
}
