export const MAP_MARKER_CAPACITY = 256;

const makeMarker = () => ({
  x: 0,
  z: 0,
  kind: 'dot',
  color: '',
  heading: 0,
  clamp: false,
  glyph: '',
  locked: false,
  done: false,
  known: false,
  soft: false,
  r: 0,
});

const assignMarker = (marker, x, z, kind, color, heading, clamp, glyph, locked, done, known, soft, radius) => {
  marker.x = x;
  marker.z = z;
  marker.kind = kind;
  marker.color = color;
  marker.heading = heading;
  marker.clamp = clamp;
  marker.glyph = glyph;
  marker.locked = locked;
  marker.done = done;
  marker.known = known;
  marker.soft = soft;
  marker.r = radius;
  return marker;
};

// Radar markers only live for one rendered frame. Keeping a fixed set of stable-shape objects avoids creating and
// collecting the same job, boat, wildlife and hazard records sixty times a second as the streamed world moves.
export class MapMarkerPool {
  constructor(capacity = MAP_MARKER_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(Number(capacity) || 1));
    this.items = Array.from({ length: this.capacity }, makeMarker);
    this.count = 0;
    this.droppedFrame = 0;
    this.droppedTotal = 0;
  }

  reset() {
    this.count = 0;
    this.droppedFrame = 0;
  }

  emit(out, x, z, kind = 'dot', color = '', heading = 0, clamp = false, glyph = '', locked = false, done = false, known = false, soft = false, radius = 0) {
    if (this.count >= this.capacity) {
      this.droppedFrame++;
      this.droppedTotal++;
      return null;
    }
    const marker = assignMarker(this.items[this.count++], x, z, kind, color, heading, clamp, glyph, locked, done, known, soft, radius);
    out.push(marker);
    return marker;
  }

  stats(displayed = this.count) {
    return { displayed, pooled: this.count, capacity: this.capacity, droppedFrame: this.droppedFrame, droppedTotal: this.droppedTotal };
  }
}

// Directors are also exercised with lightweight game doubles in unit tests. They retain the old array contract there;
// the real game owns the pool and takes the allocation-free branch.
export function emitMapMarker(game, x, z, kind = 'dot', color = '', heading = 0, clamp = false, glyph = '', locked = false, done = false, known = false, soft = false, radius = 0) {
  if (game?.mapMarkerPool?.emit) return game.mapMarkerPool.emit(game.mapMarkers, x, z, kind, color, heading, clamp, glyph, locked, done, known, soft, radius);
  const marker = assignMarker(makeMarker(), x, z, kind, color, heading, clamp, glyph, locked, done, known, soft, radius);
  game.mapMarkers.push(marker);
  return marker;
}
