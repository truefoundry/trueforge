import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { SandboxEnvironmentManifest } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { isReservedEnvironmentName } from './environmentDisplay.js';

export function manifestToYaml(manifest: SandboxEnvironmentManifest): string {
  return stringifyYaml(manifest, { lineWidth: 0 });
}

function isSandboxEnvironmentManifest(value: unknown): value is SandboxEnvironmentManifest {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('name' in value) || typeof value.name !== 'string' || value.name.trim().length === 0) {
    return false;
  }
  return true;
}

export function parseManifestYaml(text: string): { manifest: SandboxEnvironmentManifest } | { error: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (caught) {
    return { error: getErrorMessage(caught, 'Invalid YAML') };
  }
  if (!isSandboxEnvironmentManifest(parsed)) {
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'YAML must be an object manifest' };
    }
    return { error: 'Manifest name is required' };
  }
  if (isReservedEnvironmentName(parsed.name)) {
    return { error: 'Name "default" is reserved' };
  }
  return { manifest: parsed };
}
