import { chmodSync } from 'node:fs';
import path from 'node:path';

const [target, modeOctal] = process.argv.slice(2);
if (target === undefined || modeOctal === undefined) {
  throw new Error('usage: chmod-path.mjs <path> <mode-octal>');
}
chmodSync(path.resolve(target), parseInt(modeOctal, 8));
