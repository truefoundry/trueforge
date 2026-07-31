import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsup';

const srcDbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/db');

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

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    // Emit both engines under dist/{postgres,sqlite}/migrations/.
    // Only Postgres is applied at runtime (main) and via `pnpm migrate`.
    ...migrationEntries('postgres'),
    ...migrationEntries('sqlite'),
  },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
});
