import * as THREE from 'three';
import { animatePerson, person, wave } from './folk.js';
import { plank } from './textures.js';
import { mulberry32 } from './noise.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { buildTradeTote, setTradeTote } from './catchfreight.js';

const wood = waterfrontSurface(0xffffff, { roughness: 0.88 });
const metal = waterfrontSurface(0xffffff, { metalness: 0.38, roughness: 0.59 });

function paintedFace(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.83 });
}

function letterBoard(ctx) {
  ctx.fillStyle = '#384e4e';
  ctx.fillRect(0, 0, 576, 160);
  ctx.strokeStyle = '#b1ad89';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 9, 556, 142);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f1e8cb';
  ctx.font = 'bold 27px Georgia';
  ctx.fillText('TOWER DOCK', 288, 49);
  ctx.font = 'bold 78px Georgia';
  ctx.fillText('FISH BOUGHT', 288, 127, 525);
}

function scaleDial(ctx) {
  ctx.fillStyle = '#e4dec2';
  ctx.fillRect(0, 0, 160, 160);
  ctx.translate(80, 80);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ctx.strokeStyle = '#333a37';
  ctx.font = 'bold 18px sans-serif';
  for (let i = 0; i <= 20; i++) {
    const angle = (-0.72 + (1.44 * i) / 20) * Math.PI,
      sx = Math.sin(angle),
      cy = -Math.cos(angle);
    const r = i % 4 === 0 ? 54 : 61;
    ctx.lineWidth = i % 4 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(sx * r, cy * r);
    ctx.lineTo(sx * 70, cy * 70);
    ctx.stroke();
    if (i % 4 === 0) ctx.fillText(String(i), sx * 43, cy * 43);
  }
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('LB', 0, 37);
}

export function buildFishReceiver(dock) {
  const group = new THREE.Group();
  group.name = 'Tower fish receiving';
  group.position.set(-0.04, 0.81, -13.55);
  // The opening looks over the outer end of the pier, towards its tie-up.
  group.rotation.y = 2.72;
  wood.map ??= plank();
  const boards = [],
    steel = [];
  for (const x of [-0.7, 0.7]) {
    addBox(boards, 0x847963, 0.085, 2.18, 0.085, x, 1.09, -0.56);
    addBeam(boards, 0x91856c, new THREE.Vector3(x, 1.74, -0.56), new THREE.Vector3(x, 2.12, 0.1), 0.063, 0.065);
  }
  for (let i = 0; i < 7; i++)
    addBox(boards, i % 2 ? 0x998875 : 0xa0927a, 0.179, 0.066, 0.53, (i - 3) * 0.185, 0.72, 0.26);
  for (const x of [-0.5, 0.5]) for (const z of [0.08, 0.45]) addBox(boards, 0x807165, 0.073, 0.7, 0.072, x, 0.35, z);
  addBox(boards, 0x82715d, 1.23, 0.095, 0.05, 0, 0.57, 0.46);
  for (const z of [-0.55, 0.57]) addBox(boards, 0x877d67, 1.65, 0.1, 0.075, 0, 2.15, z);
  const roof = new THREE.BoxGeometry(1.84, 0.045, 1.47).rotateX(0.1).translate(0, 2.23, 0);
  tintGeometry(steel, roof, 0x767e75);
  for (let i = -5; i <= 5; i++)
    tintGeometry(
      steel,
      new THREE.BoxGeometry(0.025, 0.025, 1.47).rotateX(0.1).translate(i * 0.17, 2.26, 0),
      0x858a80,
    );
  addBox(boards, 0x334849, 1.35, 0.374, 0.05, 0, 1.99, 0.62);
  addBox(steel, 0x5b7871, 0.79, 0.1, 0.5, -0.13, 0.81, 0.24);
  addBox(steel, 0xa5aca1, 0.76, 0.036, 0.47, -0.13, 0.88, 0.24);
  addBox(steel, 0x5c6863, 0.064, 0.27, 0.063, 0.424, 0.88, 0.305);
  tintGeometry(
    steel,
    new THREE.CylinderGeometry(0.143, 0.143, 0.063, 28).rotateX(Math.PI / 2).translate(0.425, 1.008, 0.312),
    0x566861,
  );
  // Docket book clipped to the end of the worktop beside the scale.
  addBox(steel, 0x485145, 0.23, 0.018, 0.18, 0.47, 0.761, 0.11);
  addBox(steel, 0xd8ccab, 0.21, 0.013, 0.158, 0.47, 0.777, 0.11);
  addBox(steel, 0x787d6b, 0.076, 0.015, 0.021, 0.47, 0.791, 0.047);
  for (let row = 0; row < 5; row++) addBox(steel, 0x9e9a86, 0.153, 0.003, 0.002, 0.47, 0.785, 0.084 + row * 0.019);
  group.add(waterfrontMesh(boards, wood), waterfrontMesh(steel, metal));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.31, 0.363), paintedFace(576, 160, letterBoard));
  sign.position.set(0, 1.99, 0.648);
  group.add(sign);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), paintedFace(160, 160, scaleDial));
  face.position.set(0.425, 1.008, 0.345);
  group.add(face);
  const needle = new THREE.Group();
  needle.position.copy(face.position);
  needle.position.z += 0.002;
  const needleBlade = new THREE.Mesh(
    new THREE.BoxGeometry(0.009, 0.106, 0.003),
    new THREE.MeshStandardMaterial({ color: 0x953e2f }),
  );
  needleBlade.position.y = 0.038;
  needle.add(needleBlade);
  group.add(needle);
  const bulb = new THREE.PointLight(0xffdbac, 0, 5, 2);
  bulb.position.set(0.1, 1.98, -0.06);
  group.add(bulb);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.047, 9, 6),
    new THREE.MeshStandardMaterial({
      color: 0xded8c8,
      emissive: 0xffbc77,
      emissiveIntensity: 0,
    }),
  );
  globe.position.copy(bulb.position);
  group.add(globe);
  const buyer = person(mulberry32(73187), { pose: 'stand', work: true, hat: true, waders: true });
  buyer.name = 'Fish buyer';
  const pencil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.004, 0.13, 6),
    new THREE.MeshStandardMaterial({ color: 0xb79644 }),
  );
  pencil.rotation.z = 0.91;
  pencil.rotation.x = 0.29;
  pencil.position.set(0.002, -0.009, 0.032);
  buyer.userData.arms[1].hand.add(pencil);
  buyer.position.set(0.03, 0, -0.32);
  buyer.rotation.y = 0.03;
  buyer.userData.act = 'idle';
  buyer.userData.actDur = Infinity;
  group.add(buyer);
  const tote = buildTradeTote({ style: 1 });
  tote.position.set(-0.13, 0.899, 0.22);
  tote.rotation.y = 0.34;
  tote.visible = false;
  group.add(tote);
  dock.add(group);
  return {
    group,
    buyer,
    tote,
    bulb,
    globe,
    needle,
    at: group.getWorldPosition(new THREE.Vector3()),
    sale: undefined,
    weighTime: 0,
    load: 0,
    greeted: false,
  };
}

export function updateFishReceiver(station, trade, phys, environment, dt, time) {
  const { group, buyer, tote, needle, at } = station;
  const distance = Math.hypot(phys.pos.x - at.x, phys.pos.y - at.z);
  group.visible = distance < 600;
  if (!group.visible) return;
  const receipt = trade.lastSale;
  if (receipt !== station.sale) {
    station.weighTime = station.sale === undefined || !receipt ? 0 : 3.1;
    station.sale = receipt;
    tote.visible = !!receipt;
    setTradeTote(tote, receipt?.count || 0, 1);
  }
  const target = receipt ? 3.1 + 2.4 * receipt.count : 0;
  station.load = THREE.MathUtils.damp(station.load, target, 6, dt);
  const settle = Math.sin(station.weighTime * 14) * 0.1 * (station.weighTime / 3.1);
  needle.rotation.z = 0.72 * Math.PI - station.load * ((1.44 * Math.PI) / 20) + settle;
  buyer.visible = distance < 155;
  const workingLight = distance < 44 && (trade.cargo || station.weighTime > 0) ? 0.72 : 0;
  const light = Math.max(
    workingLight,
    environment.night ?? 0,
    THREE.MathUtils.smoothstep(environment.values.storm, 0.38, 0.79),
  );
  station.bulb.intensity = 4.4 * light;
  station.globe.material.emissiveIntensity = 1.4 * light;
  if (!buyer.visible || dt <= 0) return;
  const approaching = !!trade.cargo && distance < 42 && Math.abs(phys.speed) < 6;
  if (approaching && !station.greeted) {
    wave(buyer);
    station.greeted = true;
  }
  if (distance > 55 || !trade.cargo) station.greeted = false;
  const weighing = station.weighTime > 0;
  station.weighTime = Math.max(0, station.weighTime - dt);
  const pose = buyer.userData.base;
  pose.sx = weighing ? 0.31 : 0.06;
  pose.hdx = weighing ? 0.38 : 0.07;
  pose.rf = weighing ? 1.04 + 0.08 * Math.sin(time * 8) : 0.39;
  pose.re = weighing ? 0.6 : 0.88;
  pose.sy = weighing ? -0.28 : 0.03;
  animatePerson(
    buyer,
    time,
    dt,
    !weighing && distance < 23 ? { x: phys.pos.x, z: phys.pos.y, speed: phys.speed } : null,
  );
}
