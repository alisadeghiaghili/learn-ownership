import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'build',
    assetsDir: 'assets',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
