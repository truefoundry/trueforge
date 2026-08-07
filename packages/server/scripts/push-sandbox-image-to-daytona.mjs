#!/usr/bin/env node
import { Daytona, DaytonaNotFoundError } from '@daytona/sdk';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const POLL_INTERVAL_MS = 3_000;
const DELETE_TIMEOUT_MS = 5 * 60 * 1_000;
const CREATE_TIMEOUT_SECONDS = 5 * 60;

function printUsage() {
  console.log(`Usage:
  pnpm push-sandbox-image-to-daytona -- --image <image> --name <name> [--force]

Options:
  --image <string>  Container image to snapshot
  --name <string>   Daytona snapshot name
  --force           Delete an existing snapshot, wait for removal, then recreate
  -h, --help        Show this help

Requires DAYTONA_API_KEY in the environment.
`);
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    image: { type: 'string' },
    name: { type: 'string' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
  strict: true,
});

if (values.help) {
  printUsage();
  process.exit(0);
}

if (values.image === undefined || values.name === undefined) {
  console.error('Error: --image and --name are required');
  printUsage();
  process.exit(1);
}

const apiKey = process.env.DAYTONA_API_KEY;
if (apiKey === undefined || apiKey === '') {
  console.error('Error: DAYTONA_API_KEY is required');
  process.exit(1);
}

const image = values.image;
const name = values.name;
const force = values.force;

console.log(`image=${image}`);
console.log(`name=${name}`);
console.log(`force=${String(force)}`);

const daytona = new Daytona({
  apiKey,
});

let existing = null;
try {
  existing = await daytona.snapshot.get(name);
} catch (error) {
  if (!(error instanceof DaytonaNotFoundError)) {
    throw error;
  }
}

if (existing !== null) {
  console.log(`Snapshot already exists: id=${existing.id} state=${existing.state}`);
  if (!force) {
    console.log('Pass --force to delete it and recreate.');
    process.exit(0);
  }

  console.log('Deleting existing snapshot…');
  console.log('Press Ctrl+C to cancel.');
  await daytona.snapshot.delete(existing);

  const deadline = Date.now() + DELETE_TIMEOUT_MS;
  for (;;) {
    if (Date.now() >= deadline) {
      console.error(
        `Timed out after 5 minutes waiting for snapshot "${name}" to be deleted. It may still be removing in Daytona.`,
      );
      process.exit(1);
    }

    await delay(POLL_INTERVAL_MS);

    try {
      const current = await daytona.snapshot.get(name);
      console.log(`delete state=${current.state}`);
    } catch (error) {
      if (error instanceof DaytonaNotFoundError) {
        console.log('Snapshot deleted.');
        break;
      }
      throw error;
    }
  }
}

console.log('Press Ctrl+C to cancel.');

const snapshot = await daytona.snapshot.create(
  {
    name,
    image,
  },
  {
    onLogs: console.log,
    timeout: CREATE_TIMEOUT_SECONDS,
  },
);

console.log(`Snapshot created: ${snapshot.id}`);
