#!/usr/bin/env node
import { Daytona } from '@daytona/sdk';
import { parseArgs } from 'node:util';

function printUsage() {
  console.log(`Usage:
  node create-daytona-snapshot.mjs --image <image> --name <name>

Options:
  --image <string>  Container image to snapshot
  --name <string>   Daytona snapshot name
  -h, --help        Show this help
`);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    image: { type: 'string' },
    name: { type: 'string' },
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

const image = values.image;
const name = values.name;

console.log(`image=${image}`);
console.log(`name=${name}`);

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
});

const snapshot = await daytona.snapshot.create({
  name,
  image,
});

console.log(`Snapshot created: ${snapshot.id}`);
