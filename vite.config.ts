/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  /* Relative asset paths. Azure Static Web Apps serves from root so './'
     is not strictly required, but it means the built `dist/` also works
     when opened directly or from a subpath preview environment. */
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    /* Fail loudly rather than silently picking port 5174. The screenshot
       harness hardcodes 5173; a silent port shift would make it appear
       that the scene broke when in fact nothing was listening. */
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    /* Keep sourcemaps until the project is stable. three.js bugs that only
       appear in the production build (usually tree-shaking related) are
       near-undebuggable without them. */
    sourcemap: true,
    /* Warn early if the bundle starts growing. three.js alone is ~150kB
       gzipped; anything much past 600kB raw means something unexpected
       got pulled in. */
    chunkSizeWarningLimit: 600,
  },

  /* Vitest configuration lives here so there is one config file, not two.
     Tests are colocated with source as *.test.ts. */
  test: {
    /* 'node' not 'jsdom': Phase 1 battle logic is pure math with no DOM.
       When Phase 2 adds DOM-dependent tests, switch to 'jsdom' and add
       jsdom to devDependencies. */
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /* e2e/ is Playwright's territory; Vitest must not try to run it. */
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
