import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      // The entry point for the library.
      entry: resolve(__dirname, 'src/index.ts'),
      // Global variable name exposed in the UMD/IIFE build.
      name: 'FocusTrap',
      // Output file name per format.
      fileName: (format) =>
        format === 'es' ? 'focus-trap.js' : `focus-trap.${format}`,
      formats: ['es', 'cjs'],
    },
    // Empty the output directory before each build.
    emptyOutDir: true,
    sourcemap: true,
    // Emit readable output; the consumer's bundler minifies.
    minify: false,
  },
  plugins: [
    dts({
      // Bundle all declarations into a single index.d.ts.
      rollupTypes: true,
      include: ['src'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
});
