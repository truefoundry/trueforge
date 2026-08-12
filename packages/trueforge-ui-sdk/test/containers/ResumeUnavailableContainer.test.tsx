// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorToasterProvider, useErrorToaster } from '@/containers/ErrorToasterContainer.js';
import { ResumeUnavailableContainer } from '@/containers/ResumeUnavailableContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

/** Mirrors the runtime error the adapter reports when a turn cannot be streamed. */
function resumeUnsupportedError() {
  return Object.assign(new Error('cannot stream'), { name: 'TurnResumeUnsupportedError' });
}

function ReportButton() {
  const { showError } = useErrorToaster();
  return (
    <button type="button" onClick={() => showError(resumeUnsupportedError())}>
      report
    </button>
  );
}

function renderContainer() {
  render(
    <SlotsProvider>
      <ErrorToasterProvider>
        <ReportButton />
        <ResumeUnavailableContainer />
      </ErrorToasterProvider>
    </SlotsProvider>,
  );
}

describe('ResumeUnavailableContainer', () => {
  it('renders nothing until the runtime reports that resume is unavailable', () => {
    renderContainer();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains that the running response cannot be streamed', async () => {
    renderContainer();

    fireEvent.click(screen.getByRole('button', { name: 'report' }));

    const dialog = await screen.findByRole('dialog', { name: 'Resume unavailable' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/not supported by this backend/i)).toBeInTheDocument();
  });

  it('offers no reload action', async () => {
    renderContainer();

    fireEvent.click(screen.getByRole('button', { name: 'report' }));
    await screen.findByRole('dialog', { name: 'Resume unavailable' });

    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
  });

  it('closes on dismiss', async () => {
    renderContainer();

    fireEvent.click(screen.getByRole('button', { name: 'report' }));
    await screen.findByRole('dialog', { name: 'Resume unavailable' });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
