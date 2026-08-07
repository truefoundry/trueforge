/**
 * tsup build configuration for @truefoundry/trueforge-ui.
 *
 * Produces an ESM-only bundle at `dist/index.js` (+ `.d.ts` + sourcemap).
 */
import svgr from 'esbuild-plugin-svgr';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/assistant-ui.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Watch mode must not wipe dist/styles.css (built by a sibling tailwind watcher).
  clean: !process.argv.includes('--watch'),
  target: 'es2022',
  esbuildPlugins: [
    svgr({
      icon: true,
      replaceAttrValues: {
        '#000': 'currentColor',
        '#000000': 'currentColor',
      },
    }),
  ],
  noExternal: ['react-syntax-highlighter/dist/esm/styles/prism'],
  external: [
    'react',
    'react-dom',
    '@assistant-ui/react',
    '@assistant-ui/core',
    '@openuidev/react-headless',
    '@openuidev/react-lang',
    '@openuidev/react-ui',
    '@openuidev/react-ui/genui-lib',
    '@truefoundry/assistant-ui-runtime',
    'lucide-react',
    'react-markdown',
    'remark-gfm',
    'react-syntax-highlighter',
    'monaco-editor',
  ],
});
