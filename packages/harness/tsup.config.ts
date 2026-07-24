import { esbuildPluginFilePathExtensions } from 'esbuild-plugin-file-path-extensions';
import { defineConfig } from 'tsup';

// every src module compiles to its own .js (CJS) + .mjs (ESM) pair so consumers can deep-import real file paths.
export default defineConfig({
  entry: ['src/**/*.ts'],
  format: ['esm', 'cjs'],
  // The plugin externalizes relative imports and rewrites extensionless
  // specifiers per format ('./foo' -> './foo.mjs' / './foo.js'). It requires
  // bundle mode, but with every file as an entry nothing actually inlines.
  bundle: true,
  esbuildPlugins: [esbuildPluginFilePathExtensions({ esmExtension: 'mjs', cjsExtension: 'js' })],
  dts: false,
  splitting: false,
  // TODO(oss): revisit sourcemaps at the public release — with sourcesContent
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
  skipNodeModulesBundle: true,
});
