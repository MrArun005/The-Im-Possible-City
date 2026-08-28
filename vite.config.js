import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Two builds from one source.
 *
 *  default        - normal multi-chunk build for hosting. `three` and `gsap` are
 *                   split out so they cache separately, and the splat renderer
 *                   stays a lazy chunk that a city with no splat doors never
 *                   fetches.
 *
 *  ARTIFACT=1     - ONE self-contained .html file with the whole city inside it:
 *                   single IIFE, no dynamic imports, CSS inlined, splat renderer
 *                   stubbed out. See scripts/build-artifact.mjs, which assembles
 *                   the file this build produces.
 */
const artifact = !!process.env.ARTIFACT;

export default defineConfig({
  base: artifact ? './' : '/',
  server: { host: true, port: 5173 },
  resolve: artifact
    ? {
        alias: {
          '@sparkjsdev/spark': fileURLToPath(new URL('./scripts/spark-stub.js', import.meta.url)),
        },
      }
    : {},
  build: {
    target: 'es2020',
    outDir: artifact ? 'dist-artifact' : 'dist',
    cssCodeSplit: !artifact,
    // Everything inline in the artifact build; the textures are generated at
    // runtime anyway, so there is very little to inline beyond the CSS.
    assetsInlineLimit: artifact ? 100_000_000 : 2048,
    rollupOptions: {
      output: artifact
        ? {
            format: 'iife',
            inlineDynamicImports: true,
            entryFileNames: 'city.js',
            assetFileNames: 'city[extname]',
          }
        : {
            manualChunks(id) {
              if (id.includes('node_modules/three')) return 'three';
              if (id.includes('node_modules/gsap')) return 'gsap';
            },
          },
    },
  },
});
