import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Standalone mode persists a key on first boot so content tokens survive a restart.
 * Distributed mode must set ARTIFACT_CONTENT_SIGNING_KEY so every replica agrees.
 */
export function resolveArtifactSigningKey(input: {
  configured: string | undefined;
  standalone: boolean;
  appDataDir: string;
}): string {
  if (input.configured !== undefined && input.configured !== '') {
    return input.configured;
  }
  if (!input.standalone) {
    throw new Error('ARTIFACT_CONTENT_SIGNING_KEY is required when STANDALONE is false');
  }
  const filePath = path.join(input.appDataDir, 'artifact-content-signing-key');
  if (existsSync(filePath)) {
    const stored = readFileSync(filePath, 'utf8').trim();
    if (stored !== '') {
      return stored;
    }
  }
  const key = randomBytes(32).toString('base64url');
  mkdirSync(input.appDataDir, { recursive: true });
  writeFileSync(filePath, key, { mode: 0o600 });
  return key;
}
