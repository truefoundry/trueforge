import { pathToFileURL } from 'node:url';

/** Dynamic-import an absolute module path (e.g. Kysely migration files). */
export function importAbsoluteModule(filePath: string): Promise<unknown> {
  // Tests load TypeScript migrations from src/; production loads compiled .js from dist/.
  if (filePath.endsWith('.ts')) {
    return import(filePath);
  }
  return import(pathToFileURL(filePath).href);
}
