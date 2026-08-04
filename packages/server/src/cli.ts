/**
 * CLI entry for `@truefoundry/utils`. Parses argv, then hands off to `./main`.
 * Topology comes from env / config defaults (`SINGLE_BINARY=true` unless set).
 * Env must be finalized before importing `./main` because config reads
 * process.env at module load.
 */
import { parseArgs } from 'node:util';

function printUsage(): void {
  console.log(`Usage:
  npx @truefoundry/utils
  npx @truefoundry/utils --port <n>

Start the agent server. Defaults to single-binary mode (SQLite + in-memory
streams); set SINGLE_BINARY=false with POSTGRES_* and REDIS_URL for multi-replica.

Options:
  --port <n>   HTTP port (default: 8790, or PORT env)
  -h, --help   Show this help
`);
}

function applyPort(raw: string | undefined): void {
  if (raw === undefined) {
    return;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${raw}" (expected integer 1–65535)`);
  }
  process.env['PORT'] = String(port);
}

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printUsage();
  } else {
    applyPort(values.port);
    await import('./main.js');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
