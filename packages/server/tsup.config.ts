import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsup';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/db/postgres/migrations');
const migrationEntries = Object.fromEntries(
  readdirSync(migrationsDir)
    .filter(name => name.endsWith('.ts'))
    .map(name => {
      const base = name.replace(/\.ts$/, '');
      return [`postgres/migrations/${base}`, path.join(migrationsDir, name)] as const;
    }),
);

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    ...migrationEntries,
  },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
});
