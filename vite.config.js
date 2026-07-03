import { defineConfig } from 'vite';

// Two modes:
//   `vite` / `vite build` with no lib env → serves/builds the demo (index.html).
//   `vite build --mode lib` → builds the distributable component library.
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      build: {
        lib: {
          entry: 'src/roll-dice.js',
          name: 'RollDice',
          fileName: 'roll-dice',
          formats: ['es', 'umd'],
        },
        outDir: 'dist',
        emptyOutDir: true,
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
