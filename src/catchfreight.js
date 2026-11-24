import * as THREE from 'three';
import { STOCK_COOLER_CAPACITY } from './boatmods.js';
import { buildCatchCooler, setCatchCooler } from './skiffdockgear.js';
import { addBox, addBeam, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';

const totes = new WeakMap();
const restraintFinish = waterfrontSurface(0xffffff, { roughness: 0.79, metalness: 0.12 });
const labelGeometry = new THREE.PlaneGeometry(0.21, 0.0875);
let cradleGeometry;
let strapsGeometry;
let labelMaterial;

function tradeLabel() {
  if (labelMaterial) return labelMaterial;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#cfc19b';
  ctx.fillRect(0, 0, 192, 80);
  ctx.fillStyle = '#314843';
  ctx.fillRect(0, 0, 192, 7);
  ctx.fillRect(0, 71, 192, 9);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GULF CUT', 96, 43, 174);
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('KEEP ON ICE', 96, 63, 174);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  labelMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78, color: 0xe4dac4 });
  return labelMaterial;
}

export function buildTradeTote({ style = 0, capacity = STOCK_COOLER_CAPACITY } = {}) {
  const extended = capacity > STOCK_COOLER_CAPACITY;
  const gear = buildCatchCooler(style, extended);
  const { cooler } = gear;
  cooler.name = extended ? 'Gulf Cut ice chest' : 'Gulf Cut freight cooler';
  const label = tradeLabel();
  if (label) {
    const tag = new THREE.Mesh(labelGeometry, label);
    tag.name = 'Gulf Cut freight label';
    if (extended) {
      tag.position.set(0.330, 0.147, -0.151);
      tag.scale.setScalar(1.13);
    } else tag.position.set(0.266, 0.137, -0.034);
    tag.rotation.y = Math.PI / 2;
    tag.receiveShadow = true;
    cooler.add(tag);
  }
  totes.set(cooler, gear);
  return cooler;
}

export function setTradeTote(tote, count, open = 1, items) {
  setCatchCooler(totes.get(tote), count, open, items);
}

// An anti-slip tray sits against the starboard gunwale beside the seat. It
// stays below the footrest, beyond the front bench and ahead of the fuel tank.
function buildCradle() {
  const parts = [];
  addBox(parts, 0x43463c, 0.692, 0.019, 0.411, 0, 0.01, 0);
  addBox(parts, 0x252e2b, 0.57, 0.013, 0.343, 0, 0.026, 0);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      addBox(parts, 0x777865, 0.078, 0.035, 0.071, side * 0.307, 0.025, end * 0.163);
      addBox(parts, 0x838579, 0.02, 0.014, 0.02, side * 0.325, 0.052, end * 0.163);
    }
  }
  return waterfrontMesh(parts, restraintFinish).geometry;
}

function buildStraps() {
  const parts = [];
  for (const side of [-1, 1]) {
    const hook = new THREE.Vector3(side * 0.297, 0.232, 0.022);
    for (const end of [-1, 1]) {
      const foot = new THREE.Vector3(side * 0.322, 0.042, end * 0.156);
      addBeam(parts, 0x8b6945, foot, hook, 0.035, 0.008);
    }
    addBox(parts, 0x5c615a, 0.027, 0.058, 0.067, side * 0.304, 0.165, -0.027);
    addBox(parts, 0x969388, 0.028, 0.019, 0.066, side * 0.306, 0.186, -0.03);
  }
  return waterfrontMesh(parts, restraintFinish).geometry;
}

export function buildCatchFreight(boat) {
  const group = new THREE.Group();
  group.name = 'Player fish freight';
  group.position.set(0.759, 0.64, 0.492);
  const bed = new THREE.Mesh(cradleGeometry ??= buildCradle(), restraintFinish);
  bed.name = 'Freight deck tray';
  bed.castShadow = bed.receiveShadow = true;
  const straps = new THREE.Mesh(strapsGeometry ??= buildStraps(), restraintFinish);
  straps.name = 'Freight tie-downs';
  straps.castShadow = straps.receiveShadow = true;
  const tote = buildTradeTote();
  setTradeTote(tote, 0, 0);
  tote.position.y = 0.033;
  group.add(bed, straps, tote);
  group.visible = false;
  boat.add(group);
  return { group, bed, straps, tote, iceChest: null, active: tote, cargo: null, latched: false, opening: 0 };
}

export function updateCatchFreight(freight, cargo, dt, { speed = 0, inspect = false, present = true, capacity = STOCK_COOLER_CAPACITY } = {}) {
  const upgraded = capacity > STOCK_COOLER_CAPACITY;
  freight.group.visible = (upgraded || Boolean(cargo)) && present;
  if (upgraded && !freight.iceChest) {
    freight.iceChest = buildTradeTote({ capacity });
    freight.iceChest.position.y = 0.033;
    freight.group.add(freight.iceChest);
  }
  const active = upgraded ? freight.iceChest : freight.tote;
  const changed = active !== freight.active || cargo !== freight.cargo;
  if (active !== freight.active) {
    freight.active.visible = false;
    active.visible = true;
    freight.bed.scale.set(upgraded ? 1.22 : 1, upgraded ? 1.24 : 1, upgraded ? 1.57 : 1);
    freight.straps.scale.copy(freight.bed.scale);
    freight.active = active;
  }
  if ((cargo?.count || 0) > (freight.cargo?.count || 0)) freight.latched = false;
  freight.cargo = cargo;
  if (!cargo) {
    freight.latched = false;
    freight.opening = 0;
    if (changed) setTradeTote(active, 0, 0);
    return;
  }
  const moving = Math.abs(speed) >= 0.85;
  if (moving) freight.latched = true;
  const open = !moving && (inspect || !freight.latched) ? 1 : 0;
  const rate = 1 - Math.exp(-Math.max(0, dt) * 8);
  const movement = (open - freight.opening) * rate;
  if (changed || Math.abs(movement) > 0.00001) {
    freight.opening += movement;
    setTradeTote(active, cargo.count, freight.opening, cargo.items);
  }
}
