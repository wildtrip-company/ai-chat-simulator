import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [svelte()],
  build: {
    // Queda al lado del JS compilado, que es donde `static.ts` lo busca.
    outDir: '../dist/ui',
    emptyOutDir: true,
    // Un dev tool que se abre en localhost no necesita sourcemaps del panel;
    // sacarlos mantiene el paquete publicado liviano.
    sourcemap: false,
  },
  server: {
    // `pnpm dev:ui` levanta Vite con HMR y manda las llamadas al simulador real.
    proxy: {
      '/_sim': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
