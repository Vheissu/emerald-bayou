// The radar: 200 m tiles rendered by the terrain workers on demand and cached, rotated so forward is up, zooming out
// with speed, with everything alive and worth knowing about drawn over it as blips: the objective pinned to the rim
// when it is off the radar, job posts with their glyphs, camps and homesteads, ramps, other boats (pointed the way
// they are going), anglers, the bull, traps within reach, home.
export const MINIMAP_TILE_SIZE = 200, MINIMAP_TILE_PX = 100; // 0.5 px per metre
const MINIMAP_MIN_SCALE = 0.35, DEFAULT_TILE_LIMIT = 256;
const FONT = '"Avenir Next Condensed", "Avenir Next", "Arial Narrow", sans-serif';
const INK = 'rgba(8,20,15,0.85)';
export const minimapTileKey = (i, j) => ((i & 0xffff) << 16) | (j & 0xffff);
export const minimapTileColumn = key => Number(key) >> 16;
export const minimapTileRow = key => (Number(key) << 16) >> 16;
export const minimapTileBackingBytes = (limit = DEFAULT_TILE_LIMIT) => Math.max(0, Math.floor(Number(limit) || 0)) * MINIMAP_TILE_PX * MINIMAP_TILE_PX * 4;
export function minimapVisibleTileCeiling(width = 480, height = 304, scale = MINIMAP_MIN_SCALE) {
  const radius = Math.hypot(Math.max(1, Number(width) || 1) / 2, Math.max(1, Number(height) || 1) * 0.62) / Math.max(0.05, Number(scale) || MINIMAP_MIN_SCALE) + MINIMAP_TILE_SIZE;
  const span = Math.floor(radius * 2 / MINIMAP_TILE_SIZE) + 2;
  return span * span;
}
export function minimapTileLimit(profile = {}) {
  const value = typeof profile === 'number' ? profile : profile.minimapTileLimit;
  return Math.max(1, Math.round(Number(value) || DEFAULT_TILE_LIMIT));
}
const MARKER_ORDER = { trap: 0, blind: 0, boathouse: 1, house: 1, ramp: 1, camp: 2, angler: 3, gator: 3, boat: 4, home: 5, dot: 5, job: 6, hazard: 7, objective: 8 };
export const markerDrawPriority = kind => MARKER_ORDER[kind] || 0;

const drawRim = (c, x, y, r, fill, stroke = INK, lw = 2) => { c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fillStyle = fill; c.fill(); if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); } };
const drawGlyph = (c, x, y, glyph, px, color = '#0b1512') => { c.font = `700 ${px}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(glyph, x, y + px * 0.06); };
const drawHouse = (c, x, y, r, fill, stroke = INK) => { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y - r * 0.15); c.lineTo(x + r * 0.7, y - r * 0.15); c.lineTo(x + r * 0.7, y + r * 0.9); c.lineTo(x - r * 0.7, y + r * 0.9); c.lineTo(x - r * 0.7, y - r * 0.15); c.lineTo(x - r, y - r * 0.15); c.closePath(); c.fillStyle = fill; c.fill(); c.lineWidth = 1.5; c.strokeStyle = stroke; c.stroke(); };
const drawTriangle = (c, x, y, angle, r, fill, stroke = INK) => { c.save(); c.translate(x, y); c.rotate(angle); c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.7, r * 0.8); c.lineTo(0, r * 0.35); c.lineTo(-r * 0.7, r * 0.8); c.closePath(); c.fillStyle = fill; c.fill(); c.lineWidth = 1.5; c.strokeStyle = stroke; c.stroke(); c.restore(); };
const drawFlag = (c, x, y, r) => { c.fillStyle = '#f3ede0'; c.fillRect(x - r * 0.55, y - r * 0.6, r * 1.1, r * 0.8); c.fillStyle = '#0b1512'; const s = r * 0.275; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) & 1) c.fillRect(x - r * 0.55 + i * s, y - r * 0.6 + j * s, s, s); c.fillRect(x - r * 0.62, y - r * 0.7, r * 0.12, r * 1.5); };
const drawStar = (c, x, y, r, color) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fillStyle = color; c.fill(); };
const drawLock = (c, x, y, r) => { c.fillStyle = '#0b1512'; c.fillRect(x - r * 0.45, y - r * 0.1, r * 0.9, r * 0.7); c.beginPath(); c.arc(x, y - r * 0.1, r * 0.3, Math.PI, 0); c.lineWidth = r * 0.16; c.strokeStyle = '#0b1512'; c.stroke(); };

export class Minimap {
  constructor(terrain, profile = {}) {
    this.T = terrain;
    this.canvas = document.getElementById('minimapCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.tiles = new Map(); this.inFlight = 0;
    this.completedTiles = 0; this.peakCompletedTiles = 0; this.tileGeneration = 0;
    this.tileEvictions = 0; this.tileReleases = 0; this.releasedBackingBytes = 0;
    this.speedEl = document.getElementById('speedVal');
    this.scale = 0.62; // canvas px per metre (drifts down with speed)
    this.pulse = 0;
    this.edgeGradient = null; this.edgeGradientWidth = 0; this.edgeGradientHeight = 0;
    this.cacheLimit = DEFAULT_TILE_LIMIT; this.trimTarget = minimapVisibleTileCeiling(this.canvas.width, this.canvas.height);
    this.setQuality(profile);
  }
  releaseTile(tile) {
    const canvas = tile?.canvas; if (!canvas) return 0;
    const bytes = canvas.width * canvas.height * 4; canvas.width = 0; canvas.height = 0; tile.canvas = null;
    this.completedTiles = Math.max(0, this.completedTiles - 1); this.releasedBackingBytes += bytes; return bytes;
  }
  trimTiles(target = this.cacheLimit) {
    const keep = Math.max(0, Math.floor(Number(target) || 0));
    if (this.completedTiles <= keep) return 0;
    const list = [...this.tiles.entries()].filter(([, tile]) => tile.canvas).sort((a, b) => a[1].used - b[1].used);
    const remove = Math.min(this.completedTiles - keep, list.length); let released = 0;
    for (let index = 0; index < remove; index++) {
      const [key, tile] = list[index]; released += this.releaseTile(tile); this.tiles.delete(key); this.tileEvictions++;
    }
    return released;
  }
  setQuality(profile = {}) {
    const visible = minimapVisibleTileCeiling(this.canvas.width, this.canvas.height);
    this.cacheLimit = Math.max(visible, minimapTileLimit(profile)); this.trimTarget = Math.max(visible, Math.floor(this.cacheLimit * 0.75));
    return { limit: this.cacheLimit, trimTarget: this.trimTarget, releasedBackingBytes: this.trimTiles(this.cacheLimit) };
  }
  releaseTiles() {
    let released = 0, count = 0;
    for (const tile of this.tiles.values()) if (tile.canvas) { released += this.releaseTile(tile); count++; }
    this.tiles.clear(); this.tileGeneration++; this.tileReleases += count; return released;
  }
  tile(i, j) {
    const key = minimapTileKey(i, j);
    let t = this.tiles.get(key);
    if (t) { t.used = performance.now(); return t.canvas; }
    if (this.inFlight >= 3) return null;
    const generation = this.tileGeneration;
    t = { canvas: null, used: performance.now(), generation }; this.tiles.set(key, t); this.inFlight++;
    this.T.tile(i * MINIMAP_TILE_SIZE, j * MINIMAP_TILE_SIZE, MINIMAP_TILE_SIZE, MINIMAP_TILE_PX).then(rgba => {
      this.inFlight--;
      if (generation !== this.tileGeneration || this.tiles.get(key) !== t) return;
      const c = document.createElement('canvas'); c.width = MINIMAP_TILE_PX; c.height = MINIMAP_TILE_PX;
      c.getContext('2d').putImageData(new ImageData(rgba, MINIMAP_TILE_PX, MINIMAP_TILE_PX), 0, 0);
      t.canvas = c; this.completedTiles++; this.peakCompletedTiles = Math.max(this.peakCompletedTiles, this.completedTiles);
      if (this.completedTiles > this.cacheLimit) this.trimTiles(this.trimTarget);
    }, () => { this.inFlight--; if (generation === this.tileGeneration && this.tiles.get(key) === t) this.tiles.delete(key); });
    return null;
  }
  memoryStats() {
    let completed = 0, pixels = 0;
    for (const tile of this.tiles.values()) if (tile.canvas) { completed++; pixels += tile.canvas.width * tile.canvas.height; }
    return {
      tiles: this.tiles.size, completed, pending: this.tiles.size - completed, inFlight: this.inFlight,
      limit: this.cacheLimit, trimTarget: this.trimTarget, peakCompleted: this.peakCompletedTiles,
      evictions: this.tileEvictions, releases: this.tileReleases, releasedBackingBytes: this.releasedBackingBytes,
      pixels, estimatedBackingBytes: pixels * 4, estimatedLimitBytes: minimapTileBackingBytes(this.cacheLimit),
    };
  }
  update(boat, camYaw, markers = []) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const CX = W / 2, CY = H * 0.62;
    this.pulse += 1 / 60;
    const want = 0.62 - Math.min(1, boat.speed / 14) * 0.27;
    this.scale += (want - this.scale) * 0.03;
    const k = this.scale, rot = boat.heading; // rotate so forward is up
    c.clearRect(0, 0, W, H);
    c.save();
    c.fillStyle = 'rgba(30,60,50,0.55)'; c.fillRect(0, 0, W, H);
    c.translate(CX, CY); c.rotate(rot); c.scale(k, k); c.translate(-boat.pos.x, -boat.pos.y);
    c.globalAlpha = 0.9;
    const R = Math.hypot(CX, CY) / k + MINIMAP_TILE_SIZE;
    const i0 = Math.floor((boat.pos.x - R) / MINIMAP_TILE_SIZE), i1 = Math.floor((boat.pos.x + R) / MINIMAP_TILE_SIZE), j0 = Math.floor((boat.pos.y - R) / MINIMAP_TILE_SIZE), j1 = Math.floor((boat.pos.y + R) / MINIMAP_TILE_SIZE);
    c.imageSmoothingEnabled = true;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const img = this.tile(i, j); if (img) c.drawImage(img, i * MINIMAP_TILE_SIZE, j * MINIMAP_TILE_SIZE, MINIMAP_TILE_SIZE, MINIMAP_TILE_SIZE); }
    c.restore();
    // world -> radar
    const cr = Math.cos(rot), sr = Math.sin(rot);
    // keep a point inside the radar's rim
    const inset = 22;
    // Nine allocation-free passes preserve stable draw order: quiet things first, the objective last.
    for (let priority = 0; priority <= 8; priority++) for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
      const mk = markers[markerIndex]; if (markerDrawPriority(mk.kind) !== priority) continue;
      const mx = (mk.x - boat.pos.x) * k, mz = (mk.z - boat.pos.y) * k;
      let sx = CX + cr * mx - sr * mz, sy = CY + sr * mx + cr * mz, pinned = false;
      if (mk.clamp) {
        const dx = sx - CX, dy = sy - CY;
        const kx = Math.abs(dx) > 1e-3 ? (CX - inset) / Math.abs(dx) : 1e9;
        const ky = Math.abs(dy) > 1e-3 ? (CY - inset) / Math.abs(dy) : 1e9;
        const kk = Math.min(1, kx, Math.abs(dy) > 1e-3 ? (H - CY - inset) / Math.abs(dy) : 1e9, ky);
        sx = CX + dx * kk; sy = CY + dy * kk; pinned = kk < 1;
      }
      else if (sx < -12 || sy < -12 || sx > W + 12 || sy > H + 12) continue;
      switch (mk.kind) {
        case 'objective': {
          const col = mk.color || '#f07a2e';
          if (!pinned) { const pr = 9 + (this.pulse * 1.2 % 1) * 10; c.beginPath(); c.arc(sx, sy, pr, 0, 6.283); c.lineWidth = 2; c.strokeStyle = col; c.globalAlpha = 1 - (this.pulse * 1.2 % 1); c.stroke(); c.globalAlpha = 1; }
          drawRim(c, sx, sy, mk.soft ? 6 : 7, col, INK, 2.5);
          if (pinned) { const ang = Math.atan2(sy - CY, sx - CX); c.save(); c.translate(sx, sy); c.rotate(ang); c.beginPath(); c.moveTo(14, 0); c.lineTo(6, -6); c.lineTo(6, 6); c.closePath(); c.fillStyle = col; c.fill(); c.restore(); }
          break;
        }
        case 'job': {
          const r = 11; drawRim(c, sx, sy, r, mk.locked ? 'rgba(140,146,140,0.85)' : mk.color, mk.done ? '#e5c063' : INK, mk.done ? 3 : 2);
          if (mk.locked) drawLock(c, sx, sy, r * 0.8); else if (mk.glyph === 'flag') drawFlag(c, sx, sy, r * 0.85); else if (mk.glyph === 'star') drawStar(c, sx, sy, r * 0.62, '#0b1512'); else drawGlyph(c, sx, sy, mk.glyph, 15);
          break;
        }
        case 'camp': drawHouse(c, sx, sy, 7, mk.known ? '#7be08a' : 'rgba(230,224,208,0.55)'); if (mk.known) drawGlyph(c, sx, sy + 2, '$', 9); break;
        case 'house': drawHouse(c, sx, sy, 5, 'rgba(230,224,208,0.85)'); break;
        case 'boathouse': drawHouse(c, sx, sy, 5, 'rgba(160,190,210,0.85)'); break;
        case 'ramp': { c.save(); c.translate(sx, sy); c.beginPath(); c.moveTo(-6, 4); c.lineTo(6, 4); c.lineTo(6, -5); c.closePath(); c.fillStyle = 'rgba(205,205,195,0.9)'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke(); c.restore(); break; }
        case 'blind': drawRim(c, sx, sy, 2.5, 'rgba(180,170,110,0.8)', null); break;
        case 'boat': { const fx = -Math.sin(mk.heading), fz = -Math.cos(mk.heading), dx = cr * fx - sr * fz, dy = sr * fx + cr * fz; drawTriangle(c, sx, sy, Math.atan2(dy, dx) + Math.PI / 2, 7, mk.color || '#8fb8d8'); break; }
        case 'angler': drawRim(c, sx, sy, 3.5, 'rgba(140,190,240,0.95)'); break;
        case 'gator': drawRim(c, sx, sy, 4.5, '#4a5e2e', '#e0554a', 2); break;
        case 'trap': drawRim(c, sx, sy, 2.6, '#f07a2e', INK, 1.2); break;
        case 'hazard': {
          const col = mk.color || '#d7f1f4', pr = 8 + (this.pulse * 1.4 % 1) * 9;
          c.beginPath(); c.arc(sx, sy, pr, 0, 6.283); c.lineWidth = 1.5; c.strokeStyle = col; c.globalAlpha = 1 - (this.pulse * 1.4 % 1); c.stroke(); c.globalAlpha = 1;
          drawRim(c, sx, sy, 7, col, INK, 2); drawGlyph(c, sx, sy + 0.5, '!', 11); break;
        }
        case 'home': drawTriangle(c, sx, sy, 0, 7, '#e5c063'); break;
        default: drawRim(c, sx, sy, mk.r || 4, mk.color || '#f3ede0', 'rgba(0,0,0,0.5)', 1.5);
      }
    }
    // north marker
    c.save(); c.translate(CX, CY);
    const r = Math.min(W, H) * 0.44;
    const ang = rot - Math.PI / 2; // north is -z; forward is up when heading 0
    const nX = Math.cos(ang) * r, nY = Math.sin(ang) * r;
    drawRim(c, nX, nY, 12, 'rgba(20,30,26,0.75)', null); drawGlyph(c, nX, nY, 'N', 18, '#e8f0ea');
    // player arrow
    c.fillStyle = '#f4f7f4'; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 9); c.lineTo(0, 4); c.lineTo(-9, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // edge fade
    c.globalCompositeOperation = 'destination-in';
    if (!this.edgeGradient || this.edgeGradientWidth !== W || this.edgeGradientHeight !== H) {
      this.edgeGradient = c.createRadialGradient(CX, CY, 20, CX, CY, W * 0.62);
      this.edgeGradient.addColorStop(0, 'rgba(0,0,0,1)'); this.edgeGradient.addColorStop(0.85, 'rgba(0,0,0,1)'); this.edgeGradient.addColorStop(1, 'rgba(0,0,0,0.6)');
      this.edgeGradientWidth = W; this.edgeGradientHeight = H;
    }
    c.fillStyle = this.edgeGradient; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(190,220,205,0.35)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3);
    this.speedEl.textContent = Math.round(boat.speed * 2.23694);
  }
}
