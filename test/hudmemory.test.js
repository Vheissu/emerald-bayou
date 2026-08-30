import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Minimap,
  minimapTileBackingBytes,
  minimapTileColumn,
  minimapTileKey,
  minimapTileRow,
  minimapVisibleTileCeiling,
} from '../src/hud.js';
import { qualityProfile } from '../src/renderquality.js';
import { WorldMap } from '../src/worldmap.js';

const tileCanvas = (width = 100, height = 100) => ({ width, height });

test('low-memory radar history stays above the complete visible footprint', () => {
  const visible = minimapVisibleTileCeiling(480, 304, 0.35), oldBytes = minimapTileBackingBytes(256);
  assert.equal(visible, 144);
  assert.ok(qualityProfile(0).minimapTileLimit > visible);
  assert.equal(minimapTileBackingBytes(qualityProfile(0).minimapTileLimit), 6_400_000);
  assert.ok(minimapTileBackingBytes(qualityProfile(0).minimapTileLimit) < oldBytes * 0.63);
});

test('packed radar keys round-trip signed world tile coordinates for chart overlays', () => {
  for (const [i, j] of [[0, 0], [-64, 63], [127, -128], [-1, -1]]) {
    const key = minimapTileKey(i, j);
    assert.deepEqual([minimapTileColumn(key), minimapTileRow(key)], [i, j]);
  }
});

test('a quality drop releases the oldest radar canvas backing stores immediately', () => {
  const minimap = Object.create(Minimap.prototype), canvases = [];
  Object.assign(minimap, {
    canvas: { width: 480, height: 304 }, tiles: new Map(), completedTiles: 256, peakCompletedTiles: 256,
    tileGeneration: 0, tileEvictions: 0, tileReleases: 0, releasedBackingBytes: 0, cacheLimit: 256, trimTarget: 192,
  });
  for (let index = 0; index < 256; index++) { const canvas = tileCanvas(); canvases.push(canvas); minimap.tiles.set(index, { canvas, used: index }); }

  const result = minimap.setQuality(qualityProfile(0));
  assert.deepEqual({ limit: result.limit, trimTarget: result.trimTarget }, { limit: 160, trimTarget: 144 });
  assert.equal(result.releasedBackingBytes, 3_840_000);
  assert.equal(minimap.completedTiles, 160); assert.equal(minimap.tiles.size, 160); assert.equal(minimap.tileEvictions, 96);
  assert.ok(canvases.slice(0, 96).every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.ok(canvases.slice(96).every(canvas => canvas.width === 100 && canvas.height === 100));

  assert.equal(minimap.releaseTiles(), 6_400_000);
  assert.equal(minimap.completedTiles, 0); assert.equal(minimap.tiles.size, 0); assert.equal(minimap.tileGeneration, 1); assert.equal(minimap.tileReleases, 160);
});

test('chart hibernation releases coarse tiles and its full-screen backing canvas', () => {
  const chart = Object.create(WorldMap.prototype), first = tileCanvas(96, 96), second = tileCanvas(96, 96);
  Object.assign(chart, {
    canvas: { width: 2000, height: 1000 }, open: true, dpr: 2, tiles: new Map([['0,0', { canvas: first }], ['1,0', { canvas: second }]]),
    tileGeneration: 0, tileReleases: 0, releasedBackingBytes: 0,
  });
  const tileBytes = 2 * 96 * 96 * 4, canvasBytes = 2000 * 1000 * 4;
  assert.equal(chart.hibernate(), tileBytes + canvasBytes - 4);
  assert.deepEqual([chart.canvas.width, chart.canvas.height, chart.tiles.size, chart.tileGeneration, chart.tileReleases], [1, 1, 0, 1, 2]);
  assert.equal(chart.releasedBackingBytes, tileBytes);
});

test('late terrain worker replies cannot recreate canvases released during hibernation', async () => {
  const previousDocument = globalThis.document, previousImageData = globalThis.ImageData;
  let createdCanvases = 0, resolveRadar, resolveChart;
  globalThis.document = {
    createElement: () => {
      createdCanvases++;
      return { width: 0, height: 0, getContext: () => ({ putImageData: () => {} }) };
    },
  };
  globalThis.ImageData = class ImageData {};
  try {
    const minimap = Object.create(Minimap.prototype);
    Object.assign(minimap, {
      T: { tile: () => new Promise(resolve => { resolveRadar = resolve; }) },
      tiles: new Map(), inFlight: 0, completedTiles: 0, peakCompletedTiles: 0,
      tileGeneration: 0, tileEvictions: 0, tileReleases: 0, releasedBackingBytes: 0,
      cacheLimit: 160, trimTarget: 144,
    });
    minimap.tile(2, -3); minimap.releaseTiles(); resolveRadar(new Uint8ClampedArray(100 * 100 * 4));
    await Promise.resolve();
    assert.deepEqual([minimap.tiles.size, minimap.inFlight, minimap.completedTiles], [0, 0, 0]);

    const chart = Object.create(WorldMap.prototype);
    Object.assign(chart, {
      T: { tile: () => new Promise(resolve => { resolveChart = resolve; }) },
      tiles: new Map(), inFlight: 0, tileGeneration: 0, tileReleases: 0, releasedBackingBytes: 0, open: false,
    });
    chart.tile(-1, 1); chart.releaseTiles(); resolveChart(new Uint8ClampedArray(96 * 96 * 4));
    await Promise.resolve();
    assert.deepEqual([chart.tiles.size, chart.inFlight], [0, 0]);
    assert.equal(createdCanvases, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousImageData === undefined) delete globalThis.ImageData; else globalThis.ImageData = previousImageData;
  }
});
