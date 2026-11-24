import { WorldHeight, WORLD_HALF } from './heightfield.js';
import { planWaterRoute } from './waterroute.js';
import { bridgeOverheadAt } from './waterfrontlayout.js';

let heightfield;
self.onmessage = ({ data }) => {
  if (!heightfield || heightfield.seed !== data.seed) heightfield = new WorldHeight(data.seed);
  const result = planWaterRoute({
    ...data, heightAt: (x, z) => heightfield.compute(x, z), limit: WORLD_HALF - 60, overheadAt: bridgeOverheadAt,
  });
  self.postMessage({ id: data.id, ...result });
};
