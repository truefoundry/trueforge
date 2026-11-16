/**
 * Serves published files for a short-lived content token.
 * Mounted at /artifact-content, outside the OpenAPI surface: the token is the credential.
 */
import type { Context } from 'hono';
import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { ArtifactRequestError, rewrittenHtml, type ArtifactService } from '../artifacts/ArtifactService';
import { verifyArtifactContentToken } from '../artifacts/contentToken';
import { getPublicUiBasePath } from '../config';

const CONTENT_CSP = "sandbox allow-scripts allow-forms; default-src 'self' data: blob: https:; frame-ancestors 'self'";

export function createArtifactContentRouter<TTransaction>(deps: {
  artifactService: ArtifactService<TTransaction>;
}): Hono {
  const router = new Hono();
  router.get('/:token', c => serve({ c, artifactService: deps.artifactService, rawPath: '' }));
  router.get('/:token/*', c => {
    const token = c.req.param('token');
    const marker = `/artifact-content/${token}/`;
    const index = c.req.path.indexOf(marker);
    const rawPath = index < 0 ? undefined : c.req.path.slice(index + marker.length);
    return serve({ c, artifactService: deps.artifactService, rawPath });
  });
  return router;
}

async function serve<TTransaction>(input: {
  c: Context;
  artifactService: ArtifactService<TTransaction>;
  rawPath: string | undefined;
}): Promise<Response> {
  const token = input.c.req.param('token');
  if (token === undefined || token === '') {
    return input.c.text('Not found', 404);
  }
  const verified = verifyArtifactContentToken({ token, signingKey: input.artifactService.signingKey });
  if (verified === undefined) {
    return input.c.text('Not found', 404);
  }
  const filePath = bundlePath(input.rawPath);
  if (filePath === undefined) {
    return input.c.text('Not found', 404);
  }
  try {
    const opened = await input.artifactService.openFile({
      tenantId: verified.tenantId,
      versionId: verified.versionId,
      filePath,
    });
    const headers = {
      'Content-Type': opened.mediaType,
      'Content-Security-Policy': CONTENT_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, max-age=3600',
    };
    if (shouldRewrite(opened.mediaType)) {
      const content = await readText(opened.stream);
      const prefix = getPublicUiBasePath().replace(/\/$/, '');
      const rewritten = rewrittenHtml({
        content,
        files: opened.files.map(file => file.path),
        entryPath: opened.version.entry_path,
        urlPrefix: `${prefix}/artifact-content/${token}`,
      });
      return input.c.body(rewritten, 200, headers);
    }
    return input.c.body(Readable.toWeb(opened.stream), 200, headers);
  } catch (error) {
    if (error instanceof ArtifactRequestError) {
      return input.c.text('Not found', 404);
    }
    throw error;
  }
}

function shouldRewrite(mediaType: string): boolean {
  return mediaType.startsWith('text/html') || mediaType.startsWith('text/css');
}

function bundlePath(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') {
    return '';
  }
  const decoded: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return undefined;
    }
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      return undefined;
    }
  }
  const path = decoded.join('/');
  if (path.includes('\\') || path.includes('\0') || decoded.some(segment => segment.includes('/'))) {
    return undefined;
  }
  return path;
}

async function readText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new Error('Unexpected artifact stream chunk');
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}
