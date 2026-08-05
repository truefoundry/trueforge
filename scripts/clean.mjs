import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(rootDir, 'packages');
const removeDependencies = process.argv.slice(2).includes('--dependencies');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--dependencies');

if (unknownArguments.length > 0) {
  throw new Error(`Unknown clean arguments: ${unknownArguments.join(', ')}`);
}

const packageDirectories = (await readdir(packagesDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(packagesDir, entry.name));

const targets = [
  path.join(rootDir, '.eslintcache'),
  ...packageDirectories.map(directory => path.join(directory, 'dist')),
];

if (removeDependencies) {
  targets.push(path.join(rootDir, 'node_modules'));
  targets.push(...packageDirectories.map(directory => path.join(directory, 'node_modules')));
}

await Promise.all(targets.map(target => rm(target, { recursive: true, force: true })));

console.log(
  removeDependencies
    ? 'Removed build outputs, ESLint cache, and node_modules'
    : 'Removed build outputs and ESLint cache',
);
