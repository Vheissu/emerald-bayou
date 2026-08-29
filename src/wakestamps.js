const stamp = () => ({ x: 0, z: 0, radius: 0, height: 0, foam: 0, foamRadius: 0 });

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
    for (let i = 0; i < this.count; i++) out.push(this.items[i]);
  }
}
