const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// One director turns the clock and weather into behaviour budgets. Individual systems still own their movement;
// this only answers the ecological questions: who is out, who has gone home, and what is willing to surface.
export class Ecology {
  constructor(o) {
    Object.assign(this, o); // environment, birds, waders, manatees, gators, life, world, audio
    this.human = 1; this.traffic = 1; this.fish = 1; this.bird = 1; this.gator = 1; this.surface = 1;
    this.visibilityT = 0; this.frogT = 8 + Math.random() * 10;
  }

  updateVisibility() {
    const outside = this.human > 0.24;
    const setPeople = g => { if (g && g.userData && g.userData.people) for (const p of g.userData.people) p.visible = outside; };
    for (const g of this.world.liveCamps.values()) setPeople(g);
    for (const { g } of this.world.liveSites.values()) setPeople(g);
  }

  update(dt, t, enabled = true) {
    if (!enabled) return;
    const E = this.environment, V = E.values, h = E.hour;
    const day = smooth(5.6, 7.1, h) * (1 - smooth(18.5, 20.2, h));
    const hourDist = target => { const d = Math.abs(h - target); return Math.min(d, 24 - d); };
    const twilight = Math.max(Math.exp(-Math.pow(hourDist(6.9) / 1.35, 2)), Math.exp(-Math.pow(hourDist(19.1) / 1.35, 2)));
    const R = this.regions && this.regions.current ? this.regions.current.ecology : {};
    const humanT = clamp((0.035 + day * 0.965) * (1 - V.storm * 0.96) * (1 - V.rain * 0.36) * (R.human ?? 1), 0, 1.2);
    const trafficT = clamp((0.14 + day * 0.86) * (1 - V.storm * 0.86) * (R.traffic ?? 1), 0, 1.4);
    const fishT = clamp((0.38 + twilight * 0.58 + V.rain * 0.12 - V.storm * 0.24) * (R.fish ?? 1), 0.08, 1.35);
    const birdT = clamp((0.035 + day * 0.965) * (1 - V.storm * 0.92) * (R.bird ?? 1), 0, 1.65);
    const gatorT = clamp((0.68 + (1 - day) * 0.34 + twilight * 0.26 + V.rain * 0.08) * (R.gator ?? 1), 0.35, 1.65);
    const surfaceT = clamp((1 - V.storm * 0.72 - V.rain * 0.14) * (R.surface ?? 1), 0.06, 1.1);
    const k = 1 - Math.exp(-dt * 0.65);
    this.human += (humanT - this.human) * k; this.traffic += (trafficT - this.traffic) * k;
    this.fish += (fishT - this.fish) * k; this.bird += (birdT - this.bird) * k;
    this.gator += (gatorT - this.gator) * k; this.surface += (surfaceT - this.surface) * k;

    this.life.fish.activity = this.fish;
    this.life.traffic.activity = this.traffic;
    this.life.traffic.anglerActivity = this.human;
    this.life.folk.activity = this.human;
    this.world.humanActivity = this.human;
    this.birds.activity = this.bird;
    this.waders.activity = clamp(this.bird * 0.9 + 0.05);
    this.manatees.surfaceActivity = this.surface;
    this.gators.activity = this.gator;

    this.visibilityT -= dt;
    if (this.visibilityT <= 0) { this.visibilityT = 0.5; this.updateVisibility(); }

    const night = 1 - day;
    if (night > 0.45 && V.storm < 0.88) {
      this.frogT -= dt;
      if (this.frogT <= 0) { this.frogT = 7 + Math.random() * 18; this.audio.frog((0.05 + night * 0.09) * (0.8 + V.rain * 0.35)); }
    } else this.frogT = Math.min(this.frogT, 8 + Math.random() * 5);
  }
}
