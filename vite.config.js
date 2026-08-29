import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const outputRoot = join(root, 'dist');
const modelRoot = join(publicRoot, 'models');
const modelSources = join(publicRoot, 'models', 'src');
const runtimeModels = new Set([
  'beau_boat.glb', 'boat_dreams.glb', 'driver.glb', 'fish_a.glb', 'grass_a.glb', 'grass_d.glb',
  'realistic_alligator.glb', 'sandbox_boat.glb', 'tree_c.glb', 'turtle_boat.glb',
]);

function copyRuntimeAssets(from, to) {
  if (from === modelSources) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name), destination = join(to, entry.name);
    if (entry.isDirectory()) copyRuntimeAssets(source, destination);
    else if (entry.isFile() && (from !== modelRoot || runtimeModels.has(entry.name))) copyFileSync(source, destination);
  }
}

export default defineConfig({
  // Relative URLs keep the production build portable while GitHub Pages serves it
  // from the repository subpath (/emerald-bayou/).
  base: './',
  build: { copyPublicDir: false },
  plugins: [{
    name: 'copy-runtime-public-assets',
    closeBundle() { copyRuntimeAssets(publicRoot, outputRoot); },
  }],
});
