import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Options } from 'tsup';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const srcDbDir = path.join(packageDir, 'src/db');

function migrationEntries(engine: 'postgres' | 'sqlite'): Record<string, string> {
  const migrationsDir = path.join(srcDbDir, engine, 'migrations');
  return Object.fromEntries(
    readdirSync(migrationsDir)
      .filter(name => name.endsWith('.ts'))
      .map(name => {
        const base = name.replace(/\.ts$/, '');
        return [`${engine}/migrations/${base}`, path.join(migrationsDir, name)] as const;
      }),
  );
}

const shared: Options = {
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  target: 'esnext',
  outDir: 'dist',
};

// tsup builds every config here concurrently, so neither may use `clean`: it wipes the
// shared dist/ mid-flight and can delete the sibling config's output. The build script
// clears dist/ before invoking tsup instead.
export default defineConfig([
  {
    ...shared,
    entry: {
      main: 'src/main.ts',
      // Emit both engines under dist/{postgres,sqlite}/migrations/.
      // Runtime selects migrations via STANDALONE (false → postgres, true → sqlite).
      ...migrationEntries('postgres'),
      ...migrationEntries('sqlite'),
    },
    // SRT vendor helpers must resolve from node_modules at runtime (createRequire).
    external: ['@anthropic-ai/sandbox-runtime'],
  },
  {
    ...shared,
    entry: {
      cli: 'src/cli.ts',
    },
    // Keep cli as a thin launcher that dynamically imports ./main.js.
    external: ['./main.js'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
