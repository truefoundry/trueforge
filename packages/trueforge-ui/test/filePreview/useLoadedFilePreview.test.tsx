// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SandboxFilePreviewTarget } from '@/filePreview/FilePreviewContext.js';
import { useLoadedFilePreview } from '@/filePreview/useLoadedFilePreview.js';

function deferredFile({ path, text }: { path: string; text: string }) {
  let resolve: (blob: Blob) => void = () => undefined;
  const pending = new Promise<Blob>(done => {
    resolve = done;
  });
  const target: SandboxFilePreviewTarget = {
    name: 'Label',
    path,
    turnId: 'turn-1',
    load: () => pending,
  };
  return { target, finish: () => resolve(new Blob([text])) };
}

function Probe({ target }: { target: SandboxFilePreviewTarget | null }) {
  const loaded = useLoadedFilePreview(target, 0);
  const text = loaded.view.status === 'text' || loaded.view.status === 'html' ? loaded.view.text : '';
  return (
    <div
      data-testid="preview"
      data-status={loaded.view.status}
      data-blob={loaded.blob == null ? 'none' : 'set'}
      data-text={text}
    />
  );
}

describe('useLoadedFilePreview', () => {
  it('drops the previous file before the next one loads', async () => {
    const first = deferredFile({ path: '/tmp/a.txt', text: 'alpha' });
    const second = deferredFile({ path: '/tmp/b.txt', text: 'beta' });
    const { rerender } = render(<Probe target={first.target} />);

    expect(screen.getByTestId('preview')).toHaveAttribute('data-status', 'loading');
    expect(screen.getByTestId('preview')).toHaveAttribute('data-blob', 'none');

    await act(async () => {
      first.finish();
    });
    await waitFor(() => {
      expect(screen.getByTestId('preview')).toHaveAttribute('data-text', 'alpha');
    });

    rerender(<Probe target={second.target} />);
    expect(screen.getByTestId('preview')).toHaveAttribute('data-status', 'loading');
    expect(screen.getByTestId('preview')).toHaveAttribute('data-blob', 'none');
    expect(screen.getByTestId('preview')).toHaveAttribute('data-text', '');

    rerender(<Probe target={null} />);
    expect(screen.getByTestId('preview')).toHaveAttribute('data-blob', 'none');
  });
});
