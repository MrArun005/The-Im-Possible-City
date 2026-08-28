import * as THREE from 'three';
import {
  makeCanvas, fill, grain, splotches, soot, heightToNormal, toGrayscale, roundRect,
} from './canvas.js';
import { makeRng } from '../util/rng.js';

/**
 * The texture library. Everything is generated once, cached by key, and shared
 * across instances - which is how a 60-building street stays inside the
 * draw-call and memory budgets.
 */
const cache = new Map();

export function texture(key, factory, { srgb = true, repeat = [1, 1], aniso = 4 } = {}) {
  if (cache.has(key)) return cache.get(key);
  const canvas = factory();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  cache.set(key, tex);
  return tex;
}

export function clearTextureCache() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

export function cachedCount() { return cache.size; }

// ---------------------------------------------------------------- masonry

/** London brick: sooty, uneven, with mortar that has seen a hundred winters. */
function brickCanvas({ size = 512, base = '#3a2b26', mortar = '#4a443e', seed = 7 } = {}) {
  const { canvas, ctx } = makeCanvas(size);
  const rng = makeRng(seed);
  fill(ctx, mortar, size, size);

  const rows = 16;
  const bh = size / rows;
  const bw = bh * 2.4;
  const c = new THREE.Color(base);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (bw / 2);
    for (let x = -bw; x < size + bw; x += bw) {
      const shade = 0.72 + rng() * 0.5;
      const tinted = c.clone().multiplyScalar(shade);
      // A few bricks are burnt darker or a warmer red - reads as hand-laid.
      if (rng.chance(0.07)) tinted.lerp(new THREE.Color('#6b3226'), 0.4);
      if (rng.chance(0.05)) tinted.multiplyScalar(0.55);
      ctx.fillStyle = `#${tinted.getHexString()}`;
      ctx.fillRect(x + offset + 1.2, r * bh + 1.2, bw - 2.4, bh - 2.4);
    }
  }

  splotches(ctx, size, size, { count: 26, radius: size * 0.16, color: 'rgba(8,8,10,0.22)' });
  soot(ctx, size, size, 0.42);
  grain(ctx, size, size, 18);
  return canvas;
}

export const brick = (variant = 0) => {
  const palettes = [
    { base: '#3a2b26', mortar: '#4a443e' },
    { base: '#4a3128', mortar: '#514a41' },
    { base: '#2f2a2c', mortar: '#403c39' },
    { base: '#503a2c', mortar: '#59503f' },
    { base: '#33302f', mortar: '#474441' },
  ];
  const p = palettes[variant % palettes.length];
  return texture(`brick-${variant}`, () => brickCanvas({ ...p, seed: 7 + variant * 13 }), {
    repeat: [1, 1],
  });
};

export const brickNormal = (variant = 0) =>
  texture(
    `brick-n-${variant}`,
    () => {
      const size = 512;
      const { canvas, ctx } = makeCanvas(size);
      const src = brickCanvas({ base: '#888', mortar: '#333', seed: 7 + variant * 13, size });
      ctx.drawImage(src, 0, 0);
      return heightToNormal(ctx, size, size, 1.5);
    },
    { srgb: false }
  );

/** Stone / plaster for ground floors and NYC brownstone bases. */
export const stone = (variant = 0) =>
  texture(`stone-${variant}`, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(91 + variant * 7);
    fill(ctx, ['#4a4741', '#524a42', '#3f3d3a'][variant % 3], size, size);
    const rows = 7;
    const bh = size / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 60;
      while (x < size) {
        const bw = size / (2.2 + rng() * 1.6);
        ctx.fillStyle = `rgba(${20 + rng() * 40 | 0},${20 + rng() * 36 | 0},${18 + rng() * 32 | 0},0.5)`;
        ctx.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
        x += bw;
      }
    }
    splotches(ctx, size, size, { count: 34, radius: size * 0.1, color: 'rgba(0,0,0,0.2)' });
    soot(ctx, size, size, 0.3);
    grain(ctx, size, size, 15);
    return canvas;
  });

// ---------------------------------------------------------------- ground

/** Cobblestone (Task 1.4): albedo, plus derived normal and roughness. */
function cobbleHeight(size = 512) {
  const { canvas, ctx } = makeCanvas(size);
  const rng = makeRng(4242);
  fill(ctx, '#101010', size, size);
  const rows = 13;
  const ch = size / rows;

  for (let r = -1; r <= rows; r++) {
    const offset = (r % 2) * (ch * 0.55);
    for (let x = -ch; x < size + ch; x += ch * 1.15) {
      const cx = x + offset + rng.range(-2.5, 2.5);
      const cy = r * ch + ch / 2 + rng.range(-2.5, 2.5);
      const rad = ch * rng.range(0.4, 0.56);
      const g = ctx.createRadialGradient(cx - rad * 0.25, cy - rad * 0.25, 0, cx, cy, rad);
      g.addColorStop(0, '#e8e8e8');
      g.addColorStop(0.6, '#9a9a9a');
      g.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * rng.range(0.82, 1.0), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { canvas, ctx };
}

export const cobbleAlbedo = () =>
  texture(
    'cobble-a',
    () => {
      const size = 512;
      const { canvas, ctx } = makeCanvas(size);
      const h = cobbleHeight(size);
      fill(ctx, '#22201f', size, size);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(h.canvas, 0, 0);
      ctx.globalAlpha = 1;
      // Wet-dark tint plus the odd pale stone.
      splotches(ctx, size, size, { count: 30, radius: size * 0.12, color: 'rgba(10,12,14,0.4)' });
      splotches(ctx, size, size, { count: 12, radius: size * 0.05, color: 'rgba(150,145,135,0.12)' });
      grain(ctx, size, size, 16);
      return canvas;
    },
    { repeat: [14, 14], aniso: 8 }
  );

export const cobbleNormal = () =>
  texture('cobble-n', () => {
    const size = 512;
    const h = cobbleHeight(size);
    return heightToNormal(h.ctx, size, size, 2.6);
  }, { srgb: false, repeat: [14, 14], aniso: 8 });

export const cobbleRough = () =>
  texture('cobble-r', () => {
    const size = 512;
    const h = cobbleHeight(size);
    return toGrayscale(h.ctx, size, size, 0.42, 0.95);
  }, { srgb: false, repeat: [14, 14] });

/** Asphalt for NYC (Task 5.3): darker, finer, with lane paint and patches. */
function asphaltHeight(size = 512) {
  const { canvas, ctx } = makeCanvas(size);
  fill(ctx, '#3a3a3a', size, size);
  const rng = makeRng(808);
  for (let i = 0; i < 5200; i++) {
    const v = 40 + rng() * 170;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rng() * size, rng() * size, rng.range(1, 3.4), rng.range(1, 3.4));
  }
  splotches(ctx, size, size, { count: 18, radius: size * 0.14, color: 'rgba(255,255,255,0.06)' });
  return { canvas, ctx };
}

export const asphaltAlbedo = () =>
  texture('asphalt-a', () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    fill(ctx, '#141518', size, size);
    const h = asphaltHeight(size);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(h.canvas, 0, 0);
    ctx.globalAlpha = 1;
    // Tar seams: the detail that says "this road has been repaired".
    const rng = makeRng(31);
    ctx.strokeStyle = 'rgba(6,6,8,0.85)';
    for (let i = 0; i < 5; i++) {
      ctx.lineWidth = rng.range(2, 6);
      ctx.beginPath();
      ctx.moveTo(rng() * size, 0);
      for (let y = 0; y <= size; y += 32) ctx.lineTo(rng() * size, y);
      ctx.stroke();
    }
    grain(ctx, size, size, 12);
    return canvas;
  }, { repeat: [10, 10], aniso: 8 });

export const asphaltNormal = () =>
  texture('asphalt-n', () => {
    const size = 512;
    const h = asphaltHeight(size);
    return heightToNormal(h.ctx, size, size, 0.8);
  }, { srgb: false, repeat: [10, 10] });

/** Wet-road roughness: streaks and pools where the road holds water. */
export const wetnessMask = () =>
  texture('wetness', () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    fill(ctx, '#ffffff', size, size);
    splotches(ctx, size, size, { count: 46, radius: size * 0.15, color: 'rgba(0,0,0,0.9)' });
    splotches(ctx, size, size, { count: 90, radius: size * 0.05, color: 'rgba(0,0,0,0.6)' });
    return canvas;
  }, { srgb: false, repeat: [5, 5] });

/** Puddle decal (Task 1.4) - an alpha shape, laid flat on the cobbles. */
export const puddleDecal = () =>
  texture('puddle', () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size);
    ctx.clearRect(0, 0, size, size);
    const rng = makeRng(17);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const r = size * (0.28 + Math.sin(a * 3 + 1) * 0.05 + rng() * 0.045);
      const x = size / 2 + Math.cos(a) * r * 1.35;
      const y = size / 2 + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // Feather the edge so the decal never shows a hard cut.
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }, { srgb: false, repeat: [1, 1] });

// ---------------------------------------------------------------- windows

/**
 * The living-windows atlas (Task 5.2). A 4x4 grid of window states drawn once;
 * an instanced UV offset picks which cell each window uses, so a whole skyline
 * of individually-lit windows costs one draw call and one texture.
 */
export const windowAtlas = (tint = '#ffb765') =>
  texture(`window-atlas-${tint}`, () => {
    const cells = 4;
    const cell = 128;
    const size = cell * cells;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(2024);
    fill(ctx, '#05060a', size, size);
    const warm = new THREE.Color(tint);

    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const ox = cx * cell;
        const oy = cy * cell;
        const index = cy * cells + cx;
        // Cell 0 is always dark; the rest ramp from dim to blazing.
        const lit = index === 0 ? 0 : Math.min(1, 0.22 + (index / 15) * 1.1);

        ctx.fillStyle = '#04050a';
        ctx.fillRect(ox, oy, cell, cell);

        if (lit > 0) {
          const glow = warm.clone().multiplyScalar(lit);
          if (rng.chance(0.22)) glow.lerp(new THREE.Color('#9fd2ff'), 0.55); // a cold TV-lit room
          if (rng.chance(0.14)) glow.lerp(new THREE.Color('#ff6b4a'), 0.4);  // a red lamp
          const g = ctx.createLinearGradient(ox, oy, ox, oy + cell);
          g.addColorStop(0, `#${glow.clone().multiplyScalar(1.15).getHexString()}`);
          g.addColorStop(1, `#${glow.clone().multiplyScalar(0.45).getHexString()}`);
          ctx.fillStyle = g;
          ctx.fillRect(ox + 4, oy + 4, cell - 8, cell - 8);

          // Silhouettes in a few windows - the crowd fallback from the risk table.
          if (rng.chance(0.3)) {
            ctx.fillStyle = 'rgba(6,4,3,0.72)';
            const bw = cell * rng.range(0.12, 0.2);
            const bx = ox + cell * rng.range(0.2, 0.7);
            const by = oy + cell * rng.range(0.42, 0.6);
            ctx.fillRect(bx, by, bw, cell - (by - oy) - 6);
            ctx.beginPath();
            ctx.arc(bx + bw / 2, by - bw * 0.34, bw * 0.42, 0, Math.PI * 2);
            ctx.fill();
          }
          // Curtains.
          if (rng.chance(0.4)) {
            ctx.fillStyle = 'rgba(20,12,8,0.5)';
            ctx.fillRect(ox + 4, oy + 4, cell * rng.range(0.12, 0.3), cell - 8);
            ctx.fillRect(ox + cell - 4 - cell * rng.range(0.12, 0.3), oy + 4, cell * 0.3, cell - 8);
          }
        }

        // Muntins: the glazing bars that make it read as a window at all.
        ctx.strokeStyle = '#0b0a09';
        ctx.lineWidth = 5;
        ctx.strokeRect(ox + 3, oy + 3, cell - 6, cell - 6);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ox + cell / 2, oy + 4); ctx.lineTo(ox + cell / 2, oy + cell - 4);
        ctx.moveTo(ox + 4, oy + cell / 2); ctx.lineTo(ox + cell - 4, oy + cell / 2);
        ctx.moveTo(ox + 4, oy + cell * 0.25); ctx.lineTo(ox + cell - 4, oy + cell * 0.25);
        ctx.moveTo(ox + 4, oy + cell * 0.75); ctx.lineTo(ox + cell - 4, oy + cell * 0.75);
        ctx.stroke();
      }
    }
    return canvas;
  }, { repeat: [1, 1] });

/** NYC tower window grid: one texture, many floors, per-instance UV offset. */
export const towerWindows = () =>
  texture('tower-windows', () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(5150);
    fill(ctx, '#080a10', size, size);
    const cols = 16;
    const rows = 32;
    const cw = size / cols;
    const rh = size / rows;
    const palette = ['#ffd9a0', '#ffe9c4', '#cfe4ff', '#a8ffd8', '#fff3d0'];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = rng.chance(0.42);
        if (!on) continue;
        const col = new THREE.Color(rng.pick(palette)).multiplyScalar(rng.range(0.35, 1.15));
        ctx.fillStyle = `#${col.getHexString()}`;
        ctx.fillRect(c * cw + cw * 0.18, r * rh + rh * 0.2, cw * 0.64, rh * 0.56);
      }
    }
    // Floor slabs read as dark horizontal bands.
    ctx.fillStyle = 'rgba(4,5,9,0.85)';
    for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh + rh * 0.78, size, rh * 0.22);
    return canvas;
  }, { repeat: [1, 1] });

// ---------------------------------------------------------------- wood, cloth

export const wood = (variant = 0) =>
  texture(`wood-${variant}`, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(600 + variant * 31);
    const base = ['#2a1a12', '#3b2416', '#1e1a18', '#4a2f1c'][variant % 4];
    fill(ctx, base, size, size);
    for (let i = 0; i < 220; i++) {
      const y = rng() * size;
      ctx.strokeStyle = `rgba(${rng() * 40 + 10 | 0},${rng() * 26 | 0},0,${rng() * 0.3})`;
      ctx.lineWidth = rng.range(0.6, 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 24) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * rng.range(1, 3)) * rng.range(1, 6));
      }
      ctx.stroke();
    }
    splotches(ctx, size, size, { count: 8, radius: size * 0.08, color: 'rgba(0,0,0,0.35)' });
    grain(ctx, size, size, 10);
    return canvas;
  });

export const woodNormal = (variant = 0) =>
  texture(`wood-n-${variant}`, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    ctx.drawImage(wood(variant).image, 0, 0);
    return heightToNormal(ctx, size, size, 0.6);
  }, { srgb: false });

/** Victorian wallpaper - a damask-ish stamp, deep green or oxblood. */
export const wallpaper = (variant = 0) =>
  texture(`wallpaper-${variant}`, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const bases = ['#1d2a20', '#2a1618', '#22201a', '#1a1f2a'];
    const marks = ['#3d5140', '#4a2529', '#3a352a', '#2c3550'];
    fill(ctx, bases[variant % 4], size, size);
    ctx.strokeStyle = marks[variant % 4];
    ctx.fillStyle = marks[variant % 4];
    const step = size / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const cx = x * step + step / 2 + (y % 2 ? step / 2 : 0);
        const cy = y * step + step / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(step * 0.28, -step * 0.1, 0, -step * 0.34);
          ctx.quadraticCurveTo(-step * 0.28, -step * 0.1, 0, 0);
        }
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    soot(ctx, size, size, 0.5);
    grain(ctx, size, size, 12);
    return canvas;
  }, { repeat: [3, 2] });

export const rug = () =>
  texture('rug', () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size);
    fill(ctx, '#4a1f1c', size, size);
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 5;
    ctx.strokeRect(14, 14, size - 28, size - 28);
    ctx.strokeRect(30, 30, size - 60, size - 60);
    ctx.fillStyle = '#2a3a44';
    for (let y = 48; y < size - 48; y += 34) {
      for (let x = 48; x < size - 48; x += 34) {
        ctx.beginPath();
        ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y);
        ctx.fill();
      }
    }
    soot(ctx, size, size, 0.55);
    grain(ctx, size, size, 16);
    return canvas;
  });

/** A wall of book spines - the single prop that says "study" fastest. */
export const books = () =>
  texture('books', () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(1895);
    fill(ctx, '#120d0a', size, size);
    const shelves = 6;
    const sh = size / shelves;
    const spines = ['#5a2a22', '#2a3a2a', '#3a2f4a', '#4a3a1a', '#2a2a35', '#5a4a2a'];
    for (let s = 0; s < shelves; s++) {
      let x = 4;
      while (x < size - 6) {
        const w = rng.range(9, 26);
        const h = sh * rng.range(0.72, 0.94);
        const col = new THREE.Color(rng.pick(spines)).multiplyScalar(rng.range(0.7, 1.25));
        ctx.fillStyle = `#${col.getHexString()}`;
        ctx.fillRect(x, s * sh + (sh - h) - 4, w, h);
        if (rng.chance(0.45)) {
          ctx.fillStyle = 'rgba(210,180,110,0.6)';
          ctx.fillRect(x + 2, s * sh + (sh - h) + h * 0.22, w - 4, 2);
        }
        x += w + rng.range(0.5, 2.5);
      }
      ctx.fillStyle = '#0b0806';
      ctx.fillRect(0, (s + 1) * sh - 6, size, 7);
    }
    soot(ctx, size, size, 0.55);
    return canvas;
  });

// ---------------------------------------------------------------- particles

/** Soft round sprite: dust motes, steam, smoke, bloom kernels. */
export const softDot = () =>
  texture('soft-dot', () => {
    const size = 128;
    const { canvas, ctx } = makeCanvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }, { srgb: false, repeat: [1, 1] });

/** Wispier, lumpier puff for steam and fog volumes. */
export const puff = () =>
  texture('puff', () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size);
    const rng = makeRng(77);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 22; i++) {
      const x = size / 2 + rng.range(-size * 0.2, size * 0.2);
      const y = size / 2 + rng.range(-size * 0.2, size * 0.2);
      const r = size * rng.range(0.1, 0.28);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${rng.range(0.06, 0.16)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }, { srgb: false, repeat: [1, 1] });

/** Rain streak (Task 3.3). */
export const rainStreak = () =>
  texture('rain-streak', () => {
    const { canvas, ctx } = makeCanvas(32, 128);
    ctx.clearRect(0, 0, 32, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    roundRect(ctx, 13, 0, 6, 128, 3);
    ctx.fill();
    return canvas;
  }, { srgb: false, repeat: [1, 1] });

/** Flame sprite for the fireplace (Task 3.2). */
export const flame = () =>
  texture('flame', () => {
    const size = 128;
    const { canvas, ctx } = makeCanvas(size);
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size * 0.72, 0, size / 2, size * 0.6, size * 0.5);
    g.addColorStop(0, 'rgba(255,246,214,1)');
    g.addColorStop(0.25, 'rgba(255,186,80,0.95)');
    g.addColorStop(0.6, 'rgba(226,88,28,0.5)');
    g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.06);
    ctx.bezierCurveTo(size * 0.9, size * 0.5, size * 0.78, size, size / 2, size);
    ctx.bezierCurveTo(size * 0.22, size, size * 0.1, size * 0.5, size / 2, size * 0.06);
    ctx.fill();
    return canvas;
  }, { srgb: false, repeat: [1, 1] });

// ---------------------------------------------------------------- pedestrians

/**
 * Pedestrian walk-cycle atlas (Tasks 2.1-2.3).
 *
 * DEVIATION FROM THE PLAN: the plan uses Mixamo rigged GLBs with skinned
 * instancing. No riggable characters ship in this repo, and the risk register
 * already names the fallback: "fewer pedestrians -> static silhouettes". This
 * goes one rung better than the fallback - an 8-frame walk cycle drawn as
 * silhouettes into a 4x2 atlas, played back per instance via UV offset. One
 * draw call for the whole crowd, and in fog a silhouette in a top hat with an
 * umbrella is more period-correct than a stock Mixamo businessman anyway.
 */
export const pedestrianAtlas = (style = 'victorian') =>
  texture(`ped-atlas-${style}`, () => {
    const cell = 128;
    const cols = 4;
    const rows = 2;
    const { canvas, ctx } = makeCanvas(cell * cols, cell * rows);
    const frames = cols * rows;
    const rng = makeRng(style === 'victorian' ? 1888 : 1977);

    for (let f = 0; f < frames; f++) {
      const ox = (f % cols) * cell;
      const oy = Math.floor(f / cols) * cell;
      const phase = (f / frames) * Math.PI * 2;
      ctx.save();
      ctx.translate(ox, oy);
      drawWalker(ctx, cell, phase, style, rng);
      ctx.restore();
    }
    return canvas;
  }, { srgb: true, repeat: [1, 1] });

function drawWalker(ctx, cell, phase, style, rng) {
  const cx = cell / 2;
  const groundY = cell * 0.96;
  const height = cell * 0.86;
  const hip = groundY - height * 0.48;
  const shoulder = groundY - height * 0.78;
  const swing = Math.sin(phase);
  const swing2 = Math.sin(phase + Math.PI);
  const bob = Math.abs(Math.cos(phase)) * cell * 0.012;

  ctx.strokeStyle = style === 'victorian' ? '#0b0a0c' : '#0a0b10';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round';

  const limb = (x0, y0, x1, y1, w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  // Legs: hip -> knee -> foot, so the silhouette actually strides.
  const legLen = height * 0.46;
  [swing, swing2].forEach((s) => {
    const kneeX = cx + s * legLen * 0.34;
    const kneeY = hip - bob + legLen * 0.5;
    const footX = cx + s * legLen * 0.62;
    limb(cx, hip - bob, kneeX, kneeY, cell * 0.058);
    limb(kneeX, kneeY, footX, groundY - Math.max(0, s) * cell * 0.03, cell * 0.05);
  });

  // Coat: a Victorian frock coat flares; a modern coat hangs straight.
  ctx.beginPath();
  const coatBottom = style === 'victorian' ? hip + height * 0.14 : hip + height * 0.02;
  const flare = style === 'victorian' ? cell * 0.14 : cell * 0.09;
  ctx.moveTo(cx - cell * 0.085, shoulder - bob);
  ctx.lineTo(cx + cell * 0.085, shoulder - bob);
  ctx.lineTo(cx + flare, coatBottom - bob);
  ctx.lineTo(cx - flare, coatBottom - bob);
  ctx.closePath();
  ctx.fill();

  // Arms.
  const armLen = height * 0.36;
  [swing2, swing].forEach((s, i) => {
    const elbowX = cx + s * armLen * 0.3 + (i ? cell * 0.06 : -cell * 0.06);
    const elbowY = shoulder - bob + armLen * 0.5;
    limb(cx + (i ? cell * 0.07 : -cell * 0.07), shoulder - bob, elbowX, elbowY, cell * 0.045);
    limb(elbowX, elbowY, elbowX + s * armLen * 0.24, elbowY + armLen * 0.44, cell * 0.04);
  });

  // Head.
  const headR = cell * 0.062;
  const headY = shoulder - bob - headR * 1.5;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  if (style === 'victorian') {
    // Top hat or bonnet - the whole period read lives in this shape.
    if (rng.chance(0.55)) {
      ctx.fillRect(cx - headR * 2.1, headY - headR * 1.05, headR * 4.2, cell * 0.014);
      ctx.fillRect(cx - headR * 1.05, headY - headR * 3.5, headR * 2.1, headR * 2.6);
    } else {
      ctx.beginPath();
      ctx.arc(cx, headY - headR * 0.4, headR * 1.5, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    // Umbrella or cane.
    if (rng.chance(0.4)) {
      ctx.lineWidth = cell * 0.02;
      ctx.beginPath();
      ctx.moveTo(cx + cell * 0.16, shoulder + height * 0.1);
      ctx.lineTo(cx + cell * 0.2, groundY - cell * 0.02);
      ctx.stroke();
    }
  } else {
    // NYC: hood up, collar high, hands in pockets.
    ctx.beginPath();
    ctx.arc(cx, headY + headR * 0.2, headR * 1.55, Math.PI * 1.05, Math.PI * 2.05);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- signage

/** Neon sign (Task 5.4). Emissive text on transparent, bloom does the rest. */
export const neonSign = (label, { color = '#ff3d7f', script = false } = {}) =>
  texture(`neon-${label}-${color}`, () => {
    const w = 512;
    const h = 256;
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = label.length > 6 ? 84 : 118;
    ctx.font = `${script ? 'italic ' : ''}700 ${size}px ${script ? 'Georgia, serif' : 'Impact, Haettenschweiler, sans-serif'}`;

    // Neon = a wide soft halo under a hot thin core.
    ctx.shadowColor = color;
    ctx.shadowBlur = 46;
    ctx.strokeStyle = color;
    ctx.lineWidth = 12;
    ctx.strokeText(label, w / 2, h / 2);
    ctx.shadowBlur = 22;
    ctx.strokeText(label, w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff6ff';
    ctx.strokeText(label, w / 2, h / 2);
    return canvas;
  }, { srgb: true, repeat: [1, 1] });

/** Painted shop fascia for London (gold on black, like a real shopfront). */
export const shopSign = (label) =>
  texture(`shop-${label}`, () => {
    const w = 512;
    const h = 128;
    const { canvas, ctx } = makeCanvas(w, h);
    fill(ctx, '#14100c', w, h);
    ctx.strokeStyle = '#8a6a2a';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#c9a457';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 54px Georgia, serif';
    ctx.fillText(label.toUpperCase(), w / 2, h / 2 + 3);
    soot(ctx, w, h, 0.5);
    grain(ctx, w, h, 10);
    return canvas;
  }, { repeat: [1, 1] });

/** Door number plate (221B and friends). */
export const numberPlate = (text) =>
  texture(`plate-${text}`, () => {
    const { canvas, ctx } = makeCanvas(128, 128);
    fill(ctx, '#0e0d0c', 128, 128);
    ctx.fillStyle = '#d8c9a4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 68px Georgia, serif';
    ctx.fillText(text, 64, 68);
    soot(ctx, 128, 128, 0.4);
    return canvas;
  }, { repeat: [1, 1] });

// ---------------------------------------------------------------- sky

/**
 * Sky gradient strip sampled by the dome. One 2x256 texture, re-generated when
 * the day/night cycle crosses a keyframe (Task 3.4).
 */
export function skyGradient(stops) {
  const { canvas, ctx } = makeCanvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([offset, color]) => g.addColorStop(offset, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Faint star field for the NYC and London night skies. */
export const stars = () =>
  texture('stars', () => {
    const size = 1024;
    const { canvas, ctx } = makeCanvas(size, size / 2);
    fill(ctx, '#000000', size, size / 2);
    const rng = makeRng(2718);
    for (let i = 0; i < 900; i++) {
      const x = rng() * size;
      const y = rng() * (size / 2) * 0.7;
      const b = rng() ** 3;
      ctx.fillStyle = `rgba(255,${240 + rng() * 15 | 0},${220 + rng() * 35 | 0},${b})`;
      ctx.fillRect(x, y, 1 + (b > 0.7 ? 1 : 0), 1 + (b > 0.7 ? 1 : 0));
    }
    return canvas;
  }, { repeat: [1, 1] });
