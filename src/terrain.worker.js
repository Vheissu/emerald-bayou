// Terrain worker: evaluates chunk height grids and minimap tiles off the main thread.
import { WorldHeight } from './heightfield.js';

let hf = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.kind === 'init') { hf = new WorldHeight(m.seed); return; }
  if (!hf) hf = new WorldHeight(7);
  if (m.kind === 'grid') {
    const g = hf.grid(m.x0, m.z0, m.size, m.n);
    self.postMessage({ id: m.id, kind: 'grid', h: g.h, nrm: g.nrm, bio: g.bio, minH: g.minH, maxH: g.maxH }, [g.h.buffer, g.nrm.buffer, g.bio.buffer]);
  } else if (m.kind === 'tile') {
    const rgba = hf.tile(m.x0, m.z0, m.size, m.px, m.style);
    self.postMessage({ id: m.id, kind: 'tile', rgba }, [rgba.buffer]);
  }
};
