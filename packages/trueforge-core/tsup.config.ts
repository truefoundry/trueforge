import { esbuildPluginFilePathExtensions } from 'esbuild-plugin-file-path-extensions';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

// every src module compiles to its own .js (CJS) + .mjs (ESM) pair so consumers can deep-import real file paths.
export default defineConfig({
  entry: ['src/**/*.ts'],
  format: ['esm', 'cjs'],
  // The plugin externalizes relative imports and rewrites extensionless
  // specifiers per format ('./foo' -> './foo.mjs' / './foo.js'). It requires
  // bundle mode, but with every file as an entry nothing actually inlines.
  bundle: true,
  esbuildPlugins: [
    // file-path-extensions treats .json as extensionless and would emit
    // `./sandboxImage.json.mjs` (broken); resolve to an absolute path first so esbuild inlines it.
    {
      name: 'bundle-sandbox-image-json',
      setup(build) {
        build.onResolve({ filter: /^\.\/sandboxImage\.json$/ }, args => ({
          path: join(args.resolveDir, args.path),
        }));
      },
    },
    esbuildPluginFilePathExtensions({ esmExtension: 'mjs', cjsExtension: 'js' }),
  ],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.js' : '.mjs' };
  },
  dts: false,
  splitting: false,
  // TODO(oss): revisit sourcemaps at the public release — with sourcesContent
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
  skipNodeModulesBundle: true,
});
