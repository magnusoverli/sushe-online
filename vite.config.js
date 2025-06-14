import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'public/assets',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/js/main.js')
      },
      output: {
        entryFileNames: 'main.js',
        assetFileNames: '[name][extname]'
      }
    }
  }
});
