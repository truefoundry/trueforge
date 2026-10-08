import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageErrorBanner } from '@/atoms/MessageErrorBanner.js';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

describe('MessageErrorBanner', () => {
  it('announces the supplied error and preserves host styling', () => {
    render(<MessageErrorBanner message="The response could not be generated" className="host-error" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The response could not be generated');
    expect(alert).toHaveClass('aui-message-error-root', 'host-error');
    expect(alert.firstElementChild).toHaveClass('aui-message-error-message');
  });

  it('shows only the message when there is no detail', () => {
    render(<MessageErrorBanner message="The model provider did not respond in time." />);

    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the raw text available behind a disclosure', () => {
    render(
      <MessageErrorBanner
        message="The model provider did not respond in time."
        detail="terminated: Body Timeout Error"
        code="model_timeout"
      />,
    );

    expect(screen.getByText('Show details')).toBeInTheDocument();
    expect(screen.getByText('[model_timeout] terminated: Body Timeout Error')).toBeInTheDocument();
  });

  it('does not offer a disclosure when the detail only repeats the message', () => {
    render(<MessageErrorBanner message="Something broke" detail="Something broke" />);

    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
  });

  it('copies the code and raw detail together so a report identifies the failure', () => {
    render(<MessageErrorBanner message="Timed out" detail="terminated: Body Timeout Error" code="model_timeout" />);

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('[model_timeout] terminated: Body Timeout Error');
  });
});
