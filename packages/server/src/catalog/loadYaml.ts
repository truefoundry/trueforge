/**
 * Reads and validates a YAML config file. Any failure (missing file, invalid
 * YAML, schema violation) throws, so callers fail at startup with a message
 * pointing at the offending file.
 */
import fs from 'node:fs';
import { parse } from 'yaml';
import type { z } from 'zod';

/** Parses and validates YAML text. `label` is used in error messages. */
export function parseYamlString<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let document: unknown;
  try {
    document = parse(raw);
  } catch (error) {
    throw new Error(`Invalid YAML in ${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  const result = schema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  - ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid config in ${label}:\n${issues}`);
  }
  return result.data;
}

export function loadYamlAtPath<T>(filePath: string, schema: z.ZodType<T>): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read config file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return parseYamlString(raw, schema, filePath);
}
