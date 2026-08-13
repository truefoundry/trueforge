// tsup emits the CJS build as .js (and ESM as .mjs). Node determines a .js
// file's module format from the nearest package.json's "type" field, and the
// workspace package.json is "type": "module" (needed so exports.development
// can load src/ without a build) — so without this override, every dist/*.js
// file would be misread as an ES module and break require(). .mjs files are
// unaffected: Node always treats them as ESM regardless of "type".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(pkgRoot, 'dist');

fs.writeFileSync(path.join(distDir, 'package.json'), '{\n  "type": "commonjs"\n}\n');
console.log('Wrote dist/package.json ({ "type": "commonjs" })');
