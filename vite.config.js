import { defineConfig } from 'vite';

// Two modes:
//   `vite` / `vite build` with no lib env → serves/builds the demo (index.html).
//   `vite build --mode lib` → builds the distributable component library:
//     both entries in one pass, ES-only. No UMD — battle-mat must code-split
//     (the map implementation loads via dynamic import only when opened) and
//     UMD bundles cannot code-split.
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      build: {
        lib: {
          entry: {
            'roll-dice': 'src/roll-dice.js',
            'battle-mat': 'src/battle-mat.js',
            'initiative-tracker': 'src/initiative-tracker.js',
            'add-to-battle': 'src/add-to-battle.js',
          },
          formats: ['es'],
        },
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
          output: { chunkFileNames: 'battle-mat-[name]-[hash].js' },
        },
      },
    };
  }
  // Demo site build/dev. Relative base so the built demo works when served
  // from a GitHub Pages subpath (e.g. user.github.io/dice-roller/).
  return {
    base: './',
    build: { outDir: 'dist-demo' },
  };
});
