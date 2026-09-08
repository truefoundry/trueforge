import { rmSync } from 'node:fs';
import path from 'node:path';

for (const target of process.argv.slice(2)) {
  rmSync(path.resolve(target), { recursive: true, force: true });
}
