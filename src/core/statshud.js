import { BUDGETS } from './budgets.js';

/**
 * A budget meter, not a vanity FPS counter. §3.4 calls the budgets
 * "non-negotiable", so they are on screen in red the moment they are broken.
 * Toggle with F1.
 */
export class StatsHud {
  constructor(el, renderer) {
    this.el = el;
    this.renderer = renderer;
    this.visible = new URLSearchParams(location.search).has('stats');
    this.el.hidden = !this.visible;
    this.frames = 0;
    this.accum = 0;
    this.fps = 0;
    this.worstFps = 999;
    this.extra = {};
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /**
   * Returns a truthy fps only on the frames where a new measurement landed, so
   * the caller knows when to refresh the expensive extras (light counts and so
   * on). Painting happens in `flush()` AFTER those extras are written - painting
   * inside here showed last-half-second's numbers, which made the budget meter
   * lie about exactly the things it exists to police.
   */
  sample(dt) {
    this.frames++;
    this.accum += dt;
    this._fresh = false;
    if (this.accum >= 0.5) {
      this.fps = Math.round(this.frames / this.accum);
      if (this.accum > 0.4 && this.fps < this.worstFps) this.worstFps = this.fps;
      this.frames = 0;
      this.accum = 0;
      this._fresh = true;
      return this.fps;
    }
    return 0;
  }

  flush() {
    if (this._fresh && this.visible) this._paint();
  }

  set(key, value) { this.extra[key] = value; }

  _paint() {
    const info = this.renderer.info;
    const rows = [
      ['fps', this.fps, this.fps < (this.extra.fpsFloor ?? 55)],
      ['draw calls', info.render.calls, info.render.calls > BUDGETS.drawCalls],
      ['triangles', fmt(info.render.triangles), info.render.triangles > BUDGETS.streetTriangles],
      ['programs', info.programs?.length ?? 0, false],
      ['textures', info.memory.textures, false],
      ['geometries', info.memory.geometries, false],
      ['interiors', this.extra.interiors ?? 0, (this.extra.interiors ?? 0) > BUDGETS.loadedInteriors],
      ['videos', this.extra.videos ?? 0, (this.extra.videos ?? 0) > BUDGETS.videoDecodes],
      ['lights', this.extra.lights ?? 0, (this.extra.lights ?? 0) > BUDGETS.realtimeLights],
      ['tier', this.extra.tier ?? '-', false],
      ['district', this.extra.district ?? '-', false],
    ];

    this.el.innerHTML = rows
      .map(([k, v, bad]) => `${k.padEnd(11)}<b class="${bad ? 'over' : ''}">${v}</b>`)
      .join('\n');
  }
}

const fmt = (n) => (n > 9999 ? `${(n / 1000).toFixed(0)}k` : String(n));
