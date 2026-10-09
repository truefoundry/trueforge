'use client';

import { useMemo } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import type { ChatFileDownloadFile } from './ChatFileDownload.js';

export type SandboxArtifactDownloadProps = {
  code: string;
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
  /** Shown on hover when `readOnly` is true. */
  sandboxDownloadReadOnlyTooltip?: string;
};

export type SandboxArtifact = ChatFileDownloadFile;

const PREFIX = 'sandbox_artifacts';
const ESCAPABLE_DELIMITERS = new Set(['[', ']', '(', ')', '\\']);

/**
 * Parses a `sandbox_artifacts` fence body into `{ name, path }` entries.
 * Primary format matches tfy-web-components: `[file.js](/tmp/file.js)`.
 * Colon lines (`name: path`) are accepted as a fallback.
 */
export function parseSandboxArtifacts(raw: string): SandboxArtifact[] {
  const trimmed = raw.trim();
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length).trimStart() : trimmed;

  const fromLinks: SandboxArtifact[] = [];
  for (let start = 0; start < body.length; start++) {
    if (body[start] === '\\' && ESCAPABLE_DELIMITERS.has(body[start + 1] ?? '')) {
      start++;
      continue;
    }
    if (body[start] !== '[') continue;

    let cursor = start + 1;
    let name = '';
    let closedLabel = false;
    while (cursor < body.length) {
      const char = body[cursor];
      if (char === '\n' || char === '\r') break;
      const escaped = body[cursor + 1] ?? '';
      if (char === '\\' && ESCAPABLE_DELIMITERS.has(escaped)) {
        name += escaped;
        cursor += 2;
        continue;
      }
      if (char === ']') {
        closedLabel = true;
        cursor++;
        break;
      }
      name += char;
      cursor++;
    }
    if (!closedLabel || body[cursor] !== '(') continue;

    cursor++;
    let path = '';
    let depth = 0;
    let closedPath = false;
    while (cursor < body.length) {
      const char = body[cursor];
      if (char === '\n' || char === '\r') break;
      const escaped = body[cursor + 1] ?? '';
      if (char === '\\' && ESCAPABLE_DELIMITERS.has(escaped)) {
        path += escaped;
        cursor += 2;
        continue;
      }
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        if (depth === 0) {
          closedPath = true;
          cursor++;
          break;
        }
        depth--;
      }
      path += char;
      cursor++;
    }
    if (!closedPath) continue;

    if (name.trim() && path.trim()) fromLinks.push({ name: name.trim(), path: path.trim() });
    start = cursor - 1;
  }
  if (fromLinks.length > 0) return fromLinks;

  // Fallback: `name: path` per line
  return body.split('\n').flatMap(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return [];
    const name = line.slice(0, idx).trim();
    const path = line.slice(idx + 1).trim();
    if (!name || !path) return [];
    // Skip leftover markdown link debris
    if (name.startsWith('[') || path.startsWith('(')) return [];
    return [{ name, path }];
  });
}

export function SandboxArtifactDownload({
  code,
  fileDownloadBaseUrl,
  onDownloadArtifact,
  readOnly,
  sandboxDownloadReadOnlyTooltip,
}: SandboxArtifactDownloadProps) {
  const ChatFileDownload = useSlot('ChatFileDownload');
  const artifacts = useMemo(() => parseSandboxArtifacts(code), [code]);
  if (artifacts.length === 0) return null;

  return (
    <ChatFileDownload
      files={artifacts}
      fileDownloadBaseUrl={fileDownloadBaseUrl}
      onDownloadArtifact={onDownloadArtifact}
      readOnly={readOnly}
      readOnlyTooltip={sandboxDownloadReadOnlyTooltip}
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SandboxArtifactDownload: typeof SandboxArtifactDownload;
  }
}
