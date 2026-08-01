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
    outDir: path.resolve(__dirname, 'public/js'),
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
