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
const models = [];
const fishVariants = [
  { id: 'mullet', name: 'Mullet', body: 0xb6cbc4, fin: 0x7d8d7e, scale: [1, 1, 1] },
  { id: 'redfish', name: 'Redfish', body: 0xcb996d, fin: 0xa46541, scale: [1.07, 1.19, 1.13] },
  { id: 'trout', name: 'Speckled trout', body: 0x89a29e, fin: 0x576c68, scale: [1.06, 0.83, 0.90] },
];
const fishGeometries = [];
const fishBeds = new WeakMap();

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

function buildIce(index, chest = false) {
  const batch = [], rnd = mulberry32(6227 + index);
  for (let i = 0, cubes = chest ? 88 : 35; i < cubes; i++) {
    const x = (rnd() - 0.5) * (chest ? 0.55 : 0.445), z = (rnd() - 0.5) * (chest ? 0.515 : 0.249);
    const size = 0.022 + rnd() * 0.027;
    const ice = new THREE.IcosahedronGeometry(1, 0).scale(size * 1.24, size * 0.66, size)
      .rotateY(rnd() * Math.PI * 2).rotateX(rnd()).translate(x, 0.071 + rnd() * 0.029, z);
    const tone = [0xb1c8c4, 0xe2e5d8, 0x97bbb9, 0xcadbd5][i % 4];
    ice.setIndex(Array.from({ length: ice.attributes.position.count }, (_, k) => k));
    tintGeometry(batch, ice, tone);
  }
  return waterfrontMesh(batch, iceFinish, false).geometry;
}

function buildIceChest() {
  const batch = [], paint = 0x426d68;
  const scuffedWall = (x, y, z) => 0.76 + 0.21 * (y / 0.29) + 0.09 * Math.sin(28 * x + 34 * z);
  rounded(batch, 0x373f39, 0.634, 0.034, 0.572, 0, 0.018, 0, 0.014);
  rounded(batch, 0x8b9383, 0.627, 0.034, 0.564, 0, 0.050, 0, 0.015);
  for (const side of [-1, 1]) {
    rounded(batch, paint, 0.644, 0.233, 0.043, 0, 0.150, side * 0.28, 0.017, scuffedWall);
    rounded(batch, paint, 0.042, 0.233, 0.559, side * 0.307, 0.150, 0, 0.018, scuffedWall);
    rounded(batch, 0xc3c9b3, 0.584, 0.215, 0.014, 0, 0.152, side * 0.263, 0.007);
    rounded(batch, 0xc3c9b3, 0.014, 0.215, 0.526, side * 0.285, 0.152, 0, 0.007);
    rounded(batch, 0x778b7e, 0.682, 0.047, 0.041, 0, 0.286, side * 0.284, 0.015);
    rounded(batch, 0x778b7e, 0.043, 0.047, 0.554, side * 0.315, 0.286, 0, 0.015);
    for (const x of [-0.235, -0.19, 0.19, 0.235]) {
      rounded(batch, 0x4f7770, 0.023, 0.151, 0.013, x, 0.149, side * 0.302, 0.005);
    }
    handle(batch, side * 0.337, 0.225, 0.02);
  }
  for (const x of [-0.21, 0.21]) {
    rounded(batch, 0x5d6457, 0.073, 0.092, 0.028, x, 0.235, -0.310, 0.008);
    rounded(batch, 0x303931, 0.048, 0.066, 0.021, x, 0.254, -0.325, 0.008);
  }
  tintGeometry(batch, new THREE.CylinderGeometry(0.021, 0.021, 0.019, 12)
    .rotateZ(Math.PI / 2).translate(0.332, 0.075, 0.186), 0xa6a38b);
  return waterfrontMesh(batch, shellFinish).geometry;
}

function buildChestLid() {
  const batch = [];
  rounded(batch, 0xd4d1ae, 0.688, 0.061, 0.623, 0, 0.018, -0.298, 0.021);
  rounded(batch, 0x646f5f, 0.626, 0.014, 0.560, 0, -0.009, -0.298, 0.006);
  rounded(batch, 0xb8ba9f, 0.591, 0.018, 0.529, 0, -0.016, -0.298, 0.009);
  for (const x of [-0.212, 0.212]) {
    rounded(batch, 0xb0ad95, 0.082, 0.018, 0.052, x, 0.023, -0.591, 0.006);
    rounded(batch, 0x4e675d, 0.084, 0.036, 0.046, x, 0.003, -0.008, 0.006);
    rounded(batch, 0xb6b497, 0.061, 0.009, 0.399, x, 0.052, -0.298, 0.004);
  }
  return waterfrontMesh(batch, shellFinish).geometry;
}

function makeFish(variant) {
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
  tintGeometry(batch, geometry, variant.body, (x, y, z) => {
    const flank = Math.min(1, Math.abs(z) / 0.033);
    const scales = 0.042 * Math.sin(140 * x + 715 * y);
    const bands = variant.id === 'mullet' ? 0.095 * Math.sin((Math.abs(y) + x * 0.01) * 430) * flank : 0;
    const back = variant.id === 'trout' ? 16 : 12;
    return y > 0 ? 0.85 - y * back + scales + bands : 1.04 + scales + bands;
  });
  if (variant.id !== 'mullet') {
    // Pearl belly on the copper drum and silver trout, fading into the flanks.
    const colors = geometry.attributes.color, pearl = new THREE.Color(0xd9dcbd), flank = new THREE.Color();
    for (let i = 0; i < positions.length / 3; i++) {
      const weight = THREE.MathUtils.smoothstep(-positions[i * 3 + 1], 0.006, 0.033);
      flank.fromBufferAttribute(colors, i).lerp(pearl, weight);
      colors.setXYZ(i, flank.r, flank.g, flank.b);
    }
  }
  const fin = (name, color) => {
    const pts = name.map(p => new THREE.Vector3(...p));
    const triangles = new THREE.BufferGeometry().setFromPoints(pts);
    triangles.setIndex([0, 1, 2, 0, 2, 3]);
    triangles.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    triangles.computeVertexNormals();
    tintGeometry(batch, triangles, color);
  };
  const fork = variant.id === 'redfish' ? 0.228 : variant.id === 'trout' ? 0.220 : 0.196;
  fin([[0.139, 0.009, 0], [0.235, 0.061, 0], [fork, 0, 0], [0.145, -0.01, 0]], variant.fin);
  fin([[0.145, -0.01, 0], [fork, 0, 0], [0.229, -0.056, 0], [0.15, -0.017, 0]], variant.fin);
  fin([[-0.054, 0.032, 0], [-0.013, 0.067, 0], [0.033, 0.028, 0], [-0.021, 0.028, 0]], variant.fin);
  fin([[0.060, 0.024, 0], [0.100, 0.048, 0], [0.132, 0.014, 0], [0.080, 0.019, 0]], variant.fin);
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
    if (variant.id === 'redfish') {
      tintGeometry(batch, new THREE.SphereGeometry(1, 10, 6).scale(0.012, 0.008, 0.003)
        .rotateY(side * 0.19).translate(0.123, 0.005, side * 0.0137), 0x332d26);
    }
    if (variant.id === 'trout') {
      // Irregular freckles follow the contour of the back and thin out behind the gill.
      const random = mulberry32(4672);
      for (const [x, height, beam] of stations.slice(2, -1)) for (let row = 0; row < 4; row++) {
        const angle = 0.48 + row * 0.36 + random() * 0.18;
        const radius = 0.0024 + random() * 0.0024;
        const spot = new THREE.SphereGeometry(radius, 6, 4).scale(1.18, 0.89, 0.47)
          .rotateX(side * (angle - Math.PI / 2))
          .translate(x + (random() - 0.5) * 0.018, 1.02 * height * Math.cos(angle), 1.02 * side * beam * Math.sin(angle));
        tintGeometry(batch, spot, 0x243534);
      }
    }
  }
  return waterfrontMesh(batch, fishFinish, false).geometry.scale(...variant.scale);
}

function fishGeometry(index) {
  return fishGeometries[index] ??= makeFish(fishVariants[index]);
}

function fishIndex(species) {
  if (!species) return 0;
  const index = fishVariants.findIndex(fish => fish.id === species);
  return index < 0 ? 0 : index;
}
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

const chestFishPoses = [
  [-0.067, 0.127, -0.192, 0.12, 1.5, 0.99],
  [0.077, 0.126, -0.060, Math.PI - 0.20, -1.5, 0.91],
  [-0.045, 0.125, 0.057, 0.09, 1.3, 0.99],
  [0.070, 0.131, 0.195, Math.PI + 0.10, -1.6, 0.88],
  [-0.043, 0.181, -0.145, 0.31, 1.48, 1.03],
  [0.066, 0.185, -0.011, Math.PI - 0.16, -1.60, 0.96],
  [-0.051, 0.186, 0.118, 0.16, 1.60, 0.94],
  [0.047, 0.183, 0.230, Math.PI + 0.15, -1.39, 0.88],
];

function addFish(parent, poses) {
  const bed = new THREE.Group();
  bed.name = 'Catch on ice';
  const pose = new THREE.Object3D();
  const matrices = poses.map(([x, y, z, yaw, roll, size]) => {
    pose.position.set(x, y, z);
    pose.rotation.set(roll, yaw, 0, 'YXZ');
    pose.scale.setScalar(size);
    pose.updateMatrix();
    return pose.matrix.clone();
  });
  const layers = fishVariants.map(({ name }, index) => {
    const layer = new THREE.InstancedMesh(fishGeometry(index), fishFinish, matrices.length);
    layer.name = `${name} on ice`;
    layer.receiveShadow = true;
    layer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    matrices.forEach((matrix, at) => layer.setMatrixAt(at, matrix));
    layer.computeBoundingSphere();
    layer.count = 0;
    layer.visible = false;
    bed.add(layer);
    return layer;
  });
  fishBeds.set(bed, { layers, matrices, signature: 0 });
  bed.visible = false;
  parent.add(bed);
  return bed;
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
  carrier.name = 'Fish on the line';
  const mesh = new THREE.Mesh(fishGeometry(0), fishFinish);
  mesh.position.y = -0.153;
  mesh.rotation.z = -Math.PI / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  carrier.add(mesh);
  return carrier;
}

export function setCreelFish(carrier, species) {
  carrier.children[0].geometry = fishGeometry(fishIndex(species));
}

export function buildCatchCooler(index = 0, chest = false) {
  if (chest) index = 2;
  const geometry = models[index] ??= {
    cooler: chest ? buildIceChest() : buildCooler(index),
    lid: chest ? buildChestLid() : buildLid(index).rotateY(index === 0 ? Math.PI : 0),
    ice: buildIce(index, chest),
  };
  const cooler = new THREE.Mesh(geometry.cooler, shellFinish);
  const lid = new THREE.Mesh(geometry.lid, shellFinish);
  const ice = new THREE.Mesh(geometry.ice, iceFinish);
  cooler.name = chest ? 'Insulated ice chest' : 'Insulated catch cooler';
  lid.name = 'Cooler lid';
  ice.name = 'Ice bed';
  const hingeSide = index === 1 ? -1 : 1;
  lid.position.set(0, chest ? 0.302 : 0.238, chest ? 0.299 : hingeSide * 0.164);
  ice.receiveShadow = true;
  cooler.add(ice, lid);
  const contents = addFish(cooler, chest ? chestFishPoses : fishPoses);
  for (const prop of [cooler, lid]) prop.castShadow = prop.receiveShadow = true;
  return { cooler, lid, hingeSide, contents };
}

export function buildDockGear(boat, index, parent) {
  const container = buildCatchCooler(index);
  const { cooler } = container;
  const geometry = models[index];
  geometry.tackle ??= buildPail(index);
  const tackle = new THREE.Mesh(geometry.tackle, shellFinish);
  tackle.name = 'Bait pail';
  const { pier, side } = boat.berth;
  cooler.position.set(pier.x + 1.6, pier.deck, pier.z - side * 0.52);
  tackle.position.set(pier.x + 1.7, pier.deck, pier.z + side * 0.52);
  tackle.castShadow = tackle.receiveShadow = true;
  parent.add(cooler, tackle);
  return { ...container, tackle, ...makeBench(boat.berth, parent) };
}

function showFish(bed, count, species) {
  const record = fishBeds.get(bed), { matrices, layers } = record;
  const shown = Number.isFinite(count) ? Math.min(matrices.length, Math.max(0, Math.floor(count))) : 0;
  let remaining = shown;
  // Two bits per fish make a short layout key. Only rewrite the GPU buffers
  // when the contents change, even while a dock crew is sorting on screen.
  let signature = 0;
  const ordered = Array.isArray(species);
  if (species && typeof species === 'object' && !ordered) {
    for (let slot = 0; slot < fishVariants.length; slot++) {
      const quantity = Math.min(remaining, Math.max(0, Math.floor(species[fishVariants[slot].id]) || 0));
      for (let i = 0; i < quantity; i++) signature = (signature << 2) | (slot + 1);
      remaining -= quantity;
    }
  }
  for (let i = 0; i < remaining; i++) {
    signature = (signature << 2) | (fishIndex(ordered ? species[i] : species) + 1);
  }
  if (record.signature === signature) return;
  record.signature = signature;
  bed.visible = signature > 0;
  for (const layer of layers) layer.count = 0;
  let seat = shown;
  for (let layout = signature; layout > 0; layout >>>= 2) {
    const layer = layers[(layout & 3) - 1];
    layer.setMatrixAt(layer.count++, matrices[--seat]);
  }
  for (const layer of layers) {
    layer.visible = layer.count > 0;
    if (layer.visible) layer.instanceMatrix.needsUpdate = true;
  }
}

export function setCatchCooler(gear, count, open = 0, species) {
  showFish(gear.contents, count, species);
  gear.lid.rotation.x = gear.hingeSide * THREE.MathUtils.clamp(open, 0, 1) * 1.64;
}

export function setDockCatch(gear, count, open = 0, landedCount = 0, landedSpecies, creelSpecies) {
  setCatchCooler(gear, count, open, creelSpecies);
  showFish(gear.landedFish, landedCount, landedSpecies);
}
