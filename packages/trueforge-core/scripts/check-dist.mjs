// Post-build smoke test: the exact regression class this guards against is
// dist/*.js being silently misinterpreted as ESM (see write-dist-package-json.mjs) —
// require()/import() failing here is how that would first surface.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const modulePaths = [
  'dist/index',
  'dist/core/index',
  'dist/agent-session/index',
  'dist/request-reply/index',
  // Deep paths: one class module, one dropped-from-the-barrel internals module.
  'dist/core/sandbox/Sandbox',
  'dist/core/runtime/contextUtils',
];

let failures = 0;

for (const modulePath of modulePaths) {
  const base = path.join(pkgRoot, modulePath);
  try {
    require(`${base}.js`);
    await import(pathToFileURL(`${base}.mjs`).href);
    if (!fs.existsSync(`${base}.d.ts`)) {
      throw new Error('missing .d.ts');
    }
    console.log(`ok ${modulePath}.{js,mjs,d.ts}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const distPkgPath = path.join(pkgRoot, 'dist', 'package.json');
if (!fs.existsSync(distPkgPath)) {
  failures += 1;
  console.error('FAIL dist/package.json is missing (run build:pkg)');
} else {
  const distPkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf-8'));
  if (distPkg.type !== 'commonjs') {
    failures += 1;
    console.error('FAIL dist/package.json must set "type": "commonjs" (or dist/*.js resolves as ESM)');
  }
}

// package.json is published as-is (no more staged dist/package.json rewrite), and
// `src/` does not ship (files: ["dist", "README.md"]) — so a literal "development"
// condition pointing at
// ./src/... would be a live, resolvable-but-broken promise for any consumer whose
// tooling defaults to activating it, not dead weight. Vite's default resolve.conditions
// is ['module', 'browser', 'development|production'], which it substitutes to the literal
// string "development" whenever NODE_ENV !== 'production' — i.e. every Vite dev-mode
// consumer would hit this with zero opt-in. The real condition name must never collide
// with a tool's own auto-activated condition (see packages/trueforge-core/package.json).
const rootPkgPath = path.join(pkgRoot, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
if (JSON.stringify(rootPkg.exports ?? {}).includes('"development"')) {
  failures += 1;
  console.error(
    'FAIL package.json exports must not use a literal "development" condition key (Vite/webpack auto-activate it in dev mode; src/ is not shipped)',
  );
}

if (failures > 0) {
  console.error(`check-dist: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-dist: all good');
