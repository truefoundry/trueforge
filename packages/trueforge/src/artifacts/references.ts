import path from 'node:path';

const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

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
    for (const match of content.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi)) {
      add(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of content.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
      add(match[1] ?? match[2]);
    }
  } else if (kind === 'markdown') {
    for (const match of content.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)) {
      add(match[1]);
    }
    for (const match of content.matchAll(/(?<!!)\[[^\]]*]\(([^)\s]+)\)/g)) {
      add(match[1]);
    }
    collectStringLiterals(content, found);
  } else if (kind === 'script' || kind === 'json') {
    collectStringLiterals(content, found);
  }
  return [...found];
}

export type ReferenceKind = 'html' | 'css' | 'markdown' | 'script' | 'json' | 'other';

export function referenceKindForPath(filePath: string): ReferenceKind {
  const extension = path.posix.extname(filePath).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.css') return 'css';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (
    extension === '.js' ||
    extension === '.mjs' ||
    extension === '.cjs' ||
    extension === '.jsx' ||
    extension === '.ts' ||
    extension === '.tsx'
  ) {
    return 'script';
  }
  if (extension === '.json') return 'json';
  return 'other';
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
