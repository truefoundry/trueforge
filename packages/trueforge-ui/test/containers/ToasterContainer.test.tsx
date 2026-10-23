import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { Toast } from '@/atoms/Toast.js';
import { ToasterProvider, useToaster, useToasterOptional } from '@/containers/ToasterContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function Trigger({ errors }: { errors: unknown[] }) {
  const { showError } = useToaster();
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

function renderToaster(ui: ReactNode) {
  return render(
    <SlotsProvider>
      <AnalyticsProvider>
        <ToasterProvider>{ui}</ToasterProvider>
      </AnalyticsProvider>
    </SlotsProvider>,
  );
}

describe('ToasterProvider', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a provider for useToaster while the optional hook returns null', () => {
    expect(() => renderHook(() => useToaster())).toThrow('useToaster must be used within ToasterProvider');

    const { result } = renderHook(() => useToasterOptional());
    expect(result.current).toBeNull();
  });

  it('stacks multiple error toasts', async () => {
    renderToaster(<Trigger errors={[new Error('first'), new Error('second')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('dismisses one toast without removing the other', async () => {
    renderToaster(<Trigger errors={[new Error('keep-me'), new Error('drop-me')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));
    expect(await screen.findByText('drop-me')).toBeTruthy();

    const dropToast = screen.getByText('drop-me').closest("[role='alert']");
    expect(dropToast).toBeTruthy();
    const closeButton = dropToast?.querySelector('[aria-label="Close"]');
    if (closeButton === null || closeButton === undefined) {
      throw new Error('Expected close button');
    }
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText('drop-me')).toBeNull();
    });
    expect(screen.getByText('keep-me')).toBeTruthy();
  });

  it('formats HTTP-like status and response body details', async () => {
    const httpError = Object.assign(new Error('request failed'), {
      statusCode: 422,
      body: { detail: 'invalid agent' },
    });

    renderToaster(<Trigger errors={[httpError]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findByText('Request failed (422)')).toBeInTheDocument();
    expect(screen.getByText(/"detail":"invalid agent"/)).toBeInTheDocument();
  });

  it('extracts nested error.message from HTTP body', async () => {
    const httpError = Object.assign(new Error('Status code: 409'), {
      statusCode: 409,
      body: { error: { message: 'Name taken' } },
    });

    renderToaster(<Trigger errors={[httpError]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findByText('Request failed (409)')).toBeInTheDocument();
    expect(screen.getByText('Name taken')).toBeInTheDocument();
  });

  it('keeps only the five most recent errors visible', async () => {
    const errors = Array.from({ length: 6 }, (_, index) => new Error(`error-${index + 1}`));

    renderToaster(<Trigger errors={errors} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findAllByRole('alert')).toHaveLength(5);
    expect(screen.queryByText('error-1')).not.toBeInTheDocument();
    expect(screen.getByText('error-6')).toBeInTheDocument();
  });

  it('shows a clear toast for SDK HTTP timeouts and leaves ordinary errors generic', async () => {
    const timeoutError = Object.assign(new Error('Timeout exceeded when calling POST /v1/sessions.'), {
      name: 'TrueForgeTimeoutError',
    });

    renderToaster(<Trigger errors={[new Error('ordinary'), timeoutError]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('ordinary')).toBeInTheDocument();
    expect(screen.getByText('Request timed out')).toBeInTheDocument();
    expect(screen.getByText('The request took too long and was cancelled. Try again.')).toBeInTheDocument();
  });

  it('replaces a JSON-quoted timeout from TrueForgeError', async () => {
    const error = Object.assign(new Error('"timeout"'), { name: 'TrueForgeError' });

    renderToaster(<Trigger errors={[error]} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findByText('Request timed out')).toBeInTheDocument();
    expect(screen.getByText('The request took too long and was cancelled. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('"timeout"')).not.toBeInTheDocument();
  });

  it('replaces a bare timeout message with clear toast copy', async () => {
    renderToaster(<Trigger errors={[new Error('timeout'), 'timeout']} />);

    fireEvent.click(screen.getByRole('button', { name: 'boom' }));

    expect(await screen.findAllByText('Request timed out')).toHaveLength(2);
    expect(screen.getAllByText('The request took too long and was cancelled. Try again.')).toHaveLength(2);
    expect(screen.queryByText('timeout')).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
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
