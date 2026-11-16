import path from 'node:path';
import type { ArtifactEntryContentType } from '../db/artifactStore';

const MEDIA_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export function mediaTypeForPath(filePath: string): string {
  return MEDIA_TYPES[path.posix.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function entryContentTypeForPath(filePath: string, content: string): ArtifactEntryContentType | undefined {
  const extension = path.posix.extname(filePath).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    return 'html';
  }
  if (extension === '.md' || extension === '.markdown') {
    return 'markdown';
  }
  const trimmed = content.trimStart().slice(0, 64).toLowerCase();
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
    return 'html';
  }
  if (/^#{1,6}\s/m.test(content)) {
    return 'markdown';
  }
  return undefined;
}
