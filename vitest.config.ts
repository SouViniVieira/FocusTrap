import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The focus trap manipulates the DOM, so we need a browser-like env.
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
});
