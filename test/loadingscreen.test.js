import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOADING_SCENES, initialLoadingSceneIndex, loadingAssetUrl, shuffledLoadingSceneIndices } from '../src/loading-scenes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function webpDimensions(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === 'VP8X') return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 };
    if (type === 'VP8 ') return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff };
    if (type === 'VP8L') {
      const bits = buffer.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = data + size + size % 2;
  }
  throw new Error('WebP image dimensions not found');
}

test('six unique local loading scenes keep distinct copy and focal points', () => {
  assert.equal(LOADING_SCENES.length, 6);
  assert.equal(new Set(LOADING_SCENES.map(scene => scene.id)).size, 6);
  assert.equal(new Set(LOADING_SCENES.map(scene => scene.src)).size, 6);
  assert.equal(new Set(LOADING_SCENES.map(scene => scene.district)).size, 6);
  for (const scene of LOADING_SCENES) {
    assert.match(scene.src, /^loading\/[a-z-]+\.webp$/);
    assert.match(scene.accent, /^#[0-9a-f]{6}$/i);
    assert.ok(scene.title.length > 4 && scene.note.length > 12 && scene.mobilePosition.includes('%'));
  }
});

test('initial selection honors QA requests and Save-Data while normal loads randomize', () => {
  assert.equal(initialLoadingSceneIndex({ requested: 'pressure-drop', random: () => 0 }), 3);
  assert.equal(initialLoadingSceneIndex({ saveData: true, random: () => 0.99 }), 0);
  assert.equal(initialLoadingSceneIndex({ random: () => 0.999 }), 5);
  assert.equal(loadingAssetUrl('loading/a.webp', 'https://example.test/emerald-bayou/'), 'https://example.test/emerald-bayou/loading/a.webp');
});

test('the shuffled bag visits every other scene once before repeating', () => {
  const order = shuffledLoadingSceneIndices(2, () => 0.37);
  assert.equal(order.length, 5);
  assert.equal(new Set(order).size, 5);
  assert.ok(!order.includes(2));
  assert.ok(order.every(index => index >= 0 && index < LOADING_SCENES.length));
});

test('loading artwork stays on one canvas and under its compressed memory budget', async () => {
  let totalBytes = 0;
  for (const scene of LOADING_SCENES) {
    const file = join(root, 'public', scene.src);
    const [buffer, metadata] = await Promise.all([readFile(file), stat(file)]);
    assert.deepEqual(webpDimensions(buffer), { width: 1672, height: 941 });
    assert.ok(metadata.size < 250_000, `${scene.id} exceeds 250 KB`);
    totalBytes += metadata.size;
  }
  assert.ok(totalBytes < 1_100_000, `loading artwork totals ${totalBytes} bytes`);
});

test('the loader retains only its two crossfade images and releases them after use', async () => {
  const [index, loader, css, bootstrap, main] = await Promise.all([
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'src', 'loading-screen.js'), 'utf8'),
    readFile(join(root, 'src', 'loading-screen.css'), 'utf8'),
    readFile(join(root, 'src', 'bootstrap.js'), 'utf8'),
    readFile(join(root, 'src', 'main.js'), 'utf8'),
  ]);
  assert.equal((index.match(/class="loading-art/g) || []).length, 2);
  assert(!loader.includes('new Image('));
  assert(loader.includes("outgoing.removeAttribute('src')"));
  assert(loader.includes("for (const layer of layers) layer.removeAttribute('src')"));
  assert(loader.includes('window.__loadingScreen = null'));
  assert(loader.includes('constrainedAssetTransfer(navigator.connection)'));
  assert(loader.includes('reducedMotion || constrainedTransfer'));
  assert(loader.includes("visibilitychange"));
  assert(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert(css.includes('100dvh'));
  assert(bootstrap.includes("import('./main.js')"));
  assert(bootstrap.includes('loaderOnly'));
  assert(main.includes("window.__loadingScreen?.complete?.()"));
  assert(main.includes("window.__loadingScreen?.progress?."));
});
