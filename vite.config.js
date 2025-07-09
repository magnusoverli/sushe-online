import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/js/main.js'),
      output: {
        entryFileNames: 'bundle.js',
      },
    },
    outDir: path.resolve(__dirname, 'public/js'),
    emptyOutDir: false,
  },
});
