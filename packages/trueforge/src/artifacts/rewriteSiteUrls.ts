import { normalizeBundlePath } from './references';

/**
 * Root-absolute URLs (`/assets/app.css`) would resolve against the TrueForge origin.
 * When that path exists in the bundle, rewrite it under the content prefix so the
 * sandboxed page loads the published file instead.
 */
export function rewriteSiteAbsoluteUrls(input: {
  content: string;
  files: readonly string[];
  /** Bundle-relative directory of the entry file. Empty when the entry sits at the bundle root. */
  entryDirectory: string;
  urlPrefix: string;
}): string {
  const files = new Set(input.files);
  const prefix = input.urlPrefix.replace(/\/$/, '');
  const entryDirectory = input.entryDirectory.replace(/\/$/, '');
  return input.content.replace(/(?<=["'(])\/(?!\/)([A-Za-z0-9._~/-]+)/g, (full, relative: string) => {
    const normalized = normalizeBundlePath(relative);
    if (normalized === undefined) {
      return full;
    }
    const bundlePath = entryDirectory === '' ? normalized : `${entryDirectory}/${normalized}`;
    if (files.has(bundlePath)) {
      return `${prefix}/${bundlePath}`;
    }
    return full;
  });
}
