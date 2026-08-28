#!/usr/bin/env node
/**
 * Stages the DRACO and KTX2/Basis decoders from node_modules into public/vendor
 * so the app can run entirely self-hosted.
 *
 * By default gltf.js loads the DRACO decoder from gstatic (as the
 * implementation instructions specify). Add `?decoders=local` to use these
 * copies instead - which is what you want on an air-gapped network, or if you
 * would rather not depend on a third-party CDN staying up.
 *
 * Nothing here is committed: public/vendor is gitignored and regenerated.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libs = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');

const jobs = [
  { from: join(libs, 'draco'), to: join(root, 'public', 'vendor', 'draco') },
  { from: join(libs, 'basis'), to: join(root, 'public', 'vendor', 'basis') },
];

let copied = 0;
for (const job of jobs) {
  if (!existsSync(job.from)) {
    console.warn(`[decoders] skipped, not found: ${job.from}`);
    continue;
  }
  await mkdir(job.to, { recursive: true });
  await cp(job.from, job.to, { recursive: true });
  const files = await readdir(job.to);
  copied += files.length;
  console.log(`[decoders] ${job.from} -> ${job.to} (${files.length} files)`);
}
console.log(`[decoders] ${copied} files staged under public/vendor`);
