'use client';

import { useEffect, useState } from 'react';

import type { FilePreviewView } from '../atoms/FilePreviewPanel.js';
import type { SandboxFilePreviewTarget } from './FilePreviewContext.js';
import { blobWithMimeType, readFilePreview } from './readFilePreview.js';

export type LoadedFilePreview = {
  view: FilePreviewView;
  /** Bytes already fetched for this target, reused by the panel download control. */
  blob: Blob | null;
};

const LOAD_ERROR_MESSAGE = "Couldn't load a preview of this file.";
const EMPTY_LOADED: LoadedFilePreview = { view: { status: 'loading' }, blob: null };

function loadedKey(target: SandboxFilePreviewTarget | null, reloadToken: number): string | null {
  if (target == null) return null;
  return `${target.turnId}\0${target.path}\0${reloadToken}`;
}

/**
 * Loads the open sandbox file once per target. The object URL created for images
 * and PDFs is revoked when that request is dropped.
 *
 * The host stays mounted across close and open, so a result for a different file
 * is dropped during render. Otherwise the new title can paint the previous bytes,
 * and download can save them under the new path.
 */
export function useLoadedFilePreview(target: SandboxFilePreviewTarget | null, reloadToken: number): LoadedFilePreview {
  const key = loadedKey(target, reloadToken);
  const [loaded, setLoaded] = useState<LoadedFilePreview & { key: string | null }>({
    key: null,
    ...EMPTY_LOADED,
  });
  if (loaded.key !== key) {
    setLoaded({ key, ...EMPTY_LOADED });
  }

  useEffect(() => {
    if (target == null || key == null) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoaded({ key, ...EMPTY_LOADED });

    void (async () => {
      try {
        const blob = await target.load();
        if (cancelled) return;
        const result = await readFilePreview(blob, { name: target.name, path: target.path });
        if (cancelled) return;
        if (result.status === 'media') {
          objectUrl = URL.createObjectURL(blobWithMimeType(blob, result.mimeType));
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setLoaded({
            key,
            blob,
            view: { status: 'media', media: result.media, objectUrl },
          });
          return;
        }
        setLoaded({ key, blob, view: result });
      } catch {
        if (!cancelled) {
          setLoaded({ key, blob: null, view: { status: 'error', message: LOAD_ERROR_MESSAGE } });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl != null) URL.revokeObjectURL(objectUrl);
    };
  }, [target, reloadToken, key]);

  return loaded.key === key ? loaded : EMPTY_LOADED;
}
