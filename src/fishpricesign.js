import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FISH_IDS } from './fishmarket.js';

let signModel;
function loadSigns() {
  signModel ??= new GLTFLoader().loadAsync(new URL('../assets/environment/fish-house-signs.glb', import.meta.url).href)
    .then(({ scene }) => {
      scene.traverse(obj => {
        if (!obj.isMesh) return;
        obj.receiveShadow = obj.castShadow = true;
        if (obj.material.map) obj.material.map.anisotropy = 8;
      });
      return scene;
    });
  return signModel;
}

// Broad grease-pencil figures on the removable waxed-paper slips.
const strokes = {
  '$': 'M20 8 Q5 2 5 14 Q5 19 13 21 Q26 25 19 32 Q13 39 3 31 M15 1 L11 40',
  0: 'M17 3 C3 0 0 32 9 36 C22 42 29 5 17 3Z',
  1: 'M6 12 L16 3 L12 35 M4 36 L20 35',
  2: 'M4 12 Q8 0 18 3 Q28 7 15 20 L2 35 Q13 33 23 35',
  3: 'M4 8 Q14 0 21 5 Q27 13 11 19 Q25 17 21 29 Q17 40 2 34',
  4: 'M18 4 L2 25 L23 24 M18 12 L15 36',
  5: 'M23 3 L7 4 L4 19 Q13 13 20 19 Q25 27 16 34 Q10 39 1 34',
  6: 'M21 3 Q5 4 3 24 Q1 38 13 36 Q23 34 22 24 Q21 15 6 21',
  7: 'M3 5 Q12 2 24 4 Q14 16 8 35',
  8: 'M11 19 C-3 12 9 0 17 3 C30 6 18 16 11 19 C-4 25 1 40 13 36 C25 33 26 24 11 19Z',
  9: 'M20 17 Q18 1 10 4 Q0 7 3 17 Q6 25 20 17 Q17 30 8 36',
};

function priceSlip() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.88 });
}

function writeSlip(material, row) {
  const texture = material.map, ctx = texture.image.getContext('2d');
  ctx.fillStyle = '#e8dbb9';
  ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = '#cebd94';
  ctx.fillRect(0, 177, 256, 15);
  ctx.save();
  ctx.translate(24, 13);
  ctx.transform(1, -0.026, -0.055, 1, 0, 0);
  ctx.scale(2.42, 2.56);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 2.85;
  ctx.strokeStyle = '#273c37';
  for (const digit of '$' + row.price) {
    ctx.stroke(new Path2D(strokes[digit]));
    ctx.translate(30, 0);
  }
  ctx.restore();
  ctx.fillStyle = row.remaining ? '#8c3f2d' : '#5c665b';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(row.remaining ? 'NEED ' + row.remaining : 'EACH', 128, 153);
  texture.needsUpdate = true;
}

export function buildFishPriceSign(group, id) {
  const state = { slips: new Map(), stamps: new Map(), ready: false };
  loadSigns().then(template => {
    const model = template.clone(true);
    model.name = 'Fish house signs';
    model.getObjectByName(id === 'tower' ? 'fascia_bend' : 'fascia_tower').visible = false;
    for (const species of FISH_IDS) {
      const face = model.getObjectByName('ticket_' + species);
      face.material = priceSlip();
      state.slips.set(species, face.material);
    }
    group.add(model);
    state.ready = true;
  }).catch(err => console.warn('Fish house signs', err));
  return state;
}

export function updateFishPriceSign(state, prices) {
  if (!state.ready) return;
  for (const row of prices) {
    const stamp = row.price * 100 + row.remaining;
    if (state.stamps.get(row.species) === stamp) continue;
    writeSlip(state.slips.get(row.species), row);
    state.stamps.set(row.species, stamp);
  }
}
