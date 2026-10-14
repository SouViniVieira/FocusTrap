import { defineConfig } from 'vite';

// Builds the interactive demo (index.html) as a static site for GitHub Pages.
export default defineConfig({
  base: '/FocusTrap/',
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
  },
});
