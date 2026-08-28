#!/usr/bin/env node
/**
 * Build-time half of §3.4. The runtime HUD polices draw calls, triangles,
 * interiors, videos and lights; this polices the things you can only see from
 * outside the browser:
 *
 *   - the initial payload (everything the browser must fetch before it can
 *     render frame one) against the 8MB budget
 *   - per-interior asset weight, so a 40MB .glb cannot be dropped in unnoticed
 *   - splat files against the 15MB-per-room target from the capture guide
 *
 * Exits non-zero on a breach, so it works as a CI gate.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const BUDGETS = {
  initialPayload: 8 * 1024 * 1024,
  perInterior: 15 * 1024 * 1024,
  perVideo: 12 * 1024 * 1024,
};

const fmt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} kB`);
const failures = [];
const notes = [];

// ---------------------------------------------------------- initial payload
if (!existsSync(dist)) {
  console.error('No dist/ - run `npm run build` first.');
  process.exit(2);
}

const html = await readFile(join(dist, 'index.html'), 'utf8');
// Everything the entry HTML pulls eagerly: the module, its modulepreloads, CSS.
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((href) => href.startsWith('/') && /\.(js|css)$/.test(href));

let payload = Buffer.byteLength(html);
const rows = [['index.html', Buffer.byteLength(html)]];
for (const ref of refs) {
  const file = join(dist, ref.replace(/^\//, ''));
  if (!existsSync(file)) continue;
  const size = (await stat(file)).size;
  payload += size;
  rows.push([ref, size]);
}

console.log('Initial payload (before first render)');
for (const [name, size] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fmt(size).padStart(10)}  ${name}`);
}
console.log(`  ${'-'.repeat(10)}`);
console.log(`  ${fmt(payload).padStart(10)}  TOTAL  (budget ${fmt(BUDGETS.initialPayload)})`);

if (payload > BUDGETS.initialPayload) {
  failures.push(`initial payload ${fmt(payload)} exceeds ${fmt(BUDGETS.initialPayload)}`);
} else {
  notes.push(`initial payload at ${((payload / BUDGETS.initialPayload) * 100).toFixed(0)}% of budget`);
}

// Chunks that are NOT in the initial payload are fine however big - they are
// lazily imported. Report them so their laziness stays deliberate.
const assets = existsSync(join(dist, 'assets')) ? await readdir(join(dist, 'assets')) : [];
const lazy = [];
for (const name of assets) {
  const href = `/assets/${name}`;
  if (rows.some(([r]) => r === href)) continue;
  const size = (await stat(join(dist, 'assets', name))).size;
  if (size > 256 * 1024) lazy.push([name, size]);
}
if (lazy.length) {
  console.log('\nLazy chunks and assets (fetched on demand, not on load)');
  for (const [name, size] of lazy.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fmt(size).padStart(10)}  ${name}`);
  }
}

// ------------------------------------------------------------ district assets
const districtsDir = join(root, 'public', 'districts');
if (existsSync(districtsDir)) {
  const found = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const ext = extname(entry.name).toLowerCase();
        if (['.glb', '.gltf', '.spz', '.ply', '.splat', '.mp4', '.webm', '.jpg', '.png', '.mp3', '.ogg'].includes(ext)) {
          found.push([relative(root, full), (await stat(full)).size, ext]);
        }
      }
    }
  };
  await walk(districtsDir);

  if (found.length) {
    console.log('\nDistrict assets');
    for (const [name, size, ext] of found.sort((a, b) => b[1] - a[1])) {
      const limit = ['.mp4', '.webm'].includes(ext) ? BUDGETS.perVideo : BUDGETS.perInterior;
      const over = size > limit;
      console.log(`  ${fmt(size).padStart(10)}  ${name}${over ? '   <-- OVER BUDGET' : ''}`);
      if (over) failures.push(`${name} is ${fmt(size)}, over the ${fmt(limit)} per-room budget`);
    }
  } else {
    console.log('\nDistrict assets: none present - every interior is running on the');
    console.log('procedural / baked-cubemap rungs of the fallback ladder.');
  }
}

// ---------------------------------------------------------------- verdict
console.log('');
for (const note of notes) console.log(`ok    ${note}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);
if (failures.length) process.exit(1);
console.log('ok    all build-time budgets met');
