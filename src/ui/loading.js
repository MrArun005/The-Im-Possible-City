/**
 * The loading experience (Task 4.4).
 *
 * A foggy 2D illustration that match-cuts into the real 3D fog. It is drawn to
 * roughly the framing of the intro dolly's first shot - silhouetted terraces
 * either side, two lamp glows, a figure in the middle distance - so when the
 * layer fades the composition does not jump. It also animates while it waits,
 * which means a slow connection still feels like the city is switching on
 * rather than like nothing is happening.
 */
export class LoadingScreen {
  constructor({ palette } = {}) {
    this.el = document.getElementById('loader');
    this.canvas = document.getElementById('loader-art');
    this.fill = document.getElementById('loader-fill');
    this.sub = document.getElementById('loader-sub');
    this.enterBtn = document.getElementById('loader-enter');
    this.ctx = this.canvas.getContext('2d');
    this.progress = 0;
    this.shown = 0;
    this.time = 0;
    this.done = false;
    this.palette = palette ?? {
      sky: ['#0a0d14', '#1c1a1d', '#3a2b22'],
      lamp: '#ffb765',
      ink: '#05060a',
    };
    this._resize();
    this._onResize = () => this._resize();
    addEventListener('resize', this._onResize);
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.w = this.canvas.width;
    this.h = this.canvas.height;
  }

  set(progress, label) {
    this.progress = Math.max(this.progress, Math.min(1, progress));
    this.fill.style.width = `${Math.round(this.progress * 100)}%`;
    if (label) this.sub.textContent = `${label}…`;
  }

  /** Resolves when the viewer chooses to enter (needed for audio autoplay). */
  ready(label = 'Step into the fog') {
    this.set(1, 'The lamps are lit');
    this.enterBtn.textContent = label;
    this.enterBtn.hidden = false;
    return new Promise((resolve) => {
      this.enterBtn.addEventListener('click', () => resolve(), { once: true });
    });
  }

  hide() {
    this.done = true;
    this.el.classList.add('is-gone');
    setTimeout(() => {
      cancelAnimationFrame(this._raf);
      removeEventListener('resize', this._onResize);
      this.el.remove();
    }, 1400);
  }

  fail(message) {
    this.sub.textContent = message;
    this.fill.style.background = '#ff7a6b';
  }

  // ---------------------------------------------------------------- drawing
  _loop(now) {
    this.time = now / 1000;
    this._draw();
    if (!this.done) this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _draw() {
    const { ctx, w, h, time } = this;
    const p = this.palette;
    const horizon = h * 0.72;

    // Sky, graded down to the fog band at street level.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, p.sky[0]);
    sky.addColorStop(0.55, p.sky[1]);
    sky.addColorStop(1, p.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Two rows of building silhouettes in perspective, left and right.
    const unit = w * 0.11;
    for (const side of [-1, 1]) {
      for (let i = 6; i >= 0; i--) {
        const depth = i / 6;
        const x = w / 2 + side * (unit * 0.7 + depth * w * 0.42);
        const bw = unit * (1.5 - depth * 0.85);
        const bh = h * (0.62 - depth * 0.34) * (0.85 + ((i * 37) % 11) / 40);
        // Nearer buildings are darker; distance is drawn by contrast, not blur.
        const shade = 0.1 + depth * 0.5;
        ctx.fillStyle = shadeInk(p.ink, shade);
        ctx.fillRect(x - bw / 2, horizon - bh, bw, bh + h * 0.3);

        // A few lit windows per building, breathing.
        const cols = 2;
        const rows = 4;
        for (let cx = 0; cx < cols; cx++) {
          for (let ry = 0; ry < rows; ry++) {
            const seed = (i * 31 + cx * 7 + ry * 13 + (side > 0 ? 91 : 0)) % 17;
            if (seed > 8) continue;
            const flick = 0.55 + 0.45 * Math.sin(time * (0.6 + seed * 0.11) + seed);
            ctx.fillStyle = `rgba(255,183,101,${(0.12 + depth * 0.22) * flick})`;
            const ww = bw * 0.2;
            const wh = bh * 0.055;
            ctx.fillRect(
              x - bw / 2 + bw * (0.24 + cx * 0.42),
              horizon - bh + bh * (0.16 + ry * 0.2),
              ww, wh
            );
          }
        }
      }
    }

    // Ground, wet, with the lamp reflections streaked down it.
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, shadeInk(p.ink, 0.22));
    ground.addColorStop(1, shadeInk(p.ink, 0.02));
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Gas lamps: a hot core, a wide halo, a wet reflection.
    const lamps = [
      { x: w * 0.3, y: horizon - h * 0.16, s: 1.0 },
      { x: w * 0.68, y: horizon - h * 0.12, s: 0.8 },
      { x: w * 0.51, y: horizon - h * 0.05, s: 0.42 },
    ];
    for (const lamp of lamps) {
      const pulse = 0.86 + 0.14 * Math.sin(time * 2.1 + lamp.x);
      const r = w * 0.14 * lamp.s * pulse;
      const halo = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, r);
      halo.addColorStop(0, `rgba(255,205,150,${0.55 * pulse})`);
      halo.addColorStop(0.25, `rgba(255,183,101,${0.22 * pulse})`);
      halo.addColorStop(1, 'rgba(255,183,101,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(lamp.x - r, lamp.y - r, r * 2, r * 2);

      const streak = ctx.createLinearGradient(lamp.x, horizon, lamp.x, h);
      streak.addColorStop(0, `rgba(255,183,101,${0.16 * pulse * lamp.s})`);
      streak.addColorStop(1, 'rgba(255,183,101,0)');
      ctx.fillStyle = streak;
      ctx.fillRect(lamp.x - r * 0.16, horizon, r * 0.32, h - horizon);
    }

    // One figure, small, walking away. Scale is everything.
    const figX = w * 0.46 + Math.sin(time * 0.16) * w * 0.02;
    const figH = h * 0.12;
    ctx.fillStyle = shadeInk(p.ink, 0.0);
    ctx.fillRect(figX - figH * 0.1, horizon - figH, figH * 0.2, figH);
    ctx.beginPath();
    ctx.arc(figX, horizon - figH - figH * 0.09, figH * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(figX - figH * 0.13, horizon - figH - figH * 0.16, figH * 0.26, figH * 0.03);

    // Fog: three drifting bands. This is the layer the 3D fog cuts into.
    for (let i = 0; i < 3; i++) {
      const y = horizon - h * (0.02 + i * 0.06) + Math.sin(time * 0.12 + i) * h * 0.01;
      const band = ctx.createLinearGradient(0, y - h * 0.12, 0, y + h * 0.16);
      band.addColorStop(0, 'rgba(120,110,100,0)');
      band.addColorStop(0.5, `rgba(150,138,124,${0.1 - i * 0.02})`);
      band.addColorStop(1, 'rgba(120,110,100,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, y - h * 0.12, w, h * 0.28);
    }

    // Vignette, matching the post-processing one.
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.24, w / 2, h / 2, h * 0.92);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }
}

function shadeInk(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) + amount * 90);
  const g = Math.round(((n >> 8) & 255) + amount * 84);
  const b = Math.round((n & 255) + amount * 78);
  return `rgb(${r},${g},${b})`;
}
