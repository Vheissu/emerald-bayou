import * as THREE from 'three';
import { plank } from './textures.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { buildFishBuyer, updateFishBuyer } from './fishbuyer.js';
import { buildFishCounter, updateFishCounter } from './fishcounter.js';
import { buildFishPriceSign, updateFishPriceSign } from './fishpricesign.js';
import { MULLET_DOCK_LENGTH } from './mulletlanding.js';

const wood = waterfrontSurface(0xffffff, { roughness: 0.88 });
const metal = waterfrontSurface(0xffffff, { metalness: 0.42, roughness: 0.62 });

function receivingShed(group, atBend) {
  const boards = [], steel = [];
  wood.map ??= plank();
  if (atBend) {
    // Extend the gangway past the rod and crab winch, with an open face for unloading.
    const span = MULLET_DOCK_LENGTH - 14.2;
    for (let i = 0; i < 14; i++) {
      const x = ((i + 0.5) / 14 - 0.5) * span;
      addBox(boards, [0xa99b86, 0x9d9482, 0xb3a792][i % 3], span / 14 - .006, .094, 2.18, x, -.047, .02);
      for (const z of [-.8, .84]) {
        tintGeometry(steel, new THREE.CylinderGeometry(.008, .008, .004, 6).translate(x, .001, z), 0x4a4840);
      }
    }
    for (const z of [-.82, .86]) {
      addBox(boards, 0x82775e, span, .21, .14, 0, -.20, z);
      for (const x of [-1.25, 1.23]) {
        tintGeometry(boards, new THREE.CylinderGeometry(.095, .134, 4.8, 12).translate(x, -2.50, z), 0x776c57);
      }
    }
  }
  for (const x of [-0.7, 0.7]) {
    addBox(boards, 0x847963, 0.085, 2.18, 0.085, x, 1.09, -0.56);
    addBeam(boards, 0x91856c, new THREE.Vector3(x, 1.74, -0.56), new THREE.Vector3(x, 2.12, 0.1), 0.063, 0.065);
  }
  for (const z of [-0.55, 0.57]) addBox(boards, 0x877d67, 1.65, 0.1, 0.075, 0, 2.15, z);
  // Form the ridges in the sheet itself, including the scalloped front lip.
  const section = new THREE.Shape(), segments = 96;
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments - 0.5) * 1.95, y = 0.018 * Math.cos(i * Math.PI / 4);
    if (i === 0) section.moveTo(x, y);
    else section.lineTo(x, y);
  }
  for (let i = segments; i >= 0; i--) section.lineTo((i / segments - 0.5) * 1.95, 0.018 * Math.cos(i * Math.PI / 4) - 0.008);
  section.closePath();
  const roof = new THREE.ExtrudeGeometry(section, { depth: 1.46, bevelEnabled: false });
  roof.translate(0, 0, -0.73).rotateX(0.09).translate(0, 2.25, 0);
  // Batched beam and box geometry is indexed.
  roof.setIndex(Array.from({ length: roof.attributes.position.count }, (_, i) => i));
  tintGeometry(steel, roof, 0x92978e, (x, y, z) => 0.82 + 0.12 * Math.cos(x * 39.2) + 0.04 * Math.sin(z * 13 + x * 9));
  for (const z of [-0.53, 0.54]) for (const x of [-0.81, -0.325, 0.325, 0.81]) {
    tintGeometry(steel, new THREE.CylinderGeometry(0.015, 0.015, 0.011, 6).translate(x, 2.277 - z * 0.09, z), 0x746f63);
  }
  addBox(steel, 0x636961, 0.027, 0.094, 0.027, 0.39, 2.12, 0.05);
  const shade = new THREE.LatheGeometry([
    new THREE.Vector2(0.021, 0.085), new THREE.Vector2(0.05, 0.056),
    new THREE.Vector2(0.088, 0.016), new THREE.Vector2(0.135, -0.006), new THREE.Vector2(0.138, -0.014),
    new THREE.Vector2(0.126, -0.014), new THREE.Vector2(0.067, 0.019), new THREE.Vector2(0.02, 0.047),
  ], 24);
  tintGeometry(steel, shade.translate(.39, 2.04, .05), 0x576b61);
  group.add(waterfrontMesh(boards, wood), waterfrontMesh(steel, metal));
}

export function buildFishReceiver(dock, id = 'tower') {
  const atBend = id === 'mullet-bend';
  const group = new THREE.Group();
  group.name = (atBend ? 'Mullet Bend' : 'Tower Dock') + ' fish receiving';
  group.position.set(-0.04, 0.81, atBend ? -(14.2 + MULLET_DOCK_LENGTH) / 2 : -13.55);
  group.rotation.y = atBend ? -Math.PI / 2 : 2.72;
  receivingShed(group, atBend);
  const sign = buildFishPriceSign(group, id);
  const counter = buildFishCounter(group);
  const buyer = buildFishBuyer(atBend);
  group.add(buyer);
  const bulb = new THREE.PointLight(0xffdbac, 0, 5, 2);
  bulb.position.set(0.39, 2.0, 0.05);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.037, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xf4ead0, emissive: 0xffbc77, emissiveIntensity: 0 }),
  );
  globe.position.copy(bulb.position);
  group.add(bulb, globe);
  dock.add(group);
  return {
    id, group, sign, counter, buyer, bulb, globe, at: group.getWorldPosition(new THREE.Vector3()),
    sale: undefined, weighTime: 0, nextBoardUpdate: 0,
    buyerCue: { player: { x: 0, z: 0 } },
  };
}

export function updateFishReceiver(station, trade, phys, environment, dt, time) {
  const { group, buyer, at, buyerCue } = station;
  const distance = Math.hypot(phys.pos.x - at.x, phys.pos.y - at.z);
  group.visible = distance < 600;
  if (!group.visible) return;
  const receipt = trade.receiptAt(station.id);
  if (distance < 100 && (time >= station.nextBoardUpdate || receipt !== station.sale)) {
    updateFishPriceSign(station.sign, trade.demand(station.id));
    station.nextBoardUpdate = time + 0.5;
  }
  if (receipt !== station.sale) {
    station.weighTime = station.sale === undefined || !receipt ? 0 : 3.1;
    station.sale = receipt;
  }
  updateFishCounter(station.counter, receipt, dt, station.weighTime);
  const workingLight = distance < 44 && (trade.cargo || station.weighTime > 0)
    ? 0.72 * (1 - environment.daylight * 0.88) : 0;
  const light = Math.max(workingLight, environment.night ?? 0, THREE.MathUtils.smoothstep(environment.values.storm, 0.38, 0.79));
  station.bulb.intensity = 4.4 * light;
  station.globe.material.emissiveIntensity = 1.4 * light;
  buyer.visible = distance < 155;
  if (buyer.visible) {
    buyerCue.time = time;
    buyerCue.dt = dt;
    buyerCue.near = distance < 23;
    buyerCue.greet = !!trade.cargo && distance < 42 && Math.abs(phys.speed) < 6;
    buyerCue.weighing = station.weighTime;
    buyerCue.player.x = phys.pos.x;
    buyerCue.player.z = phys.pos.y;
    updateFishBuyer(buyer, buyerCue);
  }
  station.weighTime = Math.max(0, station.weighTime - dt);
}
