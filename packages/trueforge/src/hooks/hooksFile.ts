/**
 * hooks.json loading (docs/key-features/hooks). The path comes from
 * configuration.HOOKS_PATH — by default the env-paths config dir shared with
 * the rest of the per-user trueforge state, so external integrators can find
 * the file without any env configuration:
 *
 *   macOS    ~/Library/Preferences/trueforge/hooks.json
 *   Linux    $XDG_CONFIG_HOME/trueforge/hooks.json (default ~/.config/trueforge)
 *   Windows  %APPDATA%\trueforge\Config\hooks.json
 *
 * An absent file disables hooks; a present-but-invalid file throws so the
 * server fails at startup pointing at the offending file (same posture as the
 * YAML catalogs). Edits require a restart — the file is read exactly once.
 */
import fs from 'node:fs';
import type { Logger } from 'winston';
import { HOOK_EVENT_NAMES, HooksFileSchema, type HooksFile } from '../schemas/hooks';
import { formatZodIssues } from '../utils/formatZodIssues';

// Property check rather than `instanceof Error`: fs errors can originate in
// another realm (e.g. a test VM), where instanceof fails across globals.
function isFileMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Reads and validates the hooks file. A missing file at the default location →
 * undefined (hooks disabled); missing at an explicitly configured path →
 * throws, so a typo'd TRUEFORGE_HOOKS_PATH cannot silently turn policy off.
 */
export function loadHooksFile(input: { path: string; explicitPath: boolean; logger: Logger }): HooksFile | undefined {
  const { path, explicitPath, logger } = input;
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (error) {
    if (isFileMissingError(error)) {
      if (explicitPath) {
        throw new Error(`Hooks file not found at TRUEFORGE_HOOKS_PATH: ${path}`, { cause: error });
      }
      return undefined;
    }
    throw new Error(`Failed to read hooks file ${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in hooks file ${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  const result = HooksFileSchema.safeParse(document);
  if (!result.success) {
    throw new Error(`Invalid hooks file ${path}:\n${formatZodIssues(result.error)}`);
  }

  const knownEvents = new Set<string>(HOOK_EVENT_NAMES);
  for (const key of Object.keys(result.data.hooks)) {
    if (!knownEvents.has(key)) {
      logger.warn('Ignoring unknown hook event in hooks file', { path, event: key });
    }
  }
  return result.data;
}
