import path from 'node:path';

const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Longest reference target considered; bounds every scan so hostile input stays linear. */
const MAX_TARGET_LENGTH = 2048;

/** Drop query and fragment so a reference can be resolved as a file path. */
export function stripReferenceDecorations(reference: string): string {
  const hash = reference.indexOf('#');
  const query = reference.indexOf('?');
  let end = reference.length;
  if (hash >= 0) {
    end = Math.min(end, hash);
  }
  if (query >= 0) {
    end = Math.min(end, query);
  }
  return reference.slice(0, end).trim();
}

export function isExternalReference(reference: string): boolean {
  const value = stripReferenceDecorations(reference).trim();
  return value === '' || value.startsWith('#') || value.startsWith('data:') || SCHEME.test(value);
}

export type ResolvedReference = { kind: 'relative'; path: string } | { kind: 'site'; path: string };

/**
 * Resolves one reference against the file that contains it.
 * `site` is a root-absolute path (`/assets/app.css`) with the leading slash removed.
 * Returns undefined for URLs, data URIs, fragments, and paths that escape via `..`.
 */
export function resolveReference(fromFile: string, reference: string): ResolvedReference | undefined {
  const value = stripReferenceDecorations(reference);
  if (isExternalReference(reference) || value.includes('\0') || value.includes('\\')) {
    return undefined;
  }
  if (value.startsWith('/')) {
    const sitePath = normalizeBundlePath(value.slice(1));
    return sitePath === undefined ? undefined : { kind: 'site', path: sitePath };
  }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), value));
  const relative = normalizeBundlePath(joined);
  return relative === undefined ? undefined : { kind: 'relative', path: relative };
}

/** Bundle-relative path with no empty, `.`, or `..` segments. */
export function normalizeBundlePath(filePath: string): string | undefined {
  const normalized = path.posix.normalize(filePath);
  if (normalized.startsWith('/') || normalized === '.' || normalized === '') {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  return normalized;
}

/** References a file might load. Candidates are not yet checked against the sandbox. */
export function extractReferences(content: string, kind: ReferenceKind): string[] {
  const found = new Set<string>();
  const add = (value: string | undefined) => {
    if (value !== undefined && value.trim() !== '') {
      found.add(value.trim());
    }
  };
  if (kind === 'html') {
    for (const match of content.matchAll(/\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      add(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of content.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const srcset = match[1] ?? match[2] ?? '';
      for (const part of srcset.split(',')) {
        add(part.trim().split(/\s+/)[0]);
      }
    }
    collectStringLiterals(content, found);
  } else if (kind === 'css') {
    for (const match of content.matchAll(
      /url\(\s*(?:"([^"\n]{0,2048})"|'([^'\n]{0,2048})'|([^)'"\s]{1,2048}))\s*\)/gi,
    )) {
      add(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of content.matchAll(/@import\s+(?:"([^"\n]{0,2048})"|'([^'\n]{0,2048})')/gi)) {
      add(match[1] ?? match[2]);
    }
  } else if (kind === 'markdown') {
    collectMarkdownTargets(content, add);
    collectStringLiterals(content, found);
  } else if (kind === 'script' || kind === 'json') {
    collectStringLiterals(content, found);
  }
  return [...found];
}

export type ReferenceKind = 'html' | 'css' | 'markdown' | 'script' | 'json' | 'other';

export function referenceKindForPath(filePath: string): ReferenceKind {
  switch (path.posix.extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
      return 'css';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return 'script';
    case '.json':
      return 'json';
    default:
      return 'other';
  }
}

/**
 * Targets of `[text](target)` and `![alt](target)`. Anchors on `](` instead of matching the
 * bracketed text, which backtracks quadratically on unmatched `[`. A target ends at `]`, so
 * the next anchor is never inside a scanned range and every character is read at most once.
 */
function collectMarkdownTargets(content: string, add: (value: string | undefined) => void): void {
  let index = content.indexOf('](');
  while (index >= 0) {
    const start = index + 2;
    const limit = Math.min(content.length, start + MAX_TARGET_LENGTH);
    let end = start;
    while (end < limit && content[end] !== ')' && content[end] !== ']' && content.charCodeAt(end) > 0x20) {
      end += 1;
    }
    if (end > start && content[end] === ')') {
      add(content.slice(start, end));
    }
    index = content.indexOf('](', start);
  }
}

function collectStringLiterals(content: string, found: Set<string>): void {
  for (const match of content.matchAll(/(['"])([^'"\n\\]{1,240})\1/g)) {
    const value = match[2];
    if (value === undefined) {
      continue;
    }
    if (value.startsWith('./') || value.startsWith('../') || value.startsWith('/') || value.includes('/')) {
      found.add(value);
    }
  }
}
