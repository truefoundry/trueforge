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
/** Delimiters that may appear escaped inside `[name](path)` entries. */
const ESCAPABLE_DELIMITERS = new Set(['[', ']', '(', ')', '\\']);
/** Same shape as server `validateNoPathTraversal` — keep in sync intentionally. */
const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
/** Matches server PATH_MAX usable length (NUL-terminated 4096). */
const MAX_PATH_LENGTH = 4095;

/**
 * Model-authored paths feed download hrefs and API calls. Drop anything that is not a
 * plain sandbox file path so `fileDownloadBaseUrl` cannot be steered via `..` or schemes.
 */
function isSafeArtifactPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.includes('\0')) return false;
  if (PATH_TRAVERSAL_RE.test(path)) return false;
  // `javascript:…`, `https:…`, etc. — sandbox paths are filesystem, not URLs.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return true;
}

function toArtifact(name: string, path: string): SandboxArtifact | null {
  const trimmedName = name.trim();
  const trimmedPath = path.trim();
  if (!trimmedName || !isSafeArtifactPath(trimmedPath)) return null;
  return { name: trimmedName, path: trimmedPath };
}

/**
 * Parse one `[name](path)` starting at `start` (`body[start] === '['`).
 * Paths may contain balanced `(…)` so `/tmp/report(final).csv` stays intact.
 * Returns null when the link is incomplete or crosses a newline.
 */
function parseMarkdownLink(body: string, start: number): { name: string; path: string; end: number } | null {
  let cursor = start + 1;

  let name = '';
  let closedLabel = false;
  while (cursor < body.length) {
    const char = body[cursor];
    if (char === '\n' || char === '\r') return null;
    if (char === '\\' && ESCAPABLE_DELIMITERS.has(body[cursor + 1] ?? '')) {
      name += body[cursor + 1] ?? '';
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
  if (!closedLabel || body[cursor] !== '(') return null;

  cursor++;
  let path = '';
  let depth = 0;
  let closedPath = false;
  while (cursor < body.length) {
    const char = body[cursor];
    if (char === '\n' || char === '\r') return null;
    if (char === '\\' && ESCAPABLE_DELIMITERS.has(body[cursor + 1] ?? '')) {
      path += body[cursor + 1] ?? '';
      cursor += 2;
      continue;
    }
    if (char === '(') {
      depth++;
      path += char;
      cursor++;
      continue;
    }
    if (char === ')') {
      if (depth === 0) {
        closedPath = true;
        cursor++;
        break;
      }
      depth--;
      path += char;
      cursor++;
      continue;
    }
    path += char;
    cursor++;
  }
  if (!closedPath) return null;

  return { name, path, end: cursor };
}

/**
 * Parses a `sandbox_artifacts` fence body into `{ name, path }` entries.
 * Primary format: `[file.js](/tmp/file.js)`. Fallback: `name: path` per line.
 */
export function parseSandboxArtifacts(raw: string): SandboxArtifact[] {
  const trimmed = raw.trim();
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length).trimStart() : trimmed;

  const fromLinks: SandboxArtifact[] = [];
  for (let start = 0; start < body.length; start++) {
    // Skip an escaped `[` so it is not treated as a link opener.
    if (body[start] === '\\' && ESCAPABLE_DELIMITERS.has(body[start + 1] ?? '')) {
      start++;
      continue;
    }
    if (body[start] !== '[') continue;

    const link = parseMarkdownLink(body, start);
    if (link == null) continue;

    const artifact = toArtifact(link.name, link.path);
    if (artifact != null) fromLinks.push(artifact);
    start = link.end - 1;
  }
  if (fromLinks.length > 0) return fromLinks;

  // Fallback: `name: path` per line
  return body.split('\n').flatMap(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return [];
    const name = line.slice(0, idx).trim();
    const path = line.slice(idx + 1).trim();
    // Skip leftover markdown link debris
    if (name.startsWith('[') || path.startsWith('(')) return [];
    const artifact = toArtifact(name, path);
    return artifact == null ? [] : [artifact];
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
