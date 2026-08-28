#!/usr/bin/env node
/**
 * `npm run render`
 *
 * Builds the city, drives it in a real browser, captures a fixed list of
 * checkpoint frames, and writes a self-contained HTML proof sheet with the
 * frames embedded and the measured budget numbers beside them.
 *
 * The point is that "did the render work" stops being a question you answer by
 * squinting at terminal output. Every frame in SHOTS has a `look` note saying
 * what it is there to prove, so a regression has somewhere obvious to show up.
 *
 * Output: render-report.html (gitignored - it is a build artifact)
 *
 * First run needs a browser:  npx playwright install chromium
 * Set CHROMIUM_PATH to use one you already have.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const OUT = join(root, 'render-report.html');

// ---------------------------------------------------------------- the frames
//
// Each entry is a checkpoint. `look` is the whole value of this file: it says
// what the frame exists to prove, so a broken render has somewhere to show up.

const SHOTS = [
  {
    id: 'street', district: 'london', title: 'The high street',
    look: 'Gaslights receding into fog, lit sash windows, cobbles at cobble scale. If this reads flat or black, the sky environment map or the light azimuth has regressed.',
    pose: [-30, 1.6, -Math.PI / 2],
  },
  {
    id: 'facade-shut', district: 'london', title: '221B, shut',
    look: 'Nothing leaks. The doorway is opaque because the closed panel fails the stencil depth test - that is the mechanism, not a tween.',
    pose: [-36, -4.6, 0],
  },
  {
    id: 'door-open', district: 'london', title: '221B, open',
    look: 'THE shot. Wallpaper, bookshelf, rug, dust in the lamplight - masked exactly to the opening, with the panel swung out catching light.',
    pose: [-36, -5.0, 0, -0.02], open: 'baker-street-221b',
  },
  {
    id: 'parlour', district: 'london', title: 'The parlour',
    look: 'The ajar door, with the muffled piano emitter behind it. Damask wallpaper and a framed painting should be legible through the gap.',
    pose: [-12, -5.2, 0], open: 'parlour-door',
  },
  {
    id: 'pawnshop', district: 'london', title: 'The pawnbroker',
    look: 'The baked-cubemap rung: one draw call, no lights, real parallax. Softest interior in the city by design - it should still read as a room, not a smear.',
    pose: [12, -5.4, 0], open: 'pawnbroker-door',
  },
  {
    id: 'day', district: 'london', title: 'Noon',
    look: 'Same street, sun overhead. Proves the day/night keyframes and that the sky dome is not being sliced by the far plane.',
    pose: [-30, 1.6, -Math.PI / 2], hour: 13,
  },
  {
    id: 'rain', district: 'london', title: 'Rain',
    look: 'Wetness uniform at full: roughness drops, albedo darkens, GPU streaks, lamp pools brighter off the wet road. No texture swap, no hitch.',
    pose: [-30, 1.6, -Math.PI / 2], hour: 22, rain: 1,
  },
  {
    id: 'portal', district: 'london', title: 'London to New York',
    look: 'Through a London door: a lit tower face against a deep blue night. The throat is four slabs, not a box - a box has a far face exactly where New York goes.',
    pose: [12, 5.4, Math.PI], open: 'the-crossing', rain: 0.3,
  },
  {
    id: 'avenue', district: 'nyc', title: 'The avenue',
    look: 'Cabs, traffic phase, neon readable rather than bloomed to white, fire escapes, wet asphalt reflecting the signs.',
    pose: [-30, 1.6, -Math.PI / 2],
  },
  {
    id: 'skyline', district: 'nyc', title: 'The skyline',
    look: 'Ninety-two towers, every window individually lit, all of it in one draw call via per-instance UV offsets into one atlas.',
    pose: [0, 22, 0, 0.18],
  },
  {
    id: 'frontage', district: 'nyc', title: 'The brownstone',
    look: 'Stoop, street number, frontage glazing in three lit bays. A single unlit 4m pane here used to read as a hole cut in the wall.',
    pose: [-36, -4.6, 0],
  },
  {
    id: 'diner', district: 'nyc', title: 'The diner',
    look: 'DINER neon at close range - the test is whether you can still read the word. Interior is the cubemap rung again, graded cool against the warm street.',
    pose: [12, -5.4, 0], open: 'diner-door',
  },
  {
    id: 'portal-back', district: 'nyc', title: 'New York to London',
    look: 'The return trip: gaslit brick in a warm brown night, framed by blue neon. Both directions of the portal are the same component.',
    pose: [-12, 5.6, Math.PI], open: 'the-crossing-back',
  },
  {
    id: 'loading', district: 'chrome', title: 'The loader',
    look: 'The animated foggy illustration, framed to match the intro dolly so the layer fading out does not jump the composition.',
    stage: 'loading',
  },
  {
    id: 'intro-low', district: 'chrome', title: 'Intro dolly, low tier',
    look: 'The rail hand-off at the lowest quality tier: no bloom, no grain, fewer pedestrians, flat interior materials. It has to stay legible here.',
    stage: 'intro', tier: 'low',
  },
];

/** Edit these as things land. They print at the top of the report. */
const NOTES = {
  headline: 'Both districts walkable, all six interior strategies live, portal working both ways.',
  open: [
    'Baked cubemap rooms are the softest thing in the city. A bake comes back flatter than the room was; the shader grades contrast back, but a proper second bake pass would beat a grade.',
    'No real-device mobile pass. Touch controls, quality tiers and the 30fps floor are implemented and untested on hardware.',
    'Near-foreground wet asphalt reads heavy. Physically right at that grazing angle, arguably too dark.',
  ],
};

const BUDGETS = { drawCalls: 150, triangles: 300_000, interiors: 3, videos: 1, lights: 3 };

// ------------------------------------------------------------- static server
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, 'http://x');
      let path = join(dir, normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, ''));
      try {
        if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
        const body = await readFile(path);
        res.writeHead(200, {
          'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        }).end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// -------------------------------------------------------------------- capture
const WIDTH = 1120;
const HEIGHT = 630;
const QUALITY = 62;

async function capture() {
  const { server, port } = await serve(dist);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.RENDER_GPU
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [
          // Software GL by default: this has to run on a machine with no GPU
          // (CI, a container) and still produce frames.
          '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
          '--no-sandbox', '--disable-dev-shm-usage',
        ],
  });

  const frames = [];
  const ladder = new Map();
  const warnings = new Set();
  // The readout reports the WORST case across every frame, not the last frame's
  // numbers. A budget you only met on the quietest shot is not a budget met.
  const peak = { drawCalls: 0, triangles: 0, interiors: 0, videos: 0, lights: 0, tier: null, worstFps: Infinity };
  let currentDistrict = null;
  let page = null;

  const openPage = async (district, tier = 'high', stage = 'walk') => {
    if (page) await page.close();
    page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    page.on('pageerror', (e) => warnings.add(`page error: ${e.message}`));
    page.on('console', (m) => {
      const text = m.text();
      // Keep the door id - it is the useful half. Keying by id also stops two
      // doors with the same ladder path from collapsing into one line.
      const hit = text.match(/\[interior:([^\]]+)\].*?"([^"]+)"\s*->\s*"([^"]+)".*?rung (\d+)/);
      if (hit) ladder.set(hit[1], { id: hit[1], from: hit[2], to: hit[3], rung: Number(hit[4]) });
      else if (m.type() === 'error' && !/404/.test(text)) warnings.add(text);
    });

    const query = new URLSearchParams({ tier, district });
    if (stage !== 'loading' && stage !== 'intro') query.set('intro', '0');
    await page.goto(`${base}/?${query}`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('#loader-enter:not([hidden])', { timeout: 180_000 });
    if (stage === 'loading') return;
    await page.click('#loader-enter');
    await page.waitForTimeout(stage === 'intro' ? 6500 : 3500);
    currentDistrict = `${district}:${tier}:${stage}`;
  };

  for (const shot of SHOTS) {
    const district = shot.district === 'chrome' ? 'london' : shot.district;
    const tier = shot.tier ?? 'high';
    const stage = shot.stage ?? 'walk';
    const key = `${district}:${tier}:${stage}`;
    if (key !== currentDistrict || stage !== 'walk') await openPage(district, tier, stage);
    if (stage === 'loading') currentDistrict = null;

    if (shot.hour != null) {
      await page.evaluate((h) => window.city.timeOfDay.setHour(h, true), shot.hour);
    }
    if (shot.rain != null) {
      await page.evaluate((r) => window.city.districts.current.weather.set(r), shot.rain);
    }
    if (shot.pose) {
      await page.evaluate(([x, z, yaw, pitch]) => {
        const p = window.city.player;
        p.enabled = true;
        p.teleport(x, z, yaw);
        p.pitch = pitch ?? 0;
        p.velocity.set(0, 0, 0);
      }, shot.pose);
      await page.waitForTimeout(1400);
    }
    if (shot.open) {
      // Stand at the door BEFORE opening it: streaming correctly shuts and
      // evicts a room left open behind you, so opening one from across the
      // district and then walking to it finds it closed again.
      await page.evaluate((id) => window.city.snapDoor(id, true), shot.open);
      await page.waitForTimeout(6500);
      await page.evaluate((id) => window.city.snapDoor(id, true), shot.open);
    }
    await page.waitForTimeout(shot.rain != null ? 3800 : 1800);

    const buffer = await page.screenshot({ type: 'jpeg', quality: QUALITY });
    const stats = stage === 'loading' ? null : await page.evaluate(() => {
      const c = window.city;
      const info = c.ctx.renderer.info;
      let lights = 0;
      c.ctx.scene.traverse((o) => { if (o.isLight && o.intensity > 0.001) lights++; });
      return {
        fps: c.statsHud.fps,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        textures: info.memory.textures,
        interiors: c.districts.current?.doors.loadedInteriorCount() ?? 0,
        lights,
        tier: c.quality.name,
      };
    });

    if (stats) {
      for (const key of ['drawCalls', 'triangles', 'interiors', 'videos', 'lights']) {
        peak[key] = Math.max(peak[key], stats[key] ?? 0);
      }
      if (stats.fps) peak.worstFps = Math.min(peak.worstFps, stats.fps);
      if (stats.tier === 'high' || !peak.tier) peak.tier = stats.tier;
    }
    frames.push({ ...shot, data: buffer.toString('base64'), stats });
    process.stdout.write(`  captured ${shot.id}\n`);
  }

  await browser.close();
  server.close();
  if (!Number.isFinite(peak.worstFps)) peak.worstFps = 0;
  return { frames, measured: peak, ladder: [...ladder.values()], warnings: [...warnings] };
}

// --------------------------------------------------------------------- report
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const git = (cmd, fallback = '—') => {
  try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
};

const fmt = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));

const DISTRICTS = {
  london: { label: 'Victorian London', hint: 'gaslight · fog after rain' },
  nyc: { label: 'New York Under Lights', hint: 'neon · wet asphalt · 2 a.m.' },
  chrome: { label: 'Loader & intro', hint: 'the first fifteen seconds' },
};

function budgetRows(m) {
  return [
    ['draw calls', m.drawCalls, BUDGETS.drawCalls, 'peak, whole frame including post'],
    ['triangles', m.triangles, BUDGETS.triangles, 'peak on screen'],
    ['rooms resident', m.interiors, BUDGETS.interiors, 'peak interiors loaded at once'],
    ['real-time lights', m.lights, BUDGETS.lights, 'peak; hemisphere + sun + one borrowed'],
  ].map(([label, value, limit, note]) => ({
    label, value, limit, note, over: value > limit,
  }));
}

function report({ frames, measured, ladder, warnings }) {
  const grouped = ['london', 'nyc', 'chrome']
    .map((key) => ({ key, ...DISTRICTS[key], frames: frames.filter((f) => f.district === key) }))
    .filter((g) => g.frames.length);

  const rows = budgetRows(measured);
  const breached = rows.filter((r) => r.over);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const frameCard = (f, index) => `
        <figure class="frame" id="frame-${esc(f.id)}">
          <div class="plate">
            <img src="data:image/jpeg;base64,${f.data}" alt="${esc(f.title)}" loading="lazy" width="${WIDTH}" height="${HEIGHT}" />
          </div>
          <figcaption class="slate">
            <p class="slate-head">
              <span class="slate-num">${String(index).padStart(2, '0')}</span>
              <span class="slate-title">${esc(f.title)}</span>
            </p>
            <p class="slate-look">${esc(f.look)}</p>
            ${f.stats ? `<p class="slate-data">
              <span>${f.stats.drawCalls} calls</span>
              <span>${fmt(f.stats.triangles)} tris</span>
              <span>${f.stats.interiors} rooms</span>
              <span>${f.stats.lights} lights</span>
            </p>` : '<p class="slate-data"><span>no scene yet</span></p>'}
          </figcaption>
        </figure>`;

  let n = 0;

  return `<title>City Render Proof Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
<style>
  /* Dark-first on purpose: you judge night renders against a dark surround, and
     nearly every frame in here is a night frame. The neutral carries a slight
     blue bias so it does not tint the warm London plates. */
  :root {
    --ground: #14161a;
    --surface: #1a1d23;
    --surface-2: #20242b;
    --line: #2c313a;
    --line-soft: #23272e;
    --text: #e6e8ec;
    --text-dim: #9aa1ac;
    --text-faint: #6b7280;
    --gas: #e8a24c;
    --neon: #5aa8ff;
    --ok: #62bd88;
    --bad: #e2685f;
    --mat: #0d0f12;

    --step--1: 0.78rem;
    --step-0: 0.95rem;
    --step-1: 1.18rem;
    --step-2: 1.62rem;
    --step-3: 2.4rem;
    --step-4: clamp(2.6rem, 6vw, 4.2rem);

    --sans: 'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

    --gutter: clamp(1.25rem, 4vw, 3rem);
    --measure: 62ch;
  }

  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --ground: #e8e7e4;
      --surface: #f4f3f1;
      --surface-2: #ece9e5;
      --line: #cdc9c3;
      --line-soft: #ddd9d3;
      --text: #1a1c20;
      --text-dim: #55595f;
      --text-faint: #83878d;
      --gas: #a86413;
      --neon: #1b62b8;
      --ok: #2f7a4c;
      --bad: #b23a31;
      --mat: #26282c;
    }
  }

  :root[data-theme="light"] {
    --ground: #e8e7e4;
    --surface: #f4f3f1;
    --surface-2: #ece9e5;
    --line: #cdc9c3;
    --line-soft: #ddd9d3;
    --text: #1a1c20;
    --text-dim: #55595f;
    --text-faint: #83878d;
    --gas: #a86413;
    --neon: #1b62b8;
    --ok: #2f7a4c;
    --bad: #b23a31;
    --mat: #26282c;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--text);
    font-family: var(--sans);
    font-size: var(--step-0);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 var(--gutter) 6rem; }

  /* ---------- masthead ---------- */
  .masthead {
    display: grid;
    gap: 1.75rem;
    padding: clamp(2.5rem, 7vw, 4.5rem) 0 2rem;
    border-bottom: 1px solid var(--line);
  }

  .eyebrow {
    margin: 0;
    font-family: var(--mono);
    font-size: var(--step--1);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  h1 {
    margin: 0;
    font-size: var(--step-4);
    font-weight: 700;
    line-height: 1.02;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  h1 em {
    font-style: normal;
    color: var(--gas);
  }

  .headline {
    margin: 0;
    max-width: var(--measure);
    font-size: var(--step-1);
    color: var(--text-dim);
    text-wrap: pretty;
  }

  .runbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.5rem;
    font-family: var(--mono);
    font-size: var(--step--1);
    color: var(--text-faint);
  }
  .runbar b { color: var(--text-dim); font-weight: 500; }

  /* ---------- readout ---------- */
  .readout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px;
    margin: 2.5rem 0 0;
    background: var(--line-soft);
    border: 1px solid var(--line-soft);
  }

  .cell {
    display: grid;
    gap: 0.3rem;
    padding: 1rem 1.1rem;
    background: var(--surface);
  }

  .cell-label {
    font-family: var(--mono);
    font-size: var(--step--1);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .cell-value {
    font-family: var(--mono);
    font-size: var(--step-2);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--ok);
  }
  .cell-value.is-over { color: var(--bad); }

  .cell-note {
    font-size: var(--step--1);
    color: var(--text-faint);
    line-height: 1.4;
  }
  .cell-note b { color: var(--text-dim); font-weight: 500; font-family: var(--mono); }

  /* ---------- ladder / notes ---------- */
  .strip {
    display: grid;
    gap: 2rem;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    padding: 2.5rem 0;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    margin: 0 0 0.9rem;
    font-size: var(--step-1);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .ladder {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.45rem;
    font-family: var(--mono);
    font-size: var(--step--1);
  }
  .ladder li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    color: var(--text-dim);
  }
  .ladder li::before {
    content: "→";
    color: var(--gas);
    flex: none;
  }
  .ladder b { color: var(--text); font-weight: 500; }
  .ladder span { color: var(--text-faint); }

  .open-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.8rem;
    max-width: var(--measure);
  }
  .open-list li {
    padding-left: 1.1rem;
    border-left: 2px solid var(--line);
    color: var(--text-dim);
    font-size: var(--step--1);
    line-height: 1.5;
  }

  .lead {
    margin: 0 0 1rem;
    max-width: var(--measure);
    font-size: var(--step--1);
    color: var(--text-faint);
  }

  /* ---------- sections ---------- */
  .district { padding: 3.5rem 0 0; }

  .district-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 1rem;
    padding-bottom: 1.25rem;
    border-bottom: 2px solid var(--rule, var(--line));
  }
  .district-head h2 { margin: 0; font-size: var(--step-3); letter-spacing: -0.025em; }
  .district-head .hint {
    font-family: var(--mono);
    font-size: var(--step--1);
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  #d-london { --rule: var(--gas); }
  #d-nyc { --rule: var(--neon); }
  #d-chrome { --rule: var(--line); }

  .sheet {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 2.5rem 2rem;
    padding: 2rem 0 0;
  }

  .frame { margin: 0; display: grid; gap: 0.85rem; }

  .plate {
    background: var(--mat);
    border: 1px solid var(--line-soft);
    overflow: hidden;
  }
  .plate img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }

  .slate { display: grid; gap: 0.5rem; }

  .slate-head {
    margin: 0;
    display: flex;
    gap: 0.7rem;
    align-items: baseline;
  }
  .slate-num {
    font-family: var(--mono);
    font-size: var(--step--1);
    color: var(--gas);
    font-variant-numeric: tabular-nums;
  }
  .slate-title {
    font-size: var(--step-1);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .slate-look {
    margin: 0;
    font-size: var(--step--1);
    line-height: 1.55;
    color: var(--text-dim);
    max-width: 52ch;
  }
  .slate-data {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    font-family: var(--mono);
    font-size: var(--step--1);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }

  footer {
    padding: 4rem 0 0;
    margin-top: 3.5rem;
    border-top: 1px solid var(--line);
    font-family: var(--mono);
    font-size: var(--step--1);
    color: var(--text-faint);
    display: grid;
    gap: 0.5rem;
  }
  footer code {
    color: var(--text-dim);
    background: var(--surface-2);
    padding: 0.15em 0.4em;
  }

  a { color: var(--gas); text-underline-offset: 0.2em; }
  a:focus-visible, button:focus-visible {
    outline: 2px solid var(--gas);
    outline-offset: 3px;
  }

  @media (max-width: 560px) {
    .sheet { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Render proof sheet — The I'm Possible City</p>
    <h1>Every frame, and <em>what it proves</em></h1>
    <p class="headline">${esc(NOTES.headline)}</p>
    <p class="runbar">
      <span>captured <b>${esc(stamp)}</b></span>
      <span>commit <b>${esc(git('git rev-parse --short HEAD'))}</b></span>
      <span>branch <b>${esc(git('git rev-parse --abbrev-ref HEAD'))}</b></span>
      <span>tier <b>${esc(measured.tier ?? '—')}</b></span>
      <span>renderer <b>${process.env.RENDER_GPU ? 'hardware' : 'software GL'}</b></span>
    </p>
  </header>

  <section class="readout" aria-label="Budget readout">
    ${rows.map((r) => `<div class="cell">
      <span class="cell-label">${esc(r.label)}</span>
      <span class="cell-value${r.over ? ' is-over' : ''}">${fmt(r.value)}</span>
      <span class="cell-note">budget <b>${fmt(r.limit)}</b> · ${esc(r.note)}</span>
    </div>`).join('\n    ')}
    <div class="cell">
      <span class="cell-label">frames</span>
      <span class="cell-value">${frames.length}</span>
      <span class="cell-note">${breached.length ? `<b>${breached.length}</b> budget breached` : 'all budgets held'}${
        measured.worstFps ? ` · worst <b>${measured.worstFps} fps</b> under software GL` : ''
      }</span>
    </div>
  </section>

  <section class="strip">
    <div>
      <h2>The fallback ladder, firing</h2>
      <p class="lead">This repo ships no <code>.glb</code>, <code>.spz</code> or <code>.mp4</code>, so every door that wants one drops a rung on load and says so. That is the philosophy executing, not a warning.</p>
      <ul class="ladder">
        ${ladder.length
          ? ladder.map((l) => `<li><b>${esc(l.id)}</b> wanted ${esc(l.from)}, using ${esc(l.to)} <span>rung ${l.rung}</span></li>`).join('\n        ')
          : '<li>no fallbacks fired — real assets are present on every rung</li>'}
      </ul>
    </div>
    <div>
      <h2>Still open</h2>
      <ul class="open-list">
        ${NOTES.open.map((o) => `<li>${esc(o)}</li>`).join('\n        ')}
      </ul>
    </div>
  </section>

  ${grouped.map((g) => `<section class="district" id="d-${esc(g.key)}">
    <div class="district-head">
      <h2>${esc(g.label)}</h2>
      <span class="hint">${esc(g.hint)}</span>
    </div>
    <div class="sheet">
      ${g.frames.map((f) => frameCard(f, ++n)).join('\n')}
    </div>
  </section>`).join('\n\n  ')}

  <footer>
    <p>Regenerate with <code>npm run render</code> — builds, drives a real browser, rewrites this page.</p>
    <p>Frames are JPEG q${QUALITY} at ${WIDTH}×${HEIGHT}, embedded. Shot list and notes live at the top of <code>scripts/render-report.mjs</code>.</p>
    ${warnings.length ? `<p>Console warnings this run: ${warnings.map((w) => esc(w)).join(' · ')}</p>` : '<p>No console errors this run.</p>'}
  </footer>
</div>
`;
}

// ----------------------------------------------------------------------- main
console.log('Capturing render proof sheet…');
const result = await capture();
await writeFile(OUT, report(result), 'utf8');
const size = (await stat(OUT)).size;
console.log(`\nWrote ${OUT} (${(size / 1048576).toFixed(2)} MB, ${result.frames.length} frames)`);
if (result.warnings.length) console.log(`Warnings: ${result.warnings.join(' | ')}`);
