/**
 * tsup build configuration for @truefoundry/trueforge-ui.
 *
 * Produces an ESM-only bundle at `dist/index.js` (+ `.d.ts` + sourcemap).
 * CSS must be built first (`dist/styles.css`) so `embedCssPlugin` can inline it.
 */
import svgr from 'esbuild-plugin-svgr';
import { defineConfig } from 'tsup';

import { embedCssPlugin } from './embedCssPlugin.mjs';

export default defineConfig({
  entry: ['src/index.ts', 'src/assistant-ui.ts', 'src/plugins/trueforge-agent-server-adapter/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // `package.json` `build` clears dist then writes styles.css before tsup; do not
  // wipe that stylesheet here. Watch mode also keeps dist/styles.css from the CSS watcher.
  clean: false,
  target: 'es2022',
  esbuildPlugins: [
    embedCssPlugin(),
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
    'react-router',
    'react-router-dom',
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
    '@truefoundry/trueforge-sdk',
  ],
});
