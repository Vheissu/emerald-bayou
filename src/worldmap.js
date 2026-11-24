import { WORLD_HALF, HOME_X, HOME_Z } from './heightfield.js';
import { fmtDist } from './game.js';
import { REGIONS, regionAt } from './regions.js';
import { MAX_DRAW_PIXELS, pixelRatioFor } from './renderquality.js';
import { drawRoutePin, minimapTileColumn, minimapTileRow } from './hud.js';
import { ROUTE_COLOR } from './chartnavigation.js';
import { bridgeZAt, GULF_CUT, COVE } from './waterfrontlayout.js';

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
const DETAIL = 800, DETAIL_PX = 96, DETAIL_TILE_LIMIT = 80;

export class WorldMap {
  constructor(terrain, minimap, game, world) {
    this.T = terrain; this.mini = minimap; this.G = game; this.W = world;
    this.el = document.getElementById('bigmap'); this.canvas = document.getElementById('bigmapCanvas'); this.ctx = this.canvas.getContext('2d');
    this.legend = document.getElementById('bigmapLegend');
    this.view = document.getElementById('bigmapView');
    this.routeName = document.getElementById('bigmapRouteName');
    this.routeDetail = document.getElementById('bigmapRouteDetail');
    this.clearButton = document.getElementById('chartClear');
    this.frameButton = document.getElementById('chartFrame');
    this.pickTargets = [];
    this.tiles = new Map(); this.inFlight = 0; this.tileGeneration = 0; this.tileReleases = 0; this.releasedBackingBytes = 0;
    this.open = false; this.scale = 0.3; this.cx = 0; this.cz = 0; this.follow = true;
    this.dpr = 1;
    this.drag = null;
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      const { x, y } = this.canvasPoint(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    });
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.drag) return;
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, id: e.pointerId, panning: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', e => {
      const drag = this.drag;
      if (drag?.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.panning && Math.hypot(dx, dy) <= 5) return;
      drag.panning = true; this.follow = false;
      this.cx = drag.cx - dx / this.scale; this.cz = drag.cz - dy / this.scale;
      this.render();
    });
    this.canvas.addEventListener('pointerup', e => {
      if (this.drag?.id !== e.pointerId) return;
      const { panning } = this.drag;
      this.drag = null;
      if (!panning) {
        const { x, y } = this.canvasPoint(e);
        this.pinAt(x, y);
      }
    });
    this.canvas.addEventListener('lostpointercapture', () => { this.drag = null; });
    this.canvas.addEventListener('keydown', e => {
      const movement = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
      if (movement) {
        e.preventDefault(); e.stopPropagation();
        this.follow = false;
        this.cx += movement[0] * 56 / this.scale; this.cz += movement[1] * 56 / this.scale;
        this.render();
      } else if (e.code === 'Enter' || e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Enter') this.pinAt(this.viewWidth / 2, this.viewHeight / 2);
        else this.clearPin();
      }
    });
    this.clearButton.addEventListener('click', () => this.clearPin());
    this.frameButton.addEventListener('click', () => this.frameRoute());
    document.getElementById('chartPin').addEventListener('click', () => this.pinAt(this.viewWidth / 2, this.viewHeight / 2));
    document.getElementById('chartZoomIn').addEventListener('click', () => this.zoomAt(this.viewWidth / 2, this.viewHeight / 2, 1.6));
    document.getElementById('chartZoomOut').addEventListener('click', () => this.zoomAt(this.viewWidth / 2, this.viewHeight / 2, 1 / 1.6));
    document.getElementById('chartClose').addEventListener('click', () => this.G.closeMap());
    window.addEventListener('resize', () => { if (this.open) this.fit(); });
  }
  canvasPoint(event) {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  pinAt(px, py) {
    let nearest = null, nearestDistance = 15;
    for (const marker of this.pickTargets) {
      const d = Math.hypot(px * this.dpr - marker.px, py * this.dpr - marker.py) / this.dpr;
      if (d < nearestDistance) { nearest = marker; nearestDistance = d; }
    }
    const x = this.cx + (px - this.viewWidth / 2) / this.scale;
    const z = this.cz + (py - this.viewHeight / 2) / this.scale;
    if (nearest) this.G.navigation.setPin(nearest.x, nearest.z, nearest.label);
    else if (Math.abs(x) < WORLD_HALF - 60 && Math.abs(z) < WORLD_HALF - 60) this.G.navigation.setPin(x, z);
    this.render();
  }
  clearPin() {
    this.G.navigation.clearPin();
    if (document.activeElement === this.clearButton) this.canvas.focus({ preventScroll: true });
    this.render();
  }
  frameRoute() {
    const nav = this.G.navigation, route = nav.plan;
    if (!route || !nav.progress) return;
    let minX = this.G.phys.pos.x, maxX = minX, minZ = this.G.phys.pos.y, maxZ = minZ;
    for (let i = nav.progress.segment + 1; i < route.points.length; i++) {
      const { x, z } = route.points[i];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.follow = false;
    this.cx = (minX + maxX) / 2; this.cz = (minZ + maxZ) / 2;
    this.scale = Math.max(0.018, Math.min(1.3, (this.viewWidth - 72) / Math.max(40, maxX - minX),
      (this.viewHeight - 80) / Math.max(40, maxZ - minZ)));
    this.render();
  }
  fit() {
    const { width, height } = this.view.getBoundingClientRect();
    this.viewWidth = Math.max(1, width); this.viewHeight = Math.max(1, height);
    this.dpr = pixelRatioFor(width, height, devicePixelRatio);
    this.canvas.width = Math.max(1, Math.round(width * this.dpr)); this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.render();
  }
  zoomAt(px, py, k) {
    const ns = Math.max(0.018, Math.min(2.5, this.scale * k));
    const dx = px - this.viewWidth / 2, dz = py - this.viewHeight / 2;
    this.cx += dx / this.scale - dx / ns; this.cz += dz / this.scale - dz / ns;
    this.scale = ns; this.follow = false; this.render();
  }
  show() {
    this.open = true; this.follow = true;
    this.el.classList.remove('hidden'); this.fit();
    this.canvas.focus({ preventScroll: true });
  }
  hide() {
    this.open = false; this.el.classList.add('hidden');
    // The chart can otherwise keep an 8K RGBA canvas alive for the rest of the session after being opened once.
    this.canvas.width = 1; this.canvas.height = 1; this.dpr = 1;
  }
  releaseTiles() {
    let released = 0, count = 0;
    for (const tile of this.tiles.values()) if (tile.canvas) {
      released += tile.canvas.width * tile.canvas.height * 4; tile.canvas.width = 0; tile.canvas.height = 0; tile.canvas = null; count++;
    }
    this.tiles.clear(); this.tileGeneration++; this.tileReleases += count; this.releasedBackingBytes += released; return released;
  }
  hibernate() {
    const before = this.canvas.width * this.canvas.height * 4, released = this.releaseTiles();
    if (this.open) { this.canvas.width = 1; this.canvas.height = 1; this.dpr = 1; }
    return released + Math.max(0, before - this.canvas.width * this.canvas.height * 4);
  }
  resume() { if (!this.open) return false; this.fit(); return true; }
  memoryStats() {
    const width = this.canvas.width, height = this.canvas.height, pixels = width * height;
    let cachedTiles = 0, tilePixels = 0;
    for (const tile of this.tiles.values()) if (tile.canvas) { cachedTiles++; tilePixels += tile.canvas.width * tile.canvas.height; }
    return {
      open: this.open, width, height, pixels, pixelRatio: this.dpr, maxPixels: MAX_DRAW_PIXELS,
      cachedTiles, pendingTiles: this.tiles.size - cachedTiles, tilePixels, tileReleases: this.tileReleases, releasedBackingBytes: this.releasedBackingBytes,
      canvasBackingBytes: pixels * 4, tileBackingBytes: tilePixels * 4, estimatedBackingBytes: (pixels + tilePixels) * 4,
    };
  }
  tile(i, j, size = COARSE) {
    const detail = size === DETAIL, resolution = detail ? DETAIL_PX : COARSE_PX;
    const key = detail ? `detail:${i},${j}` : `${i},${j}`;
    let t = this.tiles.get(key); if (t) return t.canvas;
    if (this.inFlight >= 4) return null;
    if (detail && this.tiles.size >= DETAIL_TILE_LIMIT) {
      for (const [oldKey, old] of this.tiles) {
        if (!oldKey.startsWith('detail:') || !old.canvas) continue;
        old.canvas.width = 0; old.canvas.height = 0; this.tiles.delete(oldKey); break;
      }
    }
    const generation = this.tileGeneration;
    t = { canvas: null, generation }; this.tiles.set(key, t); this.inFlight++;
    this.T.tile(i * size, j * size, size, resolution, detail ? 'mini' : 'chart').then(rgba => {
      this.inFlight--; if (generation !== this.tileGeneration || this.tiles.get(key) !== t) return;
      const c = document.createElement('canvas'); c.width = resolution; c.height = resolution;
      c.getContext('2d').putImageData(new ImageData(rgba, resolution, resolution), 0, 0); t.canvas = c;
      if (this.open) this.render();
    }, () => { this.inFlight--; if (generation === this.tileGeneration && this.tiles.get(key) === t) this.tiles.delete(key); });
    return null;
  }
  render() {
    if (!this.open) return;
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    const p = this.G.phys, pursuitSearch = this.G.encounters?.pursuitSearchArea?.() || null, navigation = this.G.navigation;
    if (this.follow) { this.cx = p.pos.x; this.cz = p.pos.y; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1e292d'; c.fillRect(0, 0, W, H);
    const k = this.scale * dpr;
    c.save(); c.translate(W / 2, H / 2); c.scale(k, k); c.translate(-this.cx, -this.cz);
    c.imageSmoothingEnabled = true;
    const R = Math.hypot(W / 2, H / 2) / k;
    const coarse = this.scale < 0.23;
    const size = coarse ? COARSE : DETAIL, n = WORLD_HALF / size;
    const xr = W / 2 / k, zr = H / 2 / k;
    const xMin = Math.max(-n, Math.floor((this.cx - xr) / size)), xMax = Math.min(n - 1, Math.floor((this.cx + xr) / size));
    const zMin = Math.max(-n, Math.floor((this.cz - zr) / size)), zMax = Math.min(n - 1, Math.floor((this.cz + zr) / size));
    for (let j = zMin; j <= zMax; j++) for (let i = xMin; i <= xMax; i++) {
      const x0 = i * size, z0 = j * size, img = this.tile(i, j, size);
      if (img) c.drawImage(img, x0, z0, size, size);
      else { c.fillStyle = '#34434a'; c.fillRect(x0, z0, size, size); }
    }
    // fine tiles where the minimap has them, once zoomed in enough to matter
    if (this.scale > 0.12) for (const [key, t] of this.mini.tiles) { if (!t.canvas) continue; const i = minimapTileColumn(key), j = minimapTileRow(key), x0 = i * 200, z0 = j * 200; if (x0 + 200 < this.cx - R || x0 > this.cx + R || z0 + 200 < this.cz - R || z0 > this.cz + R) continue; c.drawImage(t.canvas, x0, z0, 200, 200); }
    // world rim
    c.lineWidth = 2 / k; c.strokeStyle = 'rgba(243,237,224,0.35)'; c.strokeRect(-WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
    // mile grid
    c.lineWidth = 1 / k; c.strokeStyle = 'rgba(243,237,224,0.07)';
    const step = this.scale > 0.3 ? MILE / 4 : this.scale > 0.08 ? MILE / 2 : MILE;
    for (let x = Math.ceil((this.cx - R) / step) * step; x < this.cx + R; x += step) { c.beginPath(); c.moveTo(x, this.cz - R); c.lineTo(x, this.cz + R); c.stroke(); }
    for (let z = Math.ceil((this.cz - R) / step) * step; z < this.cz + R; z += step) { c.beginPath(); c.moveTo(this.cx - R, z); c.lineTo(this.cx + R, z); c.stroke(); }
    if (this.scale > 0.12 && Math.hypot(GULF_CUT.x - this.cx, GULF_CUT.z - this.cz) < R + 150) {
      c.save(); c.beginPath(); c.moveTo(GULF_CUT.west, bridgeZAt(GULF_CUT.west));
      for (let x = GULF_CUT.west + 10; x < GULF_CUT.east; x += 10) c.lineTo(x, bridgeZAt(x));
      c.lineTo(GULF_CUT.east, bridgeZAt(GULF_CUT.east));
      c.lineWidth = Math.max(2 / this.scale, GULF_CUT.width * 0.6); c.strokeStyle = '#b2b0a4'; c.stroke(); c.restore();
    }
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
    if (pursuitSearch) {
      c.save(); c.beginPath(); c.arc(pursuitSearch.x, pursuitSearch.z, pursuitSearch.r, 0, Math.PI * 2); c.fillStyle = 'rgba(75,145,235,0.07)'; c.fill();
      c.setLineDash([9 / k, 6 / k]); c.lineWidth = 1.8 / k; c.strokeStyle = 'rgba(105,175,255,0.72)'; c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(pursuitSearch.x - 4 / k, pursuitSearch.z); c.lineTo(pursuitSearch.x + 4 / k, pursuitSearch.z); c.moveTo(pursuitSearch.x, pursuitSearch.z - 4 / k); c.lineTo(pursuitSearch.x, pursuitSearch.z + 4 / k); c.strokeStyle = 'rgba(185,220,255,0.82)'; c.stroke(); c.restore();
    }
    navigation?.plot(c, k, dpr);
    c.restore();
    // markers in screen space
    const toS = (x, z) => [W / 2 + (x - this.cx) * k, H / 2 + (z - this.cz) * k];
    this.pickTargets.length = 0;
    const pick = (px, py, x, z, label) => this.pickTargets.push({ px, py, x, z, label });
    const font = (px, w = 500) => `${w} ${px * dpr}px "Avenir Next Condensed", "Avenir Next", sans-serif`;
    const label = (x, y, text, col = '#f3ede0', px = 13, dy = 0) => { c.font = font(px, 600); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(8,20,15,0.8)'; c.fillText(text, x + 9 * dpr + 1, y + dy + 1); c.fillStyle = col; c.fillText(text, x + 9 * dpr, y + dy); };
    if (pursuitSearch) { const [x, y] = toS(pursuitSearch.x, pursuitSearch.z); if (x > -80 && y > -40 && x < W + 40 && y < H + 40) label(x, y, 'FWC LAST-FIX AREA', '#69afff', 10, -14 * dpr); }
    if (this.scale > 0.12) for (const landmark of [GULF_CUT, COVE]) {
      const [x, y] = toS(landmark.x, landmark.z);
      if (x < -90 || y < -35 || x > W + 35 || y > H + 35) continue;
      pick(x, y, landmark.x, landmark.z, landmark.name);
      // A thin cross locates the channel opening and the cove without competing with mission markers.
      c.beginPath(); c.moveTo(x - 4 * dpr, y); c.lineTo(x + 4 * dpr, y);
      c.moveTo(x, y - 4 * dpr); c.lineTo(x, y + 4 * dpr); c.lineWidth = 1.5 * dpr; c.strokeStyle = '#e9e3d4'; c.stroke();
      if (this.scale > 0.42) label(x, y, landmark.name, '#e9e3d4', 11, landmark === GULF_CUT ? -10 * dpr : 0);
    }
    // home
    {
      const [x, y] = toS(HOME_X + 65, HOME_Z - 115), berth = this.G.dockTie;
      pick(x, y, berth.x, berth.z, 'Tower dock');
      c.fillStyle = '#e5c063'; c.beginPath(); c.moveTo(x, y - 7 * dpr); c.lineTo(x + 5 * dpr, y + 5 * dpr); c.lineTo(x - 5 * dpr, y + 5 * dpr); c.closePath(); c.fill();
      label(x, y, 'Tower dock', '#e5c063');
    }
    // camps: known ones named, seen ones as marks
    const seen = this.G.save.seen || [], known = this.G.save.camps || [];
    for (const key of seen) {
      const [ci, cj] = key.split(',').map(Number); const cp = this.W.campAt(ci, cj); if (!cp) continue;
      const [x, y] = toS(cp.x, cp.z); const isKnown = known.includes(key);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      pick(x, y, cp.tie.x, cp.tie.z, isKnown ? cp.name : 'Uncharted camp');
      c.fillStyle = isKnown ? '#f3ede0' : 'rgba(243,237,224,0.55)'; c.strokeStyle = 'rgba(8,20,15,0.8)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.rect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); c.fill(); c.stroke();
      if (isKnown && (this.scale > 0.05 || known.length < 12)) label(x, y, cp.name, '#f3ede0', 12);
      else if (!isKnown && this.scale > 0.1) label(x, y, 'camp?', 'rgba(243,237,224,0.6)', 11);
    }
    // Job posts near home, plus structures with a known water approach.
    if (!this.G.state) for (const j of this.G.jobs) {
      const [x, y] = toS(j.x, j.z);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      const lock = !this.G.unlocked(j.i);
      if (lock && this.scale < 0.62) continue;
      if (this.pickTargets.some(mark => Math.hypot(x - mark.px, y - mark.py) < 14 * dpr)) continue;
      pick(x, y, j.x, j.z, j.m.title);
      c.beginPath(); c.arc(x, y, 7 * dpr, 0, 6.283); c.fillStyle = lock ? 'rgba(140,146,140,0.8)' : j.color; c.fill();
      c.lineWidth = 2 * dpr; c.strokeStyle = 'rgba(8,20,15,0.85)'; c.stroke();
      c.font = font(10, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b1512';
      c.fillText(j.glyph === 'flag' ? 'F' : j.glyph === 'star' ? '*' : j.glyph, x, y + dpr);
      if (this.scale > 0.72) label(x, y, j.m.title, lock ? 'rgba(243,237,224,0.5)' : '#f3ede0', 11);
    }
    for (const { site } of this.W.liveSites.values()) {
      const [x, y] = toS(site.x, site.z);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      const name = site.kind === 'ramp' ? 'Boat ramp' : site.kind === 'house' ? 'Homestead' : 'Boathouse';
      if (site.kind !== 'blind') pick(x, y, site.tie?.x ?? site.x, site.tie?.z ?? site.z, name);
      c.fillStyle = site.kind === 'ramp' ? 'rgba(205,205,195,0.9)' : 'rgba(230,224,208,0.7)';
      c.fillRect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr);
      if (this.scale > 0.55 && site.kind !== 'blind') label(x, y, name, 'rgba(243,237,224,0.7)', 10);
    }
    // mission target
    const objective = this.G.wpTarget;
    if (objective && !objective.story && navigation?.target !== objective) {
      const [x, y] = toS(objective.x, objective.z);
      pick(x, y, objective.x, objective.z, objective.label || 'Objective');
      c.fillStyle = '#eac082'; c.beginPath(); c.arc(x, y, 5 * dpr, 0, 6.283); c.fill();
    }
    // A dispatch call keeps moving while the chart is open. It is an incident, not a fixed mission objective.
    const liveCall = this.G.incidents && this.G.incidents.marker();
    if (liveCall) {
      const [x, y] = toS(liveCall.x, liveCall.z);
      pick(x, y, liveCall.x, liveCall.z, liveCall.label);
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
      pick(x, y, recovery.x, recovery.z, recovery.label);
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = recovery.color; c.strokeStyle = 'rgba(8,20,15,0.9)'; c.lineWidth = 2 * dpr;
      c.fillRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.strokeRect(-6 * dpr, -6 * dpr, 12 * dpr, 12 * dpr); c.restore();
      c.font = font(10, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#0b1512'; c.fillText('!', x, y + dpr);
      if (this.scale > 0.045 || recoveryMarks.length < 3) label(x, y, recovery.label.toUpperCase(), recovery.color, 11, 24 * dpr);
    }
    // Reported aids remain on the working chart until the maintenance crew puts the light back on station.
    const navigationMarks = this.G.navigationAids?.markers?.() || [];
    for (const navigationMark of navigationMarks) {
      const [x, y] = toS(navigationMark.x, navigationMark.z); if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      pick(x, y, navigationMark.x, navigationMark.z, navigationMark.label);
      c.save(); c.translate(x, y); c.strokeStyle = navigationMark.color; c.fillStyle = 'rgba(8,20,15,0.88)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.arc(0, 0, 6 * dpr, 0, Math.PI * 2); c.fill(); c.stroke(); c.beginPath(); c.moveTo(0, -7 * dpr); c.lineTo(0, 7 * dpr); c.stroke(); c.restore();
      if (this.scale > 0.07 || navigationMarks.length < 3) label(x, y, navigationMark.label.toUpperCase(), navigationMark.color, 11);
    }
    // Named-character work lives on the same paper chart, but gets a gold question mark rather than an arcade gate.
    const storyMarks = this.G.story ? (this.G.story.markers ? this.G.story.markers() : [this.G.story.marker()].filter(Boolean)) : [];
    for (const storyMark of storyMarks) {
      const [x, y] = toS(storyMark.x, storyMark.z); c.save();
      pick(x, y, storyMark.x, storyMark.z, storyMark.label);
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
    const destination = navigation?.pin || navigation?.target;
    if (destination) {
      const [x, y] = toS(destination.x, destination.z);
      pick(x, y, destination.x, destination.z, destination.label || 'Objective');
      drawRoutePin(c, x, y, dpr * 1.2);
    }
    // boat
    { const [x, y] = toS(p.pos.x, p.pos.y); c.save(); c.translate(x, y); c.rotate(-p.heading); c.fillStyle = '#f3ede0'; c.strokeStyle = 'rgba(8,20,15,0.85)'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(0, -11 * dpr); c.lineTo(7 * dpr, 8 * dpr); c.lineTo(0, 4 * dpr); c.lineTo(-7 * dpr, 8 * dpr); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    if (!this.follow) {
      c.beginPath();
      c.moveTo(W / 2 - 7 * dpr, H / 2); c.lineTo(W / 2 + 7 * dpr, H / 2);
      c.moveTo(W / 2, H / 2 - 7 * dpr); c.lineTo(W / 2, H / 2 + 7 * dpr);
      c.lineWidth = 2.5 * dpr; c.strokeStyle = '#1e2d35'; c.stroke();
      c.lineWidth = dpr; c.strokeStyle = '#f3ede0'; c.stroke();
    }
    // scale bar
    { const len = step; const px = len * k; const x0 = 40 * dpr, y0 = H - 46 * dpr; c.strokeStyle = '#f3ede0'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + px, y0); c.moveTo(x0, y0 - 6 * dpr); c.lineTo(x0, y0 + 6 * dpr); c.moveTo(x0 + px, y0 - 6 * dpr); c.lineTo(x0 + px, y0 + 6 * dpr); c.stroke(); c.font = font(13, 600); c.fillStyle = '#f3ede0'; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(len >= MILE ? `${Math.round(len / MILE)} mi` : `${len / MILE} mi`, x0, y0 - 8 * dpr); }
    this.legend.textContent = regionAt(this.cx, this.cz).name;
    this.routeName.textContent = destination ? destination.label || 'Objective' : 'Choose a waypoint';
    const remaining = navigation?.progress && navigation.status === 'ready' ? fmtDist(navigation.progress.remaining) : '';
    this.routeDetail.textContent = [remaining, navigation?.guidance(fmtDist)].filter(Boolean).join(' · ');
    this.clearButton.disabled = !navigation?.pin;
    this.frameButton.disabled = !navigation?.progress;
  }
}
