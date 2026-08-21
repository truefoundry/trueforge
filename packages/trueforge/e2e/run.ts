/**
 * E2E runner: load `e2e/.env` (real environment variables win), upsert settings,
 * run registered scenarios (optionally `--only <substring>`), exit non-zero on failure
 * or when the filter matches nothing.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, errorMessage, runTests, upsertE2eResources } from './helpers';
import { tests } from './scenarios';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const preexisting = { ...process.env };
  process.loadEnvFile(path);
  Object.assign(process.env, preexisting);
}

function parseOnlyFilter(argv: string[]): string | undefined {
  const idx = argv.indexOf('--only');
  const value = idx !== -1 ? argv[idx + 1] : undefined;
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

async function main(): Promise<void> {
  loadDotEnv(resolve(HERE, '.env'));
  const client = createClient();
  console.log('Upserting E2E resources (model, MCP, sandbox, named agent)...');
  await upsertE2eResources(client);
  const exitCode = await runTests({ tests, filter: parseOnlyFilter(process.argv) });
  process.exitCode = exitCode;
}

main().catch((err: unknown) => {
  console.error(errorMessage(err));
  process.exitCode = 1;
});
