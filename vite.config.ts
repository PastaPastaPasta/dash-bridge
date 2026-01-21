import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    target: 'es2020',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
    },
    include: [
      '@dashevo/dapi-client',
      '@dashevo/dashcore-lib',
    ],
  },
  define: {
    // Polyfill for process.env in browser
    'process.env': {},
  },
});
