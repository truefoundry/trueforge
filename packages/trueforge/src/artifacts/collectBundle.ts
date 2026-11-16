import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ArtifactEntryContentType } from '../db/artifactStore';
import { entryContentTypeForPath, mediaTypeForPath } from './mediaType';
import {
  extractReferences,
  isExternalReference,
  normalizeBundlePath,
  referenceKindForPath,
  stripReferenceDecorations,
} from './references';

export interface ArtifactLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxVersionBytes: number;
}

export interface CollectedArtifactFile {
  absolutePath: string;
  bundlePath: string;
  body: Buffer;
  sizeBytes: number;
  sha256: string;
  mediaType: string;
}

export interface CollectedBundle {
  root: string;
  entryPath: string;
  entryContentType: ArtifactEntryContentType;
  files: CollectedArtifactFile[];
  missing: string[];
  totalSizeBytes: number;
  manifestSha256: string;
}

export class ArtifactBundleError extends Error {
  readonly statusCode: 413 | 422;
  readonly code: 'artifact_too_large' | 'unsupported_content_type' | 'invalid_path';

  constructor(statusCode: 413 | 422, code: ArtifactBundleError['code'], message: string) {
    super(message);
    this.name = 'ArtifactBundleError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SandboxFileReader {
  listDirectory(root: string): Promise<{ files: { path: string; sizeBytes: number }[]; truncated: boolean }>;
  readFile(absolutePath: string): Promise<Buffer>;
}

/**
 * Follows references from the entry file and reads every regular file it needs.
 * The bundle root is the nearest common directory of those files. Root-absolute
 * references (`/assets/app.css`) resolve against the entry file's directory.
 */
export async function collectArtifactBundle(input: {
  entryPath: string;
  sandbox: SandboxFileReader;
  limits: ArtifactLimits;
}): Promise<CollectedBundle> {
  const entryPath = normalizeAbsolute(input.entryPath);
  if (entryPath === undefined) {
    throw new ArtifactBundleError(422, 'invalid_path', 'Entry path must be an absolute sandbox path');
  }
  const siteRoot = path.posix.dirname(entryPath);
  const sizes = new Map<string, number>();
  const listed = new Set<string>();

  const ensureListed = async (directory: string): Promise<void> => {
    if (listed.has(directory)) {
      return;
    }
    listed.add(directory);
    const result = await input.sandbox.listDirectory(directory);
    for (const file of result.files) {
      sizes.set(`${directory}/${file.path}`, file.sizeBytes);
    }
  };

  await ensureListed(siteRoot);
  if (!sizes.has(entryPath)) {
    throw new ArtifactBundleError(422, 'invalid_path', `Entry file was not found: ${entryPath}`);
  }

  const included = new Map<string, Buffer>();
  const missing: string[] = [];
  const pending = [entryPath];
  let totalSize = 0;

  while (pending.length > 0) {
    const absolute = pending.shift();
    if (absolute === undefined || included.has(absolute)) {
      continue;
    }
    await ensureListed(path.posix.dirname(absolute));
    const size = sizes.get(absolute);
    if (size === undefined) {
      missing.push(absolute);
      continue;
    }
    if (size > input.limits.maxFileBytes) {
      throw new ArtifactBundleError(413, 'artifact_too_large', `File exceeds the per-file limit: ${absolute}`);
    }
    if (included.size >= input.limits.maxFiles) {
      throw new ArtifactBundleError(
        413,
        'artifact_too_large',
        `An artifact can include at most ${String(input.limits.maxFiles)} files`,
      );
    }
    const body = await input.sandbox.readFile(absolute);
    if (body.byteLength > input.limits.maxFileBytes) {
      throw new ArtifactBundleError(413, 'artifact_too_large', `File exceeds the per-file limit: ${absolute}`);
    }
    totalSize += body.byteLength;
    if (totalSize > input.limits.maxVersionBytes) {
      throw new ArtifactBundleError(413, 'artifact_too_large', 'Artifact exceeds the total size limit');
    }
    included.set(absolute, body);

    const kind = referenceKindForPath(absolute);
    if (kind === 'other') {
      continue;
    }
    for (const reference of extractReferences(body.toString('utf8'), kind)) {
      const nextAbsolute = resolveToAbsolute({ siteRoot, fromAbsolute: absolute, reference });
      if (nextAbsolute !== undefined && !included.has(nextAbsolute)) {
        pending.push(nextAbsolute);
      }
    }
  }

  const entryBody = included.get(entryPath);
  if (entryBody === undefined) {
    throw new ArtifactBundleError(422, 'invalid_path', `Entry file was not found: ${entryPath}`);
  }
  const entryContentType = entryContentTypeForPath(entryPath, entryBody.toString('utf8'));
  if (entryContentType === undefined) {
    throw new ArtifactBundleError(422, 'unsupported_content_type', 'Only HTML and Markdown can be published');
  }

  const root = commonDirectory([...included.keys()]);
  const files: CollectedArtifactFile[] = [];
  for (const [absolute, body] of included) {
    const bundlePath = absolute.slice(root.length + 1);
    files.push({
      absolutePath: absolute,
      bundlePath,
      body,
      sizeBytes: body.byteLength,
      sha256: sha256(body),
      mediaType: mediaTypeForPath(bundlePath),
    });
  }
  files.sort((left, right) => (left.bundlePath < right.bundlePath ? -1 : left.bundlePath > right.bundlePath ? 1 : 0));
  return {
    root,
    entryPath: entryPath.slice(root.length + 1),
    entryContentType,
    files,
    missing,
    totalSizeBytes: totalSize,
    manifestSha256: manifestHash(files),
  };
}

function normalizeAbsolute(filePath: string): string | undefined {
  if (!filePath.startsWith('/') || filePath.includes('\0') || filePath.includes('\\')) {
    return undefined;
  }
  const normalized = path.posix.normalize(filePath);
  if (normalized.split('/').includes('..')) {
    return undefined;
  }
  return normalized;
}

function resolveToAbsolute(input: { siteRoot: string; fromAbsolute: string; reference: string }): string | undefined {
  const value = stripReferenceDecorations(input.reference);
  if (isExternalReference(input.reference) || value.includes('\0') || value.includes('\\')) {
    return undefined;
  }
  if (value.startsWith('/')) {
    const sitePath = normalizeBundlePath(value.slice(1));
    return sitePath === undefined ? undefined : `${input.siteRoot}/${sitePath}`;
  }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(input.fromAbsolute), value));
  if (!joined.startsWith('/') || joined.split('/').includes('..')) {
    return undefined;
  }
  return joined;
}

function commonDirectory(absolutePaths: readonly string[]): string {
  const directories = absolutePaths.map(filePath => path.posix.dirname(filePath));
  const first = directories[0];
  if (first === undefined) {
    return '/';
  }
  let prefix = first;
  for (const directory of directories) {
    while (prefix !== '/' && directory !== prefix && !directory.startsWith(`${prefix}/`)) {
      prefix = path.posix.dirname(prefix);
    }
  }
  return prefix;
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function manifestHash(files: readonly CollectedArtifactFile[]): string {
  const lines = files.map(file => `${file.bundlePath} ${file.sha256}`).join('\n');
  return sha256(Buffer.from(lines));
}
