/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages and inside a Dojo iframe.
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // elk.js alone is ~1.4 MB and only loads lazily with the debrief; the initial bundle is ~290 kB gzipped.
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 5317 },
  preview: { port: 5318 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
