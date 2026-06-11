import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: false,
  base: '/js/',
  resolve: {
    alias: {
      '@utils': path.resolve(__dirname, 'utils'),
    },
  },
  build: {
    rolldownOptions: {
      input: path.resolve(__dirname, 'src/js/main.js'),
      output: {
        // The entry keeps a stable, un-hashed name because chunks statically
        // import it by this exact URL. It must therefore be referenced from
        // HTML with the same bare URL (no ?v= query) — otherwise the browser
        // creates a second module instance — and is served with
        // Cache-Control: no-cache (see index.js) so it stays fresh.
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('music-services')) {
            return 'music-services';
          }
          if (id.includes('import-export')) {
            return 'import-export';
          }
        },
      },
    },
    outDir: path.resolve(__dirname, 'public/js'),
    emptyOutDir: false,
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    target: 'es2020', // Modern browsers, smaller output
    cssCodeSplit: true,
    assetsInlineLimit: 4096, // Inline small assets as base64
  },
});
