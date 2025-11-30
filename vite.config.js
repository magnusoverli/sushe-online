import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: false,
  base: '/js/',
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/js/main.js'),
      output: {
        entryFileNames: 'bundle.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('music-services')) {
            return 'music-services';
          }
          if (id.includes('import-export')) {
            return 'import-export';
          }
          if (id.includes('musicbrainz')) {
            return 'album-editing';
          }
          if (id.includes('sortablejs')) {
            return 'vendor-sortable';
          }
        },
      },
    },
    outDir: path.resolve(__dirname, 'public/js'),
    emptyOutDir: false,
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020', // Modern browsers, smaller output
    cssCodeSplit: true,
    assetsInlineLimit: 4096, // Inline small assets as base64
  },
});
