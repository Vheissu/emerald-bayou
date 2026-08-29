const stamp = () => ({ x: 0, z: 0, radius: 0, height: 0, foam: 0, foamRadius: 0 });

export function emitWakeStamp(out, x, z, radius, height, foam = 0, foamRadius = radius) {
  if (typeof out?.emit === 'function') return out.emit(x, z, radius, height, foam, foamRadius);
  const item = { x, z, radius, height, foam, foamRadius };
  out.push(item);
  return item;
}

export class WakeStampPool {
  constructor(capacity = 32) {
    this.capacity = Math.max(1, Math.floor(Number(capacity) || 1));
    this.items = Array.from({ length: this.capacity }, stamp);
    this.count = 0;
    this.droppedFrame = 0;
    this.droppedTotal = 0;
  }

  reset() {
    this.count = 0;
    this.droppedFrame = 0;
  }

  emit(x, z, radius, height, foam = 0, foamRadius = radius) {
    if (this.count >= this.capacity) {
      this.droppedFrame++;
      this.droppedTotal++;
      return null;
    }
    const item = this.items[this.count++];
    item.x = x;
    item.z = z;
    item.radius = radius;
    item.height = height;
    item.foam = foam;
    item.foamRadius = foamRadius;
    return item;
  }

  appendTo(out) {
    if (typeof out?.emit === 'function') {
      for (let i = 0; i < this.count; i++) {
        const item = this.items[i];
        out.emit(item.x, item.z, item.radius, item.height, item.foam, item.foamRadius);
      }
      return;
    }
    for (let i = 0; i < this.count; i++) out.push(this.items[i]);
  }
}
