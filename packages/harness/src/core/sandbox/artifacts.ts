/**
 * Parses the fenced `sandbox_artifacts` blocks the model is instructed to emit
 * (see Sandbox.buildFileOutputSection) into structured artifact references.
 */
import { z } from '@hono/zod-openapi';
import { hasPathTraversal } from './SandboxErrors';

export const SandboxArtifactSchema = z
  .object({
    label: z.string(),
    /** Absolute path inside the sandbox filesystem. */
    path: z.string(),
  })
  .openapi('SandboxArtifact');

export type SandboxArtifact = z.infer<typeof SandboxArtifactSchema>;

const ARTIFACT_BLOCK_RE = /^[ \t]*```[ \t]*sandbox_artifacts[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
const ARTIFACT_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Model output is untrusted: a path that is relative or escapes via `..` is dropped
 * rather than surfaced, so a malformed block degrades to fewer artifacts instead of
 * handing the download API a path the sandbox never intended to expose.
 */
function isSafeArtifactPath(path: string): boolean {
  return path.startsWith('/') && !hasPathTraversal(path);
}

/**
 * Extracts artifacts from assistant text, in emission order and deduplicated by path
 * (the first label for a path wins). Returns an empty array when the text carries no
 * usable block.
 */
export function parseSandboxArtifacts(text: string): SandboxArtifact[] {
  const byPath = new Map<string, SandboxArtifact>();

  for (const block of text.matchAll(ARTIFACT_BLOCK_RE)) {
    const body = block[1];
    if (body === undefined) {
      continue;
    }
    for (const link of body.matchAll(ARTIFACT_LINK_RE)) {
      const label = link[1]?.trim() ?? '';
      const path = link[2]?.trim();
      if (path === undefined || !isSafeArtifactPath(path) || byPath.has(path)) {
        continue;
      }
      byPath.set(path, { label: label || basename(path), path });
    }
  }

  return [...byPath.values()];
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
