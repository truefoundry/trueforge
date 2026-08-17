/**
 * CLI entry for `@truefoundry/trueforge` (`package.json` `bin` → `dist/cli.js`).
 *
 * Kept separate from `main.ts` so Docker / `pnpm start` can boot with env only
 * (`node dist/main.js`), while `npx @truefoundry/trueforge` gets a shebang, `--help`,
 * and `--port`. Flags must be applied before importing `./main` because config
 * reads `process.env` at module load.
 *
 * Topology defaults from env / config (`STANDALONE=true` unless set): standalone
 * uses SQLite with no Redis; `STANDALONE=false` uses Postgres + Redis peering.
 */
import { parseArgs } from 'node:util';

import { PACKAGE_VERSION } from './packageVersion';

function printUsage(): void {
  console.log(`Usage:
  npx @truefoundry/trueforge
  npx @truefoundry/trueforge --port <n>

TrueForge v${PACKAGE_VERSION}. Start the agent server.
Defaults to standalone mode (SQLite, no Redis) — local use only, not production-safe.
Set STANDALONE=false with Postgres and Redis for multi-replica peering.

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
  console.error(error);
  process.exit(1);
}
