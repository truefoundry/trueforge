/** Stored `entryPath` is relative to `sourceRoot`. Publish compares the absolute sandbox path. */
export function sandboxEntryPath({ sourceRoot, entryPath }: { sourceRoot: string; entryPath: string }): string {
  if (sourceRoot === '/') {
    return `/${entryPath}`;
  }
  return `${sourceRoot}/${entryPath}`;
}
