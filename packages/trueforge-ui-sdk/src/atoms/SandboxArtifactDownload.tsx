'use client';

import { useMemo } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import type { ChatFileDownloadFile } from './ChatFileDownload.js';

export type SandboxArtifactDownloadProps = {
  code: string;
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
};

export type SandboxArtifact = ChatFileDownloadFile;

const PREFIX = 'sandbox_artifacts';
/** tfy / agent format: `[name](path)` */
const PAIR_RE = /\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Parses a `sandbox_artifacts` fence body into `{ name, path }` entries.
 * Primary format matches tfy-web-components: `[file.js](/tmp/file.js)`.
 * Colon lines (`name: path`) are accepted as a fallback.
 */
export function parseSandboxArtifacts(raw: string): SandboxArtifact[] {
  const trimmed = raw.trim();
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length).trimStart() : trimmed;

  const fromLinks: SandboxArtifact[] = [];
  PAIR_RE.lastIndex = 0;
  let match: RegExpExecArray | null = PAIR_RE.exec(body);
  while (match !== null) {
    const name = match[1]?.trim() ?? '';
    const path = match[2]?.trim() ?? '';
    if (name && path) fromLinks.push({ name, path });
    match = PAIR_RE.exec(body);
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
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SandboxArtifactDownload: typeof SandboxArtifactDownload;
  }
}
