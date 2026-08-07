import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Toast } from '../atoms/Toast.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { ErrorToasterProvider, useErrorToaster } from './ErrorToasterContainer.js';

function Trigger({ errors }: { errors: unknown[] }) {
  const { showError } = useErrorToaster();
  return (
    <button
      type="button"
      onClick={() => {
        for (const error of errors) showError(error);
      }}
    >
      boom
    </button>
  );
}

describe('ErrorToasterProvider', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stacks multiple error toasts', async () => {
    render(
      <SlotsProvider>
        <ErrorToasterProvider>
          <Trigger errors={[new Error('first'), new Error('second')]} />
        </ErrorToasterProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('dismisses one toast without removing the other', async () => {
    render(
      <SlotsProvider>
        <ErrorToasterProvider>
          <Trigger errors={[new Error('keep-me'), new Error('drop-me')]} />
        </ErrorToasterProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));
    expect(await screen.findByText('drop-me')).toBeTruthy();

    const dropToast = screen.getByText('drop-me').closest("[role='alert']");
    expect(dropToast).toBeTruthy();
    fireEvent.click(dropToast!.querySelector('[aria-label="Close"]')!);

    await waitFor(() => {
      expect(screen.queryByText('drop-me')).toBeNull();
    });
    expect(screen.getByText('keep-me')).toBeTruthy();
  });
});

describe('Toast copy', () => {
  it('copies title and description', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <SlotsProvider>
        <Toast title="Request failed" description="body detail" open onOpenChange={() => {}} />
      </SlotsProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(writeText).toHaveBeenCalledWith('Request failed\nbody detail');
  });
});
