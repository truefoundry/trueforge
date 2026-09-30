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

/**
 * Loads the open sandbox file once per target. The object URL created for images
 * and PDFs is revoked when that request is dropped.
 */
export function useLoadedFilePreview(target: SandboxFilePreviewTarget | null, reloadToken: number): LoadedFilePreview {
  const [loaded, setLoaded] = useState<LoadedFilePreview>({ view: { status: 'loading' }, blob: null });

  useEffect(() => {
    if (target == null) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoaded({ view: { status: 'loading' }, blob: null });

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
            blob,
            view: { status: 'media', media: result.media, objectUrl },
          });
          return;
        }
        setLoaded({ blob, view: result });
      } catch {
        if (!cancelled) {
          setLoaded({ blob: null, view: { status: 'error', message: LOAD_ERROR_MESSAGE } });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl != null) URL.revokeObjectURL(objectUrl);
    };
  }, [target, reloadToken]);

  return loaded;
}
