import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const stylesPath = path.join(packageRoot, 'dist', 'styles.css');
const embeddedStylesFile = path.join(packageRoot, 'src', 'theme', 'embeddedStyles.ts');

/** esbuild/tsup plugin: replace `embeddedStyles.ts` with minified `dist/styles.css`. */
export function embedCssPlugin() {
  return {
    name: 'trueforge-ui-embed-css',
    setup(build) {
      build.onLoad({ filter: /[/\\]embeddedStyles\.ts$/ }, args => {
        if (path.resolve(args.path) !== embeddedStylesFile) {
          return null;
        }
        const css = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
        return {
          contents: `export const EMBEDDED_STYLES = ${JSON.stringify(css)};\n`,
          loader: 'ts',
        };
      });
    },
  };
}
