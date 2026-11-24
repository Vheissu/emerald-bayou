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

// The posted "wanted" quantity is how many fish still earn today's premium.
function paintPrices(ctx, station, prices) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.fillStyle = '#303934';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = station.id === 'tower' ? '#405b54' : '#805044';
  ctx.fillRect(0, 0, w, 80);
  ctx.fillStyle = '#f3ead4';
  ctx.textAlign = 'left';
  ctx.font = 'bold 47px Georgia';
  ctx.fillText(station.name.toUpperCase(), 26, 56);
  ctx.textAlign = 'right';
  ctx.font = 'bold 29px Georgia';
  ctx.fillText('FISH BOUGHT', w - 25, 54);
  ctx.strokeStyle = '#aba895';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#d5c49a';
  ctx.textAlign = 'left';
  ctx.fillText('CATCH', 28, 123);
  ctx.textAlign = 'right';
  ctx.fillText('EACH', 506, 123);
  ctx.fillText('WANTED', w - 28, 123);
  for (let i = 0; i < prices.length; i++) {
    const row = prices[i], y = 137 + i * 72;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.moveTo(27, y);
    ctx.lineTo(w - 27, y - 1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#eee9d8';
    ctx.font = 'bold 40px Georgia';
    ctx.textAlign = 'left';
    ctx.fillText(row.name, 28, y + 52, 360);
    ctx.textAlign = 'right';
    ctx.fillText('$' + row.price, 506, y + 52);
    ctx.fillStyle = row.remaining ? '#e4c288' : '#c1c3ad';
    ctx.fillText(row.remaining ? String(row.remaining) : '—', w - 32, y + 52);
  }
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
    if (i % 4 === 0) ctx.fillText(String(i * 2), sx * 43, cy * 43);
  }
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('LB', 0, 37);
}

export function buildFishReceiver(dock, id = 'tower') {
  const atBend = id === 'mullet-bend';
  const name = atBend ? 'Mullet Bend' : 'Tower Dock';
  const group = new THREE.Group();
  group.name = name + ' fish receiving';
  group.position.set(-0.04, 0.81, atBend ? -11.45 : -13.55);
  // The opening looks over the outer end of the pier, towards its tie-up.
  group.rotation.y = atBend ? -Math.PI / 2 : 2.72;
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
  for (const z of [0.08, 0.26, 0.44]) addBox(boards, 0x82715d, 1.12, 0.035, 0.16, 0, 0.2, z);
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
  for (const x of [-0.68, 0.68]) {
    addBox(boards, 0x8a7c66, 0.065, 0.9, 0.07, x, 2.47, 0.75);
    addBox(boards, 0x796b59, 0.065, 0.07, 0.24, x, 2.15, 0.65);
  }
  addBox(boards, 0x92836a, 1.85, 0.94, 0.07, 0, 2.46, 0.81);
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
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.79, 0.88), paintedFace(768, 370, ctx => paintPrices(ctx, { id, name }, [])));
  sign.name = name + ' posted prices';
  sign.position.set(0, 2.46, 0.846);
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
  const buyer = person(mulberry32(atBend ? 8421 : 73187), { pose: 'stand', work: true, hat: true, waders: true });
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
  const tote = buildTradeTote({ style: 1, capacity: 8 });
  // The buyer weighs the catch in an open bin and keeps its cover under the bench.
  const lid = tote.getObjectByName('Cooler lid');
  tote.remove(lid);
  const benchLid = lid.clone();
  benchLid.position.set(-0.12, 0.22, 0.54);
  group.add(benchLid);
  tote.position.set(-0.13, 0.899, 0.22);
  tote.rotation.y = Math.PI + 0.34;
  tote.visible = false;
  group.add(tote);
  dock.add(group);
  return {
    id, name, sign, boardStamp: '', nextBoardUpdate: 0,
    group,
    buyer,
    tote, benchLid,
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
  const receipt = trade.receiptAt(station.id);
  if (distance < 100 && (time >= station.nextBoardUpdate || receipt !== station.sale)) {
    station.nextBoardUpdate = time + 0.75;
    const prices = trade.demand(station.id);
    const stamp = prices.map(row => row.price + '/' + row.remaining).join(',');
    if (stamp !== station.boardStamp) {
      const texture = station.sign.material.map;
      paintPrices(texture.image.getContext('2d'), station, prices);
      texture.needsUpdate = true;
      station.boardStamp = stamp;
    }
  }
  if (receipt !== station.sale) {
    station.weighTime = station.sale === undefined || !receipt ? 0 : 3.1;
    station.sale = receipt;
    tote.visible = station.benchLid.visible = !!receipt;
    setTradeTote(tote, receipt?.count || 0, 1, receipt?.items);
  }
  const target = receipt ? 3.1 + 2.4 * receipt.count : 0;
  station.load = THREE.MathUtils.damp(station.load, target, 6, dt);
  const settle = Math.sin(station.weighTime * 14) * 0.1 * (station.weighTime / 3.1);
  needle.rotation.z = 0.72 * Math.PI - station.load * ((1.44 * Math.PI) / 40) + settle;
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
