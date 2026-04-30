import { defineConfig } from 'vite';

export default defineConfig({
  base: "./",
  assetsInclude: ['**/*.mid'],
  server: {
    allowedHosts: true,
  },
  esbuild: {
    target: "es2022",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
});
