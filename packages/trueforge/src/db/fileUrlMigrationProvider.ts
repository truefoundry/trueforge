import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Migration, MigrationProvider } from 'kysely/migration';

export class FileUrlMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationFolder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    const files = await fs.readdir(this.migrationFolder);
    for (const file of files) {
      const isJs = file.endsWith('.js') || file.endsWith('.mjs');
      const isTs = file.endsWith('.ts') || file.endsWith('.mts');
      if (!isJs && !isTs) {
        continue;
      }

      const fullPath = path.join(this.migrationFolder, file);

      const specifier = process.platform === 'win32' ? pathToFileURL(fullPath).href : fullPath;

      const migration = (await import(specifier)) as Migration;
      const key = file.substring(0, file.lastIndexOf('.'));
      migrations[key] = migration;
    }

    return migrations;
  }
}
