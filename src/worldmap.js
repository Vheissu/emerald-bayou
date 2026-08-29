import { WORLD_HALF, HOME_X, HOME_Z } from './heightfield.js';
import { fmtDist } from './game.js';
import { REGIONS, regionAt } from './regions.js';
import { MAX_DRAW_PIXELS, pixelRatioFor } from './renderquality.js';

const MILE = 1609.344;
const REGION_LABEL_OFFSET = {
  blackwater: [-12, -27], sawgrass: [0, 26], mangrove: [0, 26],
  cypress: [0, -25], emerald: [-24, -29], broad: [0, -25],
  rookery: [0, -25], prairie: [0, -25], 'dead-river': [0, -25],
};

// The full-screen chart (Tab): the whole 16-mile world from coarse tiles the workers render on demand, with the fine
// minimap tiles laid over it where they are cached. Camps appear as unnamed marks once you have been within 2 km of
// them and get their name when you tie up. Scroll to zoom, drag to pan, Tab / Esc to close.
const COARSE = 3200, COARSE_PX = 96; // 33 m per pixel

export class WorldMap {
  constructor(terrain, minimap, game, world) {
    this.T = terrain; this.mini = minimap; this.G = game; this.W = world;
    this.el = document.getElementById('bigmap'); this.canvas = document.getElementById('bigmapCanvas'); this.ctx = this.canvas.getContext('2d');
    this.legend = document.getElementById('bigmapLegend');
    this.tiles = new Map(); this.inFlight = 0;
    this.open = false; this.scale = 0.04; this.cx = 0; this.cz = 0; this.follow = true;
    this.dpr = 1;
    this.drag = null;
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); this.zoomAt(e.clientX, e.clientY, k); });
    this.canvas.addEventListener('mousedown', e => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; });
    window.addEventListener('mousemove', e => { if (!this.drag || !this.open) return; this.follow = false; this.cx = this.drag.cx - (e.clientX - this.drag.x) / this.scale; this.cz = this.drag.cz - (e.clientY - this.drag.y) / this.scale; this.render(); });
    window.addEventListener('mouseup', () => { this.drag = null; });
    window.addEventListener('resize', () => { if (this.open) this.fit(); });
  }
  fit() {
    this.dpr = pixelRatioFor(innerWidth, innerHeight, devicePixelRatio);
    this.canvas.width = Math.max(1, Math.floor(innerWidth * this.dpr)); this.canvas.height = Math.max(1, Math.floor(innerHeight * this.dpr));
    this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px'; this.render();
  }
  zoomAt(px, py, k) {
    const ns = Math.max(0.018, Math.min(2.5, this.scale * k));
    const wx = this.cx + (px - innerWidth / 2) / this.scale, wz = this.cz + (py - innerHeight / 2) / this.scale;
    this.scale = ns; this.cx = wx - (px - innerWidth / 2) / ns; this.cz = wz - (py - innerHeight / 2) / ns; this.follow = false; this.render();
  }
  show() { this.open = true; this.follow = true; const p = this.G.phys.pos; this.cx = p.x; this.cz = p.y; this.el.classList.remove('hidden'); this.fit(); }
  hide() {
    this.open = false; this.el.classList.add('hidden');
    // The chart can otherwise keep an 8K RGBA canvas alive for the rest of the session after being opened once.
    this.canvas.width = 1; this.canvas.height = 1; this.dpr = 1;
  }
  memoryStats() {
    const width = this.canvas.width, height = this.canvas.height, pixels = width * height;
    let cachedTiles = 0, tilePixels = 0;
    for (const tile of this.tiles.values()) if (tile.canvas) { cachedTiles++; tilePixels += tile.canvas.width * tile.canvas.height; }
    return {
      open: this.open, width, height, pixels, pixelRatio: this.dpr, maxPixels: MAX_DRAW_PIXELS,
      cachedTiles, pendingTiles: this.tiles.size - cachedTiles, tilePixels,
      canvasBackingBytes: pixels * 4, tileBackingBytes: tilePixels * 4, estimatedBackingBytes: (pixels + tilePixels) * 4,
    };
  }
  tile(i, j) {
    const key = `${i},${j}`;
    let t = this.tiles.get(key); if (t) return t.canvas;
    if (this.inFlight >= 4) return null;
    t = { canvas: null }; this.tiles.set(key, t); this.inFlight++;
    this.T.tile(i * COARSE, j * COARSE, COARSE, COARSE_PX, 'chart').then(rgba => {
      this.inFlight--; const c = document.createElement('canvas'); c.width = COARSE_PX; c.height = COARSE_PX;
      c.getContext('2d').putImageData(new ImageData(rgba, COARSE_PX, COARSE_PX), 0, 0); t.canvas = c; if (this.open) this.render();
    }).catch(() => { this.inFlight--; this.tiles.delete(key); }); // a failed tile must give its slot back or the chart stops filling in
    return null;
  }
  render() {
    if (!this.open) return;
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    const p = this.G.phys;
    if (this.follow) { this.cx = p.pos.x; this.cz = p.pos.y; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0b1512'; c.fillRect(0, 0, W, H);
    const k = this.scale * dpr;
    c.save(); c.translate(W / 2, H / 2); c.scale(k, k); c.translate(-this.cx, -this.cz);
    c.imageSmoothingEnabled = true;
    const R = Math.hypot(W / 2, H / 2) / k;
    const n = Math.ceil(WORLD_HALF / COARSE);
    for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
      const x0 = i * COARSE, z0 = j * COARSE;
      if (x0 + COARSE < this.cx - R || x0 > this.cx + R || z0 + COARSE < this.cz - R || z0 > this.cz + R) continue;
      const img = this.tile(i, j); if (img) c.drawImage(img, x0, z0, COARSE, COARSE);
      else { c.fillStyle = '#14251d'; c.fillRect(x0, z0, COARSE, COARSE); }
    }
    // fine tiles where the minimap has them, once zoomed in enough to matter
    if (this.scale > 0.12) for (const [key, t] of this.mini.tiles) { if (!t.canvas) continue; const [i, j] = key.split(',').map(Number); const x0 = i * 200, z0 = j * 200; if (x0 + 200 < this.cx - R || x0 > this.cx + R || z0 + 200 < this.cz - R || z0 > this.cz + R) continue; c.drawImage(t.canvas, x0, z0, 200, 200); }
    // world rim
    c.lineWidth = 2 / k; c.strokeStyle = 'rgba(243,237,224,0.35)'; c.strokeRect(-WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
    // mile grid
    c.lineWidth = 1 / k; c.strokeStyle = 'rgba(243,237,224,0.07)';
    const step = this.scale > 0.3 ? MILE / 4 : this.scale > 0.08 ? MILE / 2 : MILE;
    for (let x = Math.ceil((this.cx - R) / step) * step; x < this.cx + R; x += step) { c.beginPath(); c.moveTo(x, this.cz - R); c.lineTo(x, this.cz + R); c.stroke(); }
    for (let z = Math.ceil((this.cz - R) / step) * step; z < this.cz + R; z += step) { c.beginPath(); c.moveTo(this.cx - R, z); c.lineTo(this.cx + R, z); c.stroke(); }
    // Regional names sit in the chart itself, like place names on a paper navigation sheet. Their screen size stays
    // steady while zooming; markers and exact camp names remain above them.
    if (this.scale < 0.55) {
      c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `600 ${17 / this.scale}px "Avenir Next Condensed", "Avenir Next", sans-serif`;
      c.lineWidth = 4 / this.scale; c.strokeStyle = 'rgba(8,20,15,0.7)'; c.fillStyle = 'rgba(243,237,224,0.38)';
      for (const region of REGIONS) {
        const [dx, dz] = REGION_LABEL_OFFSET[region.id] || [0, -24];
        const x = region.x + dx / this.scale, z = region.z + dz / this.scale;
        c.strokeText(region.name.toUpperCase(), x, z); c.fillText(region.name.toUpperCase(), x, z);
      }
      c.restore();
    }
    c.restore();
    // markers in screen space
    const toS = (x, z) => [W / 2 + (x - this.cx) * k, H / 2 + (z - this.cz) * k];
    const font = (px, w = 500) => `${w} ${px * dpr}px "Avenir Next Condensed", "Avenir Next", sans-serif`;
    const label = (x, y, text, col = '#f3ede0', px = 13, dy = 0) => { c.font = font(px, 600); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(8,20,15,0.8)'; c.fillText(text, x + 9 * dpr + 1, y + dy + 1); c.fillStyle = col; c.fillText(text, x + 9 * dpr, y + dy); };
    // home
    { const [x, y] = toS(HOME_X + 65, HOME_Z - 115); c.fillStyle = '#e5c063'; c.beginPath(); c.moveTo(x, y - 7 * dpr); c.lineTo(x + 5 * dpr, y + 5 * dpr); c.lineTo(x - 5 * dpr, y + 5 * dpr); c.closePath(); c.fill(); label(x, y, 'Tower · home', '#e5c063'); }
    // camps: known ones named, seen ones as marks
    const seen = this.G.save.seen || [], known = this.G.save.camps || [];
    for (const key of seen) {
      const [ci, cj] = key.split(',').map(Number); const cp = this.W.campAt(ci, cj); if (!cp) continue;
      const [x, y] = toS(cp.x, cp.z); const isKnown = known.includes(key);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      c.fillStyle = isKnown ? '#f3ede0' : 'rgba(243,237,224,0.55)'; c.strokeStyle = 'rgba(8,20,15,0.8)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.rect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); c.fill(); c.stroke();
      if (isKnown && (this.scale > 0.05 || known.length < 12)) label(x, y, cp.name, '#f3ede0', 12);
      else if (!isKnown && this.scale > 0.1) label(x, y, 'camp?', 'rgba(243,237,224,0.6)', 11);
    }
    // job posts near home, homesteads and ramps that are built right now
    if (!this.G.state) for (const j of this.G.jobs) { const [x, y] = toS(j.x, j.z); if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue; const lock = !this.G.unlocked(j.i); c.beginPath(); c.arc(x, y, 7 * dpr, 0, 6.283); c.fillStyle = lock ? 'rgba(140,146,140,0.8)' : j.color; c.fill(); c.lineWidth = 2 * dpr; c.strokeStyle = 'rgba(8,20,15,0.85)'; c.stroke(); c.font = font(10, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b1512'; c.fillText(j.glyph === 'flag' ? 'F' : j.glyph === 'star' ? '*' : j.glyph, x, y + dpr); if (this.scale > 0.25) label(x, y, j.m.title, lock ? 'rgba(243,237,224,0.5)' : '#f3ede0', 11); }
    for (const l of this.W.liveSites.values()) { const [x, y] = toS(l.site.x, l.site.z); if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue; c.fillStyle = l.site.kind === 'ramp' ? 'rgba(205,205,195,0.9)' : 'rgba(230,224,208,0.7)'; c.fillRect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr); if (this.scale > 0.3) label(x, y, l.site.kind === 'ramp' ? 'boat ramp' : l.site.kind === 'house' ? 'homestead' : l.site.kind, 'rgba(243,237,224,0.7)', 10); }
    // mission target
    if (this.G.wpTarget && !this.G.wpTarget.story) { const [x, y] = toS(this.G.wpTarget.x, this.G.wpTarget.z); c.fillStyle = '#f07a2e'; c.beginPath(); c.arc(x, y, 6 * dpr, 0, 6.283); c.fill(); label(x, y, this.G.wpTarget.label || 'objective', '#f07a2e'); }
    // A dispatch call keeps moving while the chart is open. It is an incident, not a fixed mission objective.
    const liveCall = this.G.incidents && this.G.incidents.marker();
    if (liveCall) {
      const [x, y] = toS(liveCall.x, liveCall.z);
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = liveCall.color; c.strokeStyle = 'rgba(8,20,15,0.9)'; c.lineWidth = 2 * dpr;
      c.fillRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.strokeRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.restore();
      // A compact dispatch tag keeps a moving call legible over camp and region labels without moving its exact fix.
      c.save(); c.font = font(11, 700); c.textAlign = 'left'; c.textBaseline = 'middle';
      const text = liveCall.label.toUpperCase(), tw = c.measureText(text).width, sy = y > H - 64 * dpr ? -1 : 1;
      const right = x + tw + 34 * dpr < W, tx = right ? x + 17 * dpr : x - tw - 17 * dpr, ty = y + sy * 24 * dpr;
      c.strokeStyle = 'rgba(8,20,15,0.8)'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(x + (right ? 5 : -5) * dpr, y + sy * 5 * dpr); c.lineTo(tx + (right ? -4 * dpr : tw + 4 * dpr), ty); c.stroke();
      c.fillStyle = 'rgba(8,20,15,0.86)'; c.fillRect(tx - 5 * dpr, ty - 10 * dpr, tw + 10 * dpr, 20 * dpr);
      c.fillStyle = liveCall.color; c.fillRect(tx - 5 * dpr, ty - 10 * dpr, 2 * dpr, 20 * dpr); c.fillText(text, tx, ty); c.restore();
    }
    // Storm damage outlives the weather front. Recovery calls stay on the paper chart until a crew has physically
    // cleared the obstruction or taken the casualty off the water.
    const recoveryMarks = this.G.aftermath ? this.G.aftermath.markers() : [];
    for (const recovery of recoveryMarks) {
      const [x, y] = toS(recovery.x, recovery.z); if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = recovery.color; c.strokeStyle = 'rgba(8,20,15,0.9)'; c.lineWidth = 2 * dpr;
      c.fillRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.strokeRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.restore();
      c.font = font(10, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b1512'; c.fillText('!', x, y + dpr);
      if (this.scale > 0.045 || recoveryMarks.length < 3) label(x, y, recovery.label.toUpperCase(), recovery.color, 11, 24 * dpr);
    }
    // Reported aids remain on the working chart until the maintenance crew puts the light back on station.
    const navigationMarks = this.G.navigationAids?.markers?.() || [];
    for (const navigationMark of navigationMarks) {
      const [x, y] = toS(navigationMark.x, navigationMark.z); if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      c.save(); c.translate(x, y); c.strokeStyle = navigationMark.color; c.fillStyle = 'rgba(8,20,15,0.88)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.arc(0, 0, 6 * dpr, 0, Math.PI * 2); c.fill(); c.stroke(); c.beginPath(); c.moveTo(0, -7 * dpr); c.lineTo(0, 7 * dpr); c.stroke(); c.restore();
      if (this.scale > 0.07 || navigationMarks.length < 3) label(x, y, navigationMark.label.toUpperCase(), navigationMark.color, 11);
    }
    // Named-character work lives on the same paper chart, but gets a gold question mark rather than an arcade gate.
    const storyMarks = this.G.story ? (this.G.story.markers ? this.G.story.markers() : [this.G.story.marker()].filter(Boolean)) : [];
    for (const storyMark of storyMarks) {
      const [x, y] = toS(storyMark.x, storyMark.z); c.save();
      c.beginPath(); c.arc(x, y, 7 * dpr, 0, Math.PI * 2); c.fillStyle = storyMark.color; c.fill(); c.lineWidth = 2 * dpr; c.strokeStyle = 'rgba(8,20,15,0.9)'; c.stroke();
      c.font = font(storyMark.story ? 11 : 13, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b1512'; c.fillText(storyMark.story ? '?' : '•', x, y + dpr);
      const text = storyMark.label.toUpperCase(); c.font = font(11, 700); const tw = c.measureText(text).width, sy = y > H - 64 * dpr ? -1 : 1;
      const right = x + tw + 36 * dpr < W, tx = right ? x + 18 * dpr : x - tw - 18 * dpr, ty = y + sy * 25 * dpr;
      c.strokeStyle = 'rgba(8,20,15,0.8)'; c.beginPath(); c.moveTo(x + (right ? 6 : -6) * dpr, y + sy * 6 * dpr); c.lineTo(tx + (right ? -4 * dpr : tw + 4 * dpr), ty); c.stroke();
      c.fillStyle = 'rgba(8,20,15,0.88)'; c.fillRect(tx - 5 * dpr, ty - 10 * dpr, tw + 10 * dpr, 20 * dpr); c.fillStyle = storyMark.color; c.fillRect(tx - 5 * dpr, ty - 10 * dpr, 2 * dpr, 20 * dpr); c.fillText(text, tx + tw / 2, ty); c.restore();
    }
    // Field observations are chart knowledge rather than jobs. Logged sites remain as small compass stars; a live,
    // visually identified sign carries an outer ring until the observation is resolved.
    const fieldMarks = this.G.discoveries?.markers?.() || [];
    for (const fieldMark of fieldMarks) {
      const [x, y] = toS(fieldMark.x, fieldMark.z); if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      c.save(); c.translate(x, y); c.fillStyle = fieldMark.color; c.strokeStyle = 'rgba(8,20,15,0.9)'; c.lineWidth = 2 * dpr;
      c.beginPath();
      for (let point = 0; point < 8; point++) { const angle = -Math.PI / 2 + point * Math.PI / 4, radius = (point % 2 ? 3.2 : 7) * dpr; const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius; if (!point) c.moveTo(px, py); else c.lineTo(px, py); }
      c.closePath(); c.fill(); c.stroke();
      if (fieldMark.live) { c.beginPath(); c.arc(0, 0, 11 * dpr, 0, Math.PI * 2); c.strokeStyle = fieldMark.color; c.stroke(); }
      c.restore();
      if (fieldMark.live || this.scale > 0.08) label(x, y, fieldMark.label, fieldMark.color, 11);
    }
    // boat
    { const [x, y] = toS(p.pos.x, p.pos.y); c.save(); c.translate(x, y); c.rotate(-p.heading); c.fillStyle = '#f3ede0'; c.strokeStyle = 'rgba(8,20,15,0.85)'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(0, -11 * dpr); c.lineTo(7 * dpr, 8 * dpr); c.lineTo(0, 4 * dpr); c.lineTo(-7 * dpr, 8 * dpr); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    // scale bar
    { const len = step; const px = len * k; const x0 = 40 * dpr, y0 = H - 46 * dpr; c.strokeStyle = '#f3ede0'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + px, y0); c.moveTo(x0, y0 - 6 * dpr); c.lineTo(x0, y0 + 6 * dpr); c.moveTo(x0 + px, y0 - 6 * dpr); c.lineTo(x0 + px, y0 + 6 * dpr); c.stroke(); c.font = font(13, 600); c.fillStyle = '#f3ede0'; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(len >= MILE ? `${Math.round(len / MILE)} mi` : `${len / MILE} mi`, x0, y0 - 8 * dpr); }
    // legend
    const nc = this.W.nearestCamp(p.pos.x, p.pos.y);
    const region = regionAt(p.pos.x, p.pos.y);
    const storyLegend = storyMarks.map(m => `<div>${m.contract ? (m.story ? 'Resident work' : 'Resident note') : m.story ? 'Story' : 'Chart note'} · ${m.label}</div>`).join('');
    const recoveryLegend = recoveryMarks.map(m => `<div>Storm recovery · ${m.label}</div>`).join('');
    const navigationLegend = navigationMarks.map(m => `<div>Aid report · ${m.label}</div>`).join('');
    const fieldFound = fieldMarks.filter(mark => mark.found).length, liveField = fieldMarks.find(mark => mark.live);
    this.legend.innerHTML = `<div class="h">Chart</div><div>${region.name} &nbsp;·&nbsp; ${(WORLD_HALF * 2 / MILE).toFixed(0)} miles square</div><div>${known.length} camps found &nbsp;·&nbsp; ${(this.G.save.regions || []).length} / ${REGIONS.length} regions seen &nbsp;·&nbsp; ${(this.G.save.traps || []).length} traps recovered &nbsp;·&nbsp; ${fieldFound} field notes</div>${nc ? `<div>Nearest camp ${nc.camp.name ? (known.includes(nc.camp.key) ? nc.camp.name : 'unknown') : ''} · ${fmtDist(nc.d)}</div>` : ''}${liveCall ? `<div>Live dispatch · ${liveCall.label}</div>` : ''}${liveField ? `<div>Live field sign · ${liveField.label}</div>` : ''}${navigationLegend}${recoveryLegend}${storyLegend}<div class="keys">scroll zoom · drag pan · Tab close</div>`;
  }
}
