#!/usr/bin/env node
/**
 * `npm run artifact`
 *
 * Assembles the whole city into ONE self-contained .html file you can open,
 * mail, or publish anywhere - no server, no module resolution, no asset
 * fetches. Everything the city needs is generated at runtime, so "everything"
 * here really is just the JavaScript and the stylesheet.
 *
 * Output: city-playable.html
 */
import { execSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'city-playable.html');

console.log('Building single-file city…');
execSync('npx vite build', {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, ARTIFACT: '1' },
});

const dist = join(root, 'dist-artifact');
// entryFileNames/assetFileNames have no directory prefix in this build, so the
// two files land at the root of dist-artifact rather than under assets/.
const js = await readFile(join(dist, 'city.js'), 'utf8');
const css = await readFile(join(dist, 'city.css'), 'utf8');
const indexHtml = await readFile(join(root, 'index.html'), 'utf8');

/**
 * Take the markup from index.html rather than duplicating it here, so the two
 * builds can never drift apart. Strip the wrapper tags the artifact host
 * supplies, and the module script tag the bundle replaces.
 */
const body = indexHtml
  .replace(/[\s\S]*<body[^>]*>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script[^>]*type="module"[^>]*><\/script>/g, '')
  .trim();

// The bundle expects to be a module (it uses import.meta in places three does);
// an IIFE build does not, so it goes in a plain script and runs immediately.
const html = `<title>The I'm Possible City</title>
<style>
${css}
</style>

${body}

<script>
${js}
</script>
`;

await writeFile(out, html, 'utf8');
const size = (await stat(out)).size;
console.log(`\nWrote ${out} (${(size / 1048576).toFixed(2)} MB)`);
console.log('Open it directly in a browser, or publish it. No server needed.');
