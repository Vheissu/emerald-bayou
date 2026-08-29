// The world's height function. Pure maths, no three.js, so the same module runs in the terrain workers and on the
// main thread (physics, wildlife, mission placement) and every consumer sees exactly the same ground.
//
// Layout: the hand-tuned "home" bayou (river, lagoon, tower island, side creek, sandbars) sits at the origin exactly as
// it always did. Beyond ~600 m it blends into an endless procedural wetland: domain-warped ridged noise carves a network
// of rivers and creeks, low-frequency noise opens lakes, wide sawgrass prairie flats with hammocks (tree islands) sit
// between them, and the main river keeps running north-south through all of it.
import { Simplex2, mulberry32 } from './noise.js';
import { trimOldest } from './cache.js';

export const WORLD_HALF = 12800; // playable half-extent in metres: 25.6 km square (~655 km2)
export const HOME_X = 20, HOME_Z = -120; // centre of the hand-tuned area
const BAR_CELL = 400; // procedural sandbars are generated per 400 m cell
const BAR_CACHE_LIMIT = 1536;

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

export class WorldHeight {
  constructor(seed = 7) {
    this.seed = seed;
    this.sx = new Simplex2(seed);
    this.sx2 = new Simplex2(seed + 100);
    this.sx3 = new Simplex2(seed + 200);
    this.lagoon = { x: 55, y: -220 };
    this.island = { x: 85, y: -235 };
    this.barCells = new Map();
    this.barCacheEvictions = 0;
    this.buildHomeBars(seed);
  }
  smooth(e0, e1, x) { return smooth(e0, e1, x); }
  riverCenterX(z) { return 40 * Math.sin(z * 0.0045) + 25 * Math.sin(z * 0.011 + 1.3) + 12 * Math.sin(z * 0.027 + 0.4); }
  riverHalfWidth(z) { return 34 + 12 * Math.sin(z * 0.013 + 2.0) + 6 * Math.sin(z * 0.031); }

  // ---- sandbars, mud flats and kickers ----
  makeBar(rb, x, z, dx, dz, kind) {
    let bar;
    if (kind === 'kicker') bar = { x, z, dx, dz, up: 6 + rb() * 1.2, crest: 1.2 + rb() * 0.8, drop: 4.8 + rb() * 1.2, w: 3.8 + rb() * 2.2, h: 1.6 + rb() * 0.4, plateau: -0.55, kind };
    else if (kind === 'bar') bar = { x, z, dx, dz, up: 10 + rb() * 6, crest: 3 + rb() * 4, drop: 4 + rb() * 3, w: 4.5 + rb() * 3, h: 0.55 + rb() * 0.45, plateau: -0.5, kind };
    else bar = { x, z, dx, dz, up: 14 + rb() * 10, crest: 8 + rb() * 10, drop: 8 + rb() * 6, w: 7 + rb() * 6, h: 0.15 + rb() * 0.25, plateau: -0.4, kind }; // mud flat
    bar.len = bar.up + bar.crest + bar.drop; bar.r = Math.max(bar.len, bar.w * 2.4) + 4;
    return bar;
  }
  buildHomeBars(seed) {
    const rb = mulberry32(seed * 13 + 5);
    this.bars = [];
    const add = (z, kind, side = 0) => {
      const t = (this.riverCenterX(z + 1) - this.riverCenterX(z - 1)) / 2;
      const l = Math.hypot(t, 1); let dx = t / l, dz = 1 / l;
      const hw = this.riverHalfWidth(z);
      const x = this.riverCenterX(z) + (side === 0 ? (rb() - 0.5) * 0.7 : side * 0.45) * hw;
      // ramps face "upstream" or "downstream" at random so both directions get jumps
      if (rb() < 0.5) { dx = -dx; dz = -dz; }
      this.bars.push(this.makeBar(rb, x, z, dx, dz, kind));
    };
    const zs = [-30, -95, -150, -290, -330, -380, -450, -520, -590, -660, 140, 210, 280, 360, 440, 520];
    const kinds = ['bar', 'kicker', 'flat', 'kicker', 'bar', 'kicker', 'flat', 'kicker', 'bar', 'kicker', 'kicker', 'flat', 'bar', 'kicker', 'kicker', 'bar'];
    zs.forEach((z, i) => add(z, kinds[i], i % 3 === 0 ? 0 : (i % 3 === 1 ? 1 : -1)));
    // stunt park in the lagoon: a cluster of kickers
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.4, rr = 45 + i * 9;
      const x = this.lagoon.x + Math.cos(a) * rr - 30, z = this.lagoon.y + Math.sin(a) * rr + 30;
      const dx = Math.cos(a + 1.2), dz = Math.sin(a + 1.2);
      const bar = { x, z, dx, dz, up: 6.2 + rb() * 1.2, crest: 1.6, drop: 5.2, w: 4.5 + rb() * 1.5, h: 1.8 + rb() * 0.4, plateau: -0.55, kind: 'kicker' };
      bar.len = bar.up + bar.crest + bar.drop; bar.r = Math.max(bar.len, bar.w * 2.4) + 4;
      this.bars.push(bar);
    }
  }
  // Procedural bars out in the wild: a few per 400 m cell, dropped into channels and aligned with the flow.
  cellBars(ci, cj) {
    const key = ci * 65536 + cj;
    let list = this.barCells.get(key);
    if (list) return list;
    list = [];
    const cx = ci * BAR_CELL, cz = cj * BAR_CELL;
    if (Math.hypot(cx + BAR_CELL / 2 - HOME_X, cz + BAR_CELL / 2 - HOME_Z) > 900 && Math.max(Math.abs(cx), Math.abs(cz)) < WORLD_HALF) {
      const rb = mulberry32(hash2(ci + 7919, cj + 104729) ^ this.seed);
      for (let k = 0; k < 7 && list.length < 3; k++) {
        const x = cx + rb() * BAR_CELL, z = cz + rb() * BAR_CELL;
        const c = this.computeBase(x, z, true);
        if (c.s < 0.97 || c.lake > 0.2) continue; // channels only
        // channel direction: of four axes through the point, the one whose ends are both deepest
        let best = null, bestH = 1e9;
        for (let a = 0; a < 4; a++) {
          const ang = a * Math.PI / 4, dx = Math.cos(ang), dz = Math.sin(ang);
          const h1 = this.computeBase(x + dx * 22, z + dz * 22).h, h2 = this.computeBase(x - dx * 22, z - dz * 22).h;
          const m = Math.max(h1, h2); if (m < bestH) { bestH = m; best = [dx, dz]; }
        }
        if (bestH > -1.5) continue; // not a clear channel
        let [dx, dz] = best; if (rb() < 0.5) { dx = -dx; dz = -dz; }
        const r = rb(); const kind = r < 0.42 ? 'kicker' : r < 0.75 ? 'bar' : 'flat';
        list.push(this.makeBar(rb, x, z, dx, dz, kind));
      }
    }
    this.barCells.set(key, list);
    this.barCacheEvictions += trimOldest(this.barCells, BAR_CACHE_LIMIT);
    return list;
  }
  barsNear(x, z, out) {
    out.length = 0;
    if (Math.hypot(x - HOME_X, z - HOME_Z) < 1000) for (const b of this.bars) out.push(b);
    const ci = Math.floor(x / BAR_CELL), cj = Math.floor(z / BAR_CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = this.cellBars(ci + i, cj + j); for (const b of l) out.push(b); }
    return out;
  }
  barProfile(b, x, z) {
    const px = x - b.x, pz = z - b.z;
    if (px * px + pz * pz > b.r * b.r) return -99;
    const u = px * b.dx + pz * b.dz, v = -px * b.dz + pz * b.dx;
    const av = Math.abs(v);
    // along-axis profile: gentle up-ramp, short crest, steep drop-off
    const u0 = -b.up - b.crest * 0.5, u1 = -b.crest * 0.5, u2 = b.crest * 0.5, u3 = b.crest * 0.5 + b.drop;
    let ridge;
    if (u < u0) ridge = 0;
    else if (u < u1) { const tt = (u - u0) / (u1 - u0); const sm = tt * tt * (3 - 2 * tt); ridge = b.kind === 'kicker' ? sm * 0.3 + tt * 0.7 : sm; } // kickers: a near-straight ramp so the hull leaves the lip with the full ramp velocity
    else if (u < u2) ridge = 1;
    else if (u < u3) { const tt = (u3 - u) / (u3 - u2); const sm = tt * tt * (3 - 2 * tt); ridge = b.kind === 'kicker' ? sm * 0.3 + tt * 0.7 : sm; }
    else ridge = 0;
    ridge *= 1 - smooth(b.w * 0.45, b.w, av);
    // wide wet plateau just under the surface so the hull slides on before it climbs
    const foot = (1 - smooth(b.w * 1.3, b.w * 2.4, av)) * smooth(u0 - 10, u0 - 1.5, u) * (1 - smooth(u3 - 1, u3 + 7, u));
    const target = b.plateau * foot + (b.h - b.plateau) * ridge;
    return foot > 0.001 ? -4.5 + (target + 4.5) * foot : -99;
  }
  barHeight(x, z) {
    let out = -99;
    const list = this.barsNear(x, z, this._barList || (this._barList = []));
    for (const b of list) { const hh = this.barProfile(b, x, z); if (hh > out) out = hh; }
    return out;
  }

  // ---- the ground itself (without sandbars) ----
  // returns { h, s (water mask), lake, prairie, hammock }
  computeBase(x, z, wantInfo = false) {
    const sx = this.sx, sx2 = this.sx2, sx3 = this.sx3;
    const dHome = Math.hypot(x - HOME_X, z - HOME_Z);
    const wildF = smooth(560, 780, dHome); // 0 in the hand-tuned bayou, 1 out in the wild
    let base = 1.7 + 2.4 * sx.fbm(x * 0.004, z * 0.004, 4) + 0.7 * sx.fbm(x * 0.02 + 3, z * 0.02, 3) + 0.15 * sx.noise(x * 0.12, z * 0.12);
    // marsh pools among the trees
    const pool = sx2.fbm(x * 0.006 + 9, z * 0.006 + 3, 3);
    base -= 3.2 * smooth(0.28, 0.5, pool);
    // main river channel (runs the whole length of the world)
    const hw = this.riverHalfWidth(z) + 6 * sx.noise(x * 0.03, z * 0.03);
    const d = Math.abs(x - this.riverCenterX(z));
    let s = smooth(hw + 26, hw - 10, d);
    let lake = 0, prairie = 0, hammock = 0;
    if (dHome < 900) {
      // lagoon widening
      const dl = Math.hypot(x - this.lagoon.x, z - this.lagoon.y) + 12 * sx.noise(x * 0.02 + 5, z * 0.02);
      s = Math.max(s, smooth(150, 105, dl));
      // side creek
      const cx = this.riverCenterX(z) - 150 - 30 * Math.sin(z * 0.02);
      const dc = Math.abs(x - cx);
      if (z > -600 && z < 100) s = Math.max(s, smooth(22, 6, dc) * smooth(-600, -500, z) * smooth(100, 20, z));
    }
    if (wildF > 0) {
      // domain warp so the channels meander instead of following the noise lattice
      const wx = x + 140 * sx3.fbm(x * 0.0016, z * 0.0016, 2), wz = z + 140 * sx3.fbm(x * 0.0016 + 31, z * 0.0016 + 17, 2);
      // sawgrass prairie: wide, flat, wet grass with lenses of open water, and hammocks of higher ground in it
      prairie = smooth(0.05, 0.35, sx3.fbm(x * 0.0007 + 5, z * 0.0007 + 9, 3)) * wildF;
      const prairieH = 0.35 + 0.45 * sx.fbm(x * 0.012 + 7, z * 0.012, 2);
      hammock = smooth(0.40, 0.60, sx2.fbm(wx * 0.005 + 21, wz * 0.005 + 4, 2));
      base = base * (1 - prairie) + (prairieH + 2.4 * hammock) * prairie;
      // rivers and creeks: channels along the zero lines of warped noise
      const r1 = Math.abs(sx3.noise(wx * 0.0011 + 3, wz * 0.0011 + 8));
      const s1 = smooth(0.095, 0.035, r1);
      const r2 = Math.abs(sx2.noise(wx * 0.0034 + 11, wz * 0.0034 + 2));
      const s2 = smooth(0.07, 0.028, r2);
      // lakes
      const lk = sx3.fbm(x * 0.0013 + 41, z * 0.0013 + 13, 3);
      lake = smooth(0.30, 0.42, lk) * wildF;
      s = Math.max(s, s1 * wildF, s2 * wildF * 0.96, lake);
    }
    const bottom = -4.2 - 1.6 * sx.fbm(x * 0.03 + 11, z * 0.03, 3) - 2.2 * lake;
    let h = base * (1 - s) + bottom * s;
    if (dHome < 900) {
      // island for the tower
      const di = Math.hypot(x - this.island.x, z - this.island.y) + 4 * sx.noise(x * 0.05, z * 0.05 + 2);
      const fi = smooth(40, 22, di);
      if (fi > 0) h = h * (1 - fi) + (2.1 + 0.3 * sx.noise(x * 0.1, z * 0.1)) * fi;
    }
    // the edge of the world: the ground rises into pine flats the boat cannot climb
    const edge = smooth(WORLD_HALF - 500, WORLD_HALF - 80, Math.max(Math.abs(x), Math.abs(z)));
    if (edge > 0) h = h * (1 - edge) + (7 + 2 * sx.noise(x * 0.01, z * 0.01)) * edge;
    if (!wantInfo) return { h, s, lake, prairie, hammock };
    return { h, s, lake, prairie, hammock };
  }
  compute(x, z) {
    let h = this.computeBase(x, z).h;
    const bh = this.barHeight(x, z);
    if (bh > h) h = bh + 0.08 * this.sx.noise(x * 0.4, z * 0.4);
    return h;
  }
  // openness for the vegetation: 1 = open sawgrass (few trees), 0 = swamp forest
  openness(x, z) { const c = this.computeBase(x, z); return c.prairie * (1 - c.hammock); }

  // A chunk grid with a one-sample border (for seam-free normals): heights, normals and openness.
  grid(x0, z0, size, n) {
    const m = n + 3, step = size / n;
    const hs = new Float32Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) hs[j * m + i] = this.compute(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const cnt = (n + 1) * (n + 1);
    const h = new Float32Array(cnt), nrm = new Float32Array(cnt * 3), bio = new Float32Array(cnt);
    let minH = 1e9, maxH = -1e9;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i, c = (j + 1) * m + (i + 1);
      const hh = hs[c]; h[k] = hh; if (hh < minH) minH = hh; if (hh > maxH) maxH = hh;
      const dx = (hs[c + 1] - hs[c - 1]) / (2 * step), dz = (hs[c + m] - hs[c - m]) / (2 * step);
      const l = 1 / Math.hypot(dx, 1, dz);
      nrm[k * 3] = -dx * l; nrm[k * 3 + 1] = l; nrm[k * 3 + 2] = -dz * l;
    }
    // openness at a coarser 4x4 lattice (it only varies over hundreds of metres)
    const ob = 4, om = ob + 1; const o = new Float32Array(om * om);
    for (let j = 0; j <= ob; j++) for (let i = 0; i <= ob; i++) o[j * om + i] = this.openness(x0 + i * size / ob, z0 + j * size / ob);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const fx = i / n * ob, fz = j / n * ob; const ii = Math.min(ob - 1, Math.floor(fx)), jj = Math.min(ob - 1, Math.floor(fz)); const tx = fx - ii, tz = fz - jj;
      const a = o[jj * om + ii], b = o[jj * om + ii + 1], c = o[(jj + 1) * om + ii], dd = o[(jj + 1) * om + ii + 1];
      bio[j * (n + 1) + i] = (a + (b - a) * tx) * (1 - tz) + (c + (dd - c) * tx) * tz;
    }
    return { h, nrm, bio, minH, maxH };
  }
  // map tile: RGBA at px x px covering size metres. 'mini' colours every puddle (the minimap, 2 m/px);
  // 'chart' is for the coarse whole-world chart: only channels and lakes read as water, the marsh pools as a wash,
  // so the river network stands out at 30 m per pixel.
  tile(x0, z0, size, px, style = 'mini') {
    const out = new Uint8ClampedArray(px * px * 4);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = x0 + (i + 0.5) * size / px, z = z0 + (j + 0.5) * size / px;
      const k = (j * px + i) * 4;
      if (style === 'murk') {
        // water character for the surface shader: R = still backwater (off the channels: tannin-dark), G = shaded still
        // water (duckweed), B = open lake (wind-ruffled). Land pixels do not matter.
        const c = this.computeBase(x, z);
        const still = 1 - smooth(0.25, 0.85, c.s);
        const open = c.prairie * (1 - c.hammock);
        const dH = Math.hypot(x - HOME_X, z - HOME_Z);
        const shade = Math.max(0, 1 - open) * (dH > 700 ? 1 : 0.7);
        out[k] = 255 * Math.min(1, still * (1 - c.lake * 0.6)); out[k + 1] = 255 * Math.min(1, still * shade * (c.h < -0.15 ? 1 : 0.3)); out[k + 2] = 255 * c.lake;
      } else if (style === 'chart') {
        const c = this.computeBase(x, z); const h = c.h;
        if (c.s > 0.55 || h < -2.6) { const t = Math.min(1, -h / 5); out[k] = 96 - t * 20; out[k + 1] = 186 - t * 30; out[k + 2] = 162 - t * 25; }
        else if (h < -0.3) { out[k] = 84; out[k + 1] = 142; out[k + 2] = 118; } // marsh pools
        else if (c.prairie > 0.5 && h < 1.2) { out[k] = 116; out[k + 1] = 138; out[k + 2] = 84; } // sawgrass
        else { const t = Math.min(1, (h - 0.3) / 5); out[k] = 60 + t * 18; out[k + 1] = 98 + t * 18; out[k + 2] = 66 + t * 10; }
      } else {
        const h = this.compute(x, z);
        if (h < -0.1) { const t = Math.min(1, -h / 4); out[k] = 112 - t * 30; out[k + 1] = 196 - t * 30; out[k + 2] = 170 - t * 25; }
        else if (h < 0.6) { out[k] = 92; out[k + 1] = 138; out[k + 2] = 108; }
        else { const t = Math.min(1, (h - 0.6) / 5); out[k] = 58 + t * 20; out[k + 1] = 96 + t * 20; out[k + 2] = 70 + t * 10; }
      }
      out[k + 3] = 255;
    }
    return out;
  }
}
