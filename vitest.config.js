import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['tests/live/**', 'node_modules/**'],
    setupFiles: ['./tests/setup.js'],
  },
});
