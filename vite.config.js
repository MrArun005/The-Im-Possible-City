import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/gsap')) return 'gsap';
        },
      },
    },
  },
});
