// Generates dist/package.json so the package can be published from dist/,
// making dist the package root: src/core/foo.ts is importable as @truefoundry/utils/core/foo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(pkgRoot, 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'));

// dist/ becomes the package root, so ./dist/foo.js is published as ./foo.js.
function stripDistPrefix(value) {
  if (typeof value === 'string') return value.replace(/^\.\/dist\//, './');
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripDistPrefix(entry)]));
  }
  return value;
}

const distPkg = {
  ...pkg,
  main: stripDistPrefix(pkg.main),
  module: stripDistPrefix(pkg.module),
  types: stripDistPrefix(pkg.types),
  exports: stripDistPrefix(pkg.exports),
  files: ['**/*'],
};
delete distPkg.scripts;
delete distPkg.devDependencies;

// Interim stance: the npm page must stay blank, so no README may ship.
const readmes = fs.readdirSync(distDir).filter(name => /^readme(\.(md|txt|markdown))?$/i.test(name));
if (readmes.length > 0) {
  console.error(`Refusing to stage dist: remove ${readmes.join(', ')} so the npm page has no README`);
  process.exit(1);
}

fs.writeFileSync(path.join(distDir, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);
console.log('Wrote dist/package.json');
