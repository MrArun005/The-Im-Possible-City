/**
 * Tiny 2D canvas helpers shared by every procedural texture.
 *
 * DEVIATION FROM THE PLAN (§5 Asset Pipeline): the plan sources PBR textures
 * from Poly Haven / Sketchfab. Nothing in this repo may ship third-party
 * binaries, so every texture here is drawn at runtime into a canvas. It costs
 * ~40ms of startup, keeps the initial payload at roughly zero bytes against an
 * 8MB budget, and means the whole city is a `git clone` away from running.
 * Real texture files can be dropped in later - see `public/districts/README.md`.
 */
export function makeCanvas(width, height = width) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx, width, height };
}

export function fill(ctx, color, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** Value noise, tiling on both axes so textures can repeat without seams. */
export function tileNoise(ctx, w, h, { cell = 16, alpha = 0.25, color = '#000' } = {}) {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.globalAlpha = alpha * Math.random();
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.restore();
}

/** Per-pixel grain. Cheap and it is what stops flat fills from looking CG. */
export function grain(ctx, w, h, strength = 14) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function splotches(ctx, w, h, { count = 40, radius = 40, color = 'rgba(0,0,0,0.15)' } = {}) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = radius * (0.3 + Math.random());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Soot: darkness that pools at the top of walls and under sills. */
export function soot(ctx, w, h, strength = 0.55) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(10,10,12,${strength})`);
  g.addColorStop(0.35, 'rgba(10,10,12,0.12)');
  g.addColorStop(1, `rgba(10,10,12,${strength * 0.5})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Sobel height -> normal map. Lets one drawn heightmap produce the normal map
 * that would otherwise be a 4MB download.
 */
export function heightToNormal(sourceCtx, w, h, strength = 2.2) {
  const src = sourceCtx.getImageData(0, 0, w, h).data;
  const { canvas, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const at = (x, y) => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    return src[(yy * w + xx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      const nx = dx * strength;
      const ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Grayscale copy, remapped into [lo, hi] - used for roughness/metalness maps. */
export function toGrayscale(sourceCtx, w, h, lo = 0, hi = 1) {
  const src = sourceCtx.getImageData(0, 0, w, h);
  const { canvas, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const l = (src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114) / 255;
    const v = (lo + l * (hi - lo)) * 255;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
