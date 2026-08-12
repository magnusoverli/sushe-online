import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  base: '/js/',
  resolve: {
    alias: {
      '@utils': path.resolve(rootDir, 'utils'),
    },
  },
  build: {
    rolldownOptions: {
      input: path.resolve(rootDir, 'src/js/main.js'),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
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
    outDir: path.resolve(rootDir, 'public/js'),
    emptyOutDir: true,
    manifest: true,
    // The emoji-data chunk is a lazily imported data blob (~619 kB raw,
    // ~103 kB gzipped) that grows with each Emoji release, so it does not
    // affect initial page load. Headroom above it keeps the warning
    // meaningful for chunks that do.
    chunkSizeWarningLimit: 700,
    sourcemap: false,
    target: 'es2020', // Modern browsers, smaller output
    cssCodeSplit: true,
    assetsInlineLimit: 4096, // Inline small assets as base64
  },
});
