/** Last path segment, so a human chip label cannot drop the file extension. */
export function filenameFromPath(path: string): string {
  const base = path.split('/').pop() ?? '';
  return base.length > 0 ? base : 'download';
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
