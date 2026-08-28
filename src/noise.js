export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export class Simplex2 {
  constructor(seed = 1) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512); this.perm8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.perm8[i] = this.perm[i] & 7; }
  }
  noise(x, y) {
    const perm = this.perm, perm8 = this.perm8;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const g = grad[perm8[ii + perm[jj]]]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const g = grad[perm8[ii + i1 + perm[jj + j1]]]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const g = grad[perm8[ii + 1 + perm[jj + 1]]]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  }
  fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * this.noise(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
}

// Tileable lattice value noise in [0,1]
export function tileableNoise(size, seed, octaves = 5, baseFreq = 4, gain = 0.5) {
  const out = new Float32Array(size * size);
  const rand = mulberry32(seed);
  let amp = 1, total = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = freq;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lat[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * n; const iy = Math.floor(fy); let ty = fy - iy; ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const y0 = (iy % n) * n, y1 = ((iy + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n; const ix = Math.floor(fx); let tx = fx - ix; tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const x0 = ix % n, x1 = (ix + 1) % n;
        const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
        out[y * size + x] += amp * ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty);
      }
    }
    total += amp; amp *= gain; freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
