import * as THREE from 'three';
import { mulberry32, tileableNoise } from './noise.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function hsl(h, s, l, a = 1) { return `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a})`; }

function srgbTex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Coverage-preserving mip chain for alpha-tested foliage so distant leaves don't evaporate.
function coverageMips(base, alphaTest) {
  const levels = [base];
  const ctx0 = base.getContext('2d');
  const d0 = ctx0.getImageData(0, 0, base.width, base.height).data;
  let cov0 = 0; for (let i = 3; i < d0.length; i += 4) if (d0[i] / 255 > alphaTest) cov0++;
  cov0 /= (d0.length / 4);
  let prev = base;
  while (prev.width > 1 || prev.height > 1) {
    const w = Math.max(1, prev.width >> 1), h = Math.max(1, prev.height >> 1);
    const c = canvas(w, h); const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h); const d = img.data;
    let lo = 1, hi = 6;
    for (let it = 0; it < 12; it++) {
      const s = (lo + hi) / 2; let cov = 0;
      for (let i = 3; i < d.length; i += 4) if (Math.min(1, d[i] / 255 * s) > alphaTest) cov++;
      cov /= (d.length / 4);
      if (cov < cov0) lo = s; else hi = s;
    }
    const s = (lo + hi) / 2;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * s);
    ctx.putImageData(img, 0, 0);
    levels.push(c); prev = c;
  }
  return levels;
}

function foliageTex(c, alphaTest = 0.5) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mipmaps = coverageMips(c, alphaTest);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------- Foliage ----------
// Bald cypress: feathery sprays of tiny flat needles along thin twigs. Sprays overlap in depth;
// deeper sprays are darker/bluer (canopy self-shadowing), top sprays lighter and warmer.
export function cypressFoliage(seed = 3) {
  const S = 1024; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(seed);
  ctx.lineCap = 'round';
  // shadowed interior mass so the crown silhouette is solid; edges stay feathery
  for (let i = 0; i < 22; i++) {
    const x = 512 + (r() - 0.5) * 420, y = 512 + (r() - 0.5) * 420, rad = 90 + r() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, hsl(100 + r() * 16, 28, 19, 0.66)); g.addColorStop(0.55, hsl(100, 28, 19, 0.42)); g.addColorStop(1, hsl(100, 28, 19, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  const N = 210;
  for (let i = 0; i < N; i++) {
    const depth = i / N; // 0 = deep inside, 1 = outermost
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 410 * (0.7 + depth * 0.3);
    const sx = 512 + Math.cos(a) * rr, sy = 512 + Math.sin(a) * rr;
    const dir = a + (r() - 0.5) * 1.6;
    const len = 90 + r() * 130;
    const light = 0.55 + depth * 0.55;
    const hueBase = 78 + r() * 20 + (1 - depth) * 12; // deep = bluer
    // twig
    ctx.strokeStyle = hsl(34, 22, 18 * light + 6, 0.9); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(dir) * len, sy + Math.sin(dir) * len); ctx.stroke();
    // pinnate side twigs, each carrying rows of tiny needles
    for (let t = 6; t < len; t += 9 + r() * 5) {
      const px = sx + Math.cos(dir) * t, py = sy + Math.sin(dir) * t;
      const sl = (22 + r() * 18) * (1 - (t / len) * 0.6);
      for (const side of [-1, 1]) {
        const ang = dir + side * (0.7 + r() * 0.35);
        ctx.strokeStyle = hsl(40, 20, 20 * light + 4, 0.8); ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * sl, py + Math.sin(ang) * sl); ctx.stroke();
        const sat = 34 + r() * 18;
        for (let u = 2; u < sl; u += 2.4) {
          const nx = px + Math.cos(ang) * u, ny = py + Math.sin(ang) * u;
          const nl = (7 + r() * 5) * (1 - (u / sl) * 0.5);
          const lum = (30 + r() * 14) * light * (0.85 + (u / sl) * 0.3);
          for (const s2 of [-1, 1]) {
            const na = ang + s2 * (0.95 + r() * 0.4);
            ctx.strokeStyle = hsl(hueBase + r() * 8, sat, lum, 0.96); ctx.lineWidth = 2.6;
            ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + Math.cos(na) * nl, ny + Math.sin(na) * nl); ctx.stroke();
          }
        }
      }
    }
  }
  return foliageTex(c);
}

// Live oak: dense clusters of small, glossy, elliptical leaves with a highlight toward the tip.
export function oakFoliage(seed = 5) {
  const S = 1024; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(seed);
  for (let i = 0; i < 20; i++) {
    const x = 512 + (r() - 0.5) * 460, y = 512 + (r() - 0.5) * 460, rad = 100 + r() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, hsl(112, 30, 16, 0.68)); g.addColorStop(0.55, hsl(112, 30, 16, 0.42)); g.addColorStop(1, hsl(112, 30, 16, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  const N = 260;
  for (let i = 0; i < N; i++) {
    const depth = i / N;
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 410;
    const cx = 512 + Math.cos(a) * rr, cy = 512 + Math.sin(a) * rr;
    const light = 0.55 + depth * 0.6;
    const tw = r() * Math.PI * 2, tl = 24 + r() * 30;
    ctx.strokeStyle = hsl(28, 26, 16 * light + 5, 0.85); ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(tw) * tl, cy - Math.sin(tw) * tl); ctx.lineTo(cx + Math.cos(tw) * tl, cy + Math.sin(tw) * tl); ctx.stroke();
    const leaves = 9 + Math.floor(r() * 10);
    const hueC = 88 + r() * 30 + (1 - depth) * 12;
    for (let k = 0; k < leaves; k++) {
      const along = (r() - 0.5) * 2 * tl;
      const lx = cx + Math.cos(tw) * along + (r() - 0.5) * 16, ly = cy + Math.sin(tw) * along + (r() - 0.5) * 16;
      const rot = tw + (r() < 0.5 ? 1 : -1) * (0.9 + r() * 0.8); const lw = 11 + r() * 7, lh = 24 + r() * 14;
      const hue = hueC + r() * 10, sat = 28 + r() * 20, lum = (20 + r() * 12) * light;
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot);
      const g = ctx.createLinearGradient(0, -lh / 2, 0, lh / 2);
      g.addColorStop(0, hsl(hue, sat, lum * 0.8, 0.98)); g.addColorStop(0.6, hsl(hue, sat, lum, 0.98)); g.addColorStop(1, hsl(hue - 4, sat + 4, lum * 1.12, 0.98));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, lw / 2, lh / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hsl(hue, sat, lum * 0.6, 0.55); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, -lh / 2); ctx.lineTo(0, lh / 2); ctx.stroke();
      // specular streak
      ctx.strokeStyle = hsl(hue, sat * 0.6, Math.min(70, lum * 1.7), 0.35); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-lw * 0.18, -lh * 0.25); ctx.lineTo(-lw * 0.1, lh * 0.15); ctx.stroke();
      ctx.restore();
    }
  }
  return foliageTex(c);
}

export function palmFrond(seed = 7) {
  const S = 512; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(seed);
  ctx.lineCap = 'round';
  const ox = 256, oy = 470;
  // petiole
  ctx.strokeStyle = hsl(70, 30, 30); ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(ox, 512); ctx.lineTo(ox, oy - 40); ctx.stroke();
  const n = 46;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const ang = -Math.PI / 2 + (f - 0.5) * 2.9;
    const len = (250 + r() * 120) * (1 - Math.abs(f - 0.5) * 0.35);
    const hue = 78 + r() * 22, sat = 40 + r() * 20, lum = 26 + r() * 16;
    const droop = 0.35 + r() * 0.3;
    const segs = 10;
    let px = ox, py = oy - 30, pa = ang;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const w = 9 * (1 - t) + 1.2;
      const nx = px + Math.cos(pa) * (len / segs), ny = py + Math.sin(pa) * (len / segs);
      ctx.strokeStyle = hsl(hue, sat, lum * (0.8 + t * 0.4), 0.97); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny; pa += droop * 0.09 * Math.sign(Math.cos(ang) || 1) * (Math.abs(Math.cos(ang)) + 0.3);
    }
  }
  return foliageTex(c);
}

export function mossStrands(seed = 11) {
  const W = 256, H = 512; const c = canvas(W, H); const ctx = c.getContext('2d'); const r = mulberry32(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    let x = 40 + r() * 176, y = 0;
    const len = 300 + r() * 200; const freq = 0.02 + r() * 0.03, amp = 6 + r() * 10, ph = r() * 6;
    const lum = 48 + r() * 22;
    ctx.strokeStyle = hsl(85 + r() * 20, 12 + r() * 10, lum, 0.85);
    ctx.lineWidth = 1.6 + r() * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let t = 0; t < len; t += 6) {
      y = t; const xx = x + Math.sin(t * freq + ph) * amp + Math.sin(t * 0.11 + ph) * 2;
      ctx.lineTo(xx, y);
      if (r() < 0.12) { // tendril
        const tl = 8 + r() * 18, ta = (r() - 0.5) * 2.5;
        ctx.moveTo(xx + Math.cos(ta) * tl, y + Math.abs(Math.sin(ta)) * tl); ctx.moveTo(xx, y);
      }
    }
    ctx.stroke();
  }
  // wispy fine hairs
  for (let i = 0; i < 90; i++) {
    const x = 30 + r() * 196, y = r() * 380; const l = 10 + r() * 30, a = Math.PI / 2 + (r() - 0.5) * 1.6;
    ctx.strokeStyle = hsl(90, 14, 60, 0.6); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return foliageTex(c, 0.35);
}

export function grassClump(seed = 13, tall = false) {
  const S = 256; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(seed);
  ctx.lineCap = 'round';
  const n = tall ? 16 : 28;
  for (let i = 0; i < n; i++) {
    const x0 = 128 + (r() - 0.5) * (tall ? 70 : 110);
    const len = (tall ? 200 : 120) + r() * (tall ? 56 : 120);
    const lean = (r() - 0.5) * (tall ? 0.5 : 1.3);
    const hue = tall ? 60 + r() * 25 : 85 + r() * 30, sat = tall ? 30 + r() * 15 : 38 + r() * 22, lum = tall ? 28 + r() * 18 : 24 + r() * 18;
    const segs = 8; let px = x0, py = 256, pa = -Math.PI / 2 + lean * 0.3;
    for (let s = 0; s < segs; s++) {
      const t = s / segs; const w = (tall ? 5 : 4.5) * (1 - t) + 0.8;
      const nx = px + Math.cos(pa) * len / segs, ny = py + Math.sin(pa) * len / segs;
      ctx.strokeStyle = hsl(hue, sat, lum * (0.75 + t * 0.5), 1); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny; pa += lean * 0.12;
    }
    if (tall && r() < 0.5) { // cattail head
      ctx.fillStyle = hsl(25, 45, 22); ctx.beginPath(); ctx.ellipse(px, py + 14, 4.5, 16, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  return foliageTex(c, 0.45);
}

// ---------- Surfaces ----------
function colorNoiseTexture(size, seed, fn, octaves = 5, base = 4) {
  const n1 = tileableNoise(size, seed, octaves, base, 0.5);
  const n2 = tileableNoise(size, seed + 77, 3, base * 4, 0.6);
  const n3 = tileableNoise(size, seed + 191, 2, base * 16, 0.5);
  const c = canvas(size, size); const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size); const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const col = fn(n1[i], n2[i], n3[i], i);
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
const clamp255 = (v) => Math.max(0, Math.min(255, v));

export function grassGround() {
  const c = colorNoiseTexture(512, 21, (a, b, d) => {
    const v = a * 0.6 + b * 0.3 + d * 0.1;
    const dirt = Math.max(0, (a - 0.62) * 3);
    let r = 60 + v * 70, g = 88 + v * 80, bl = 30 + v * 40;
    r = r * (1 - dirt) + (95 + v * 40) * dirt; g = g * (1 - dirt) + (78 + v * 30) * dirt; bl = bl * (1 - dirt) + (50 + v * 20) * dirt;
    return [clamp255(r), clamp255(g), clamp255(bl)];
  });
  // blade streaks
  const ctx = c.getContext('2d'); const r = mulberry32(99);
  ctx.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const x = r() * 512, y = r() * 512, l = 4 + r() * 10, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    ctx.strokeStyle = hsl(85 + r() * 30, 40, 22 + r() * 30, 0.5); ctx.lineWidth = 1 + r();
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); ctx.stroke();
    }
  }
  return srgbTex(c, true);
}

export function mudGround() {
  const c = colorNoiseTexture(512, 33, (a, b, d) => {
    const v = a * 0.55 + b * 0.3 + d * 0.15;
    return [clamp255(50 + v * 55), clamp255(46 + v * 45), clamp255(30 + v * 30)];
  });
  return srgbTex(c, true);
}

export function sandGround() {
  const c = colorNoiseTexture(512, 45, (a, b, d) => {
    const v = a * 0.5 + b * 0.35 + d * 0.15;
    const algae = Math.max(0, (b - 0.55) * 2.2);
    let r = 150 + v * 70, g = 140 + v * 60, bl = 95 + v * 45;
    r = r * (1 - algae) + 70 * algae; g = g * (1 - algae) + 95 * algae; bl = bl * (1 - algae) + 55 * algae;
    return [clamp255(r), clamp255(g), clamp255(bl)];
  });
  return srgbTex(c, true);
}

let sharedNoiseTexture = null;

export function noiseTex() {
  if (sharedNoiseTexture) return sharedNoiseTexture;
  const size = 256;
  const n1 = tileableNoise(size, 5, 4, 4, 0.5), n2 = tileableNoise(size, 6, 4, 6, 0.5), n3 = tileableNoise(size, 8, 5, 3, 0.55), n4 = tileableNoise(size, 9, 2, 8, 0.5);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { data[i * 4] = n1[i] * 255; data[i * 4 + 1] = n2[i] * 255; data[i * 4 + 2] = n3[i] * 255; data[i * 4 + 3] = n4[i] * 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  sharedNoiseTexture = t;
  return sharedNoiseTexture;
}

export function bark() {
  const W = 256, H = 512;
  const n = tileableNoise(256, 61, 5, 4, 0.55);
  const c = canvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c5044'; ctx.fillRect(0, 0, W, H);
  const r = mulberry32(62);
  for (let i = 0; i < 260; i++) {
    const x = r() * W, w = 2 + r() * 9, lum = 18 + r() * 26;
    ctx.fillStyle = hsl(22 + r() * 16, 14 + r() * 14, lum, 0.85);
    let y = 0; const wob = r() * 6;
    ctx.beginPath();
    for (const ox of [-W, 0, W]) {
      ctx.moveTo(x + ox, 0);
      for (y = 0; y <= H; y += 16) ctx.lineTo(x + ox + Math.sin(y * 0.03 + wob) * 3, y);
      for (y = H; y >= 0; y -= 16) ctx.lineTo(x + ox + w + Math.sin(y * 0.03 + wob + 1) * 3, y);
    }
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 0.7 + n[(y % 256) * 256 + x] * 0.6; const i = (y * W + x) * 4;
    d[i] = clamp255(d[i] * v); d[i + 1] = clamp255(d[i + 1] * v); d[i + 2] = clamp255(d[i + 2] * v);
  }
  ctx.putImageData(img, 0, 0);
  return srgbTex(c, true);
}

export function plank() {
  const W = 512, H = 512; const c = canvas(W, H); const ctx = c.getContext('2d'); const r = mulberry32(71);
  const n = tileableNoise(512, 72, 4, 6, 0.5);
  ctx.fillStyle = '#3b332c'; ctx.fillRect(0, 0, W, H);
  for (let p = 0; p < 6; p++) {
    const y0 = p * (H / 6);
    ctx.fillStyle = hsl(28 + r() * 10, 18 + r() * 10, 16 + r() * 8); ctx.fillRect(0, y0, W, H / 6 - 3);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = hsl(30, 15, 10 + r() * 20, 0.35); ctx.lineWidth = 1 + r() * 2;
      const yy = y0 + r() * (H / 6 - 3);
      ctx.beginPath(); ctx.moveTo(0, yy); for (let x = 0; x <= W; x += 32) ctx.lineTo(x, yy + Math.sin(x * 0.02 + i) * 2); ctx.stroke();
    }
  }
  const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < W * H; i++) { const v = 0.75 + n[i] * 0.5; d[i * 4] *= v; d[i * 4 + 1] *= v; d[i * 4 + 2] *= v; }
  ctx.putImageData(img, 0, 0);
  return srgbTex(c, true);
}

export function cageMesh() {
  const S = 64; const c = canvas(S, S); const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(40,42,40,1)'; ctx.lineWidth = 3;
  ctx.beginPath();
  // diamond (chain-link) pattern
  ctx.moveTo(0, 32); ctx.lineTo(32, 0); ctx.lineTo(64, 32); ctx.lineTo(32, 64); ctx.lineTo(0, 32);
  ctx.moveTo(-32, 32); ctx.lineTo(0, 0); ctx.moveTo(0, 64); ctx.lineTo(32, 32); ctx.lineTo(64, 64);
  ctx.moveTo(32, 0); ctx.lineTo(64, 32); ctx.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16;
  return t;
}

function normalFromHeight(h, w, hh, str) {
  const c = canvas(w, hh); const ctx = c.getContext('2d'); const img = ctx.createImageData(w, hh); const d = img.data;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const l = h[y * w + (x + w - 1) % w], rr = h[y * w + (x + 1) % w], dn = h[((y + hh - 1) % hh) * w + x], up = h[((y + 1) % hh) * w + x];
    let nx = (l - rr) * str, ny = (up - dn) * str, nz = 1; const len = Math.hypot(nx, ny, nz);
    const i = (y * w + x) * 4; d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (nz / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// Riveted, welded aluminium hull panels: brushed grain, panel seams, rivet rows, scuffs.
export function hullPanels() {
  const W = 1024, H = 512; const c = canvas(W, H); const ctx = c.getContext('2d'); const r = mulberry32(881);
  const grain = tileableNoise(512, 882, 3, 40, 0.5), blotch = tileableNoise(512, 883, 4, 3, 0.55);
  const img = ctx.createImageData(W, H); const d = img.data; const height = new Float32Array(W * H); const rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; const g = grain[(y % 512) * 512 + ((x * 3) % 512)], b = blotch[(y % 512) * 512 + (x % 512)];
    const v = 0.16 + g * 0.05 + b * 0.09;
    d[i * 4] = clamp255(v * 255 * 0.98); d[i * 4 + 1] = clamp255(v * 255); d[i * 4 + 2] = clamp255(v * 255 * 0.98); d[i * 4 + 3] = 255;
    height[i] = g * 0.15; rough[i] = 0.42 + b * 0.3 + g * 0.1;
  }
  // seams (horizontal weld line + vertical panel joins) and rivet rows
  const seams = [{ y: 256, dir: 'h' }, { x: 256, dir: 'v' }, { x: 640, dir: 'v' }];
  const stamp = (cx, cy, rad, hgt, dark) => {
    for (let y = -rad - 1; y <= rad + 1; y++) for (let x = -rad - 1; x <= rad + 1; x++) {
      const px = (cx + x + W) % W, py = (cy + y + H) % H; const dd = Math.hypot(x, y) / rad; if (dd > 1.15) continue;
      const i = py * W + px; const k = Math.max(0, 1 - dd * dd);
      height[i] += hgt * k; rough[i] = Math.max(0.3, rough[i] - 0.2 * k);
      const dk = 1 - dark * k * 0.6; d[i * 4] *= dk; d[i * 4 + 1] *= dk; d[i * 4 + 2] *= dk;
      if (dd < 0.35) { d[i * 4] = Math.min(255, d[i * 4] + 60 * (0.35 - dd)); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] + 60 * (0.35 - dd)); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] + 62 * (0.35 - dd)); }
    }
  };
  for (const sm of seams) {
    if (sm.dir === 'h') {
      for (let x = 0; x < W; x++) for (let k = -2; k <= 2; k++) { const i = ((sm.y + k + H) % H) * W + x; height[i] -= 0.35 * (1 - Math.abs(k) / 3); d[i * 4] *= 0.8; d[i * 4 + 1] *= 0.8; d[i * 4 + 2] *= 0.8; }
      for (let x = 12; x < W; x += 26) { stamp(x, sm.y - 12, 4, 0.9, 0.3); stamp(x + 3, sm.y + 12, 4, 0.9, 0.3); }
    } else {
      for (let y = 0; y < H; y++) for (let k = -2; k <= 2; k++) { const i = y * W + (sm.x + k + W) % W; height[i] -= 0.35 * (1 - Math.abs(k) / 3); d[i * 4] *= 0.8; d[i * 4 + 1] *= 0.8; d[i * 4 + 2] *= 0.8; }
      for (let y = 10; y < H; y += 26) { stamp(sm.x - 11, y, 4, 0.9, 0.3); stamp(sm.x + 11, y + 4, 4, 0.9, 0.3); }
    }
  }
  // scuffs / scratches
  for (let i = 0; i < 260; i++) {
    const x0 = r() * W, y0 = r() * H, l = 10 + r() * 60, a = (r() - 0.5) * 0.6 + (r() < 0.5 ? 0 : Math.PI / 2);
    for (let t = 0; t < l; t++) { const px = Math.floor(x0 + Math.cos(a) * t) % W, py = Math.floor(y0 + Math.sin(a) * t) % H; if (px < 0 || py < 0) continue; const j = py * W + px; d[j * 4] = Math.min(255, d[j * 4] + 22); d[j * 4 + 1] = Math.min(255, d[j * 4 + 1] + 22); d[j * 4 + 2] = Math.min(255, d[j * 4 + 2] + 22); rough[j] = Math.min(1, rough[j] + 0.25); }
  }
  ctx.putImageData(img, 0, 0);
  const map = srgbTex(c, true);
  const rc = canvas(W, H); const rctx = rc.getContext('2d'); const rimg = rctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = clamp255(rough[i] * 255); rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255; }
  rctx.putImageData(rimg, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc); roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap: normalFromHeight(height, W, H, 1.6), roughnessMap };
}

// Aluminium diamond (tread) plate for the deck.
export function diamondPlate() {
  const S = 256; const height = new Float32Array(S * S); const c = canvas(S, S); const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S); const d = img.data;
  const n = tileableNoise(256, 884, 3, 12, 0.5);
  const cell = 32;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let hgt = 0;
    // two diagonal families of raised lozenges, offset every other row
    for (const [ox, oy, rot] of [[0, 0, 1], [cell / 2, cell / 2, -1]]) {
      const lx = ((x + ox) % cell) - cell / 2, ly = ((y + oy) % cell) - cell / 2;
      const u = (lx + rot * ly) * 0.7071, v = (lx - rot * ly) * 0.7071;
      const e = Math.max(Math.abs(u) / 11, Math.abs(v) / 3.2);
      hgt = Math.max(hgt, Math.max(0, 1 - e) * (e < 0.7 ? 1 : (1 - e) / 0.3));
    }
    height[i] = hgt * 0.8 + n[i] * 0.06;
    const v = 0.34 + hgt * 0.14 + n[i] * 0.08;
    d[i * 4] = clamp255(v * 255); d[i * 4 + 1] = clamp255(v * 255 * 1.01); d[i * 4 + 2] = clamp255(v * 255 * 1.02); d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: srgbTex(c, true), normalMap: normalFromHeight(height, S, S, 2.2) };
}

// Soft, fibrous water-vapour puff used by the plume renderer (erosion is done in the shader).
export function plumeSprite() {
  const S = 256; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(556);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, dd = r() * 70; const x = 128 + Math.cos(a) * dd, y = 128 + Math.sin(a) * dd, rad = 22 + r() * 48;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.32)'); g.addColorStop(0.45, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}

export function spraySprite() {
  const S = 128; const c = canvas(S, S); const ctx = c.getContext('2d'); const r = mulberry32(555);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = r() * 28; const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 16 + r() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  // fade edges so the quad never shows
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}

export function foam() {
  const size = 256;
  const n1 = tileableNoise(size, 91, 5, 6, 0.55), n2 = tileableNoise(size, 92, 3, 14, 0.5);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.pow(Math.max(0, n1[i] * 0.7 + n2[i] * 0.5 - 0.35) * 1.8, 1.4);
    data[i * 4] = clamp255(v * 255); data[i * 4 + 1] = n2[i] * 255; data[i * 4 + 2] = n1[i] * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function waterNormal() {
  const size = 512;
  const h1 = tileableNoise(size, 101, 6, 4, 0.55), h2 = tileableNoise(size, 102, 3, 24, 0.5);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = h1[i] * 1.0 + h2[i] * 0.25;
  const data = new Uint8Array(size * size * 4);
  const str = 18;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + (x + size - 1) % size], rr = h[y * size + (x + 1) % size];
    const d = h[((y + size - 1) % size) * size + x], u = h[((y + 1) % size) * size + x];
    let nx = (l - rr) * str, ny = (d - u) * str, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
