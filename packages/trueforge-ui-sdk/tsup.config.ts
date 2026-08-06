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
  clean: true,
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
    'react-syntax-highlighter/dist/esm/styles/prism',
    'monaco-editor',
  ],
});
