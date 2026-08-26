// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomActionContainer } from '@/containers/CustomActionContainer.js';
import {
  CustomActionRenderersProvider,
  type CustomActionRendererProps,
} from '@/server/CustomActionRenderersContext.js';

const useToolResponses = vi.hoisted(() => vi.fn());
const useThreadRunning = vi.hoisted(() => vi.fn());

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryToolResponses: () => useToolResponses(),
}));

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadRunning(),
}));

function SecretSelectProbe({ args, disabled, onSubmit }: CustomActionRendererProps) {
  const secrets = Array.isArray(args.secrets)
    ? args.secrets.filter((value): value is string => typeof value === 'string')
    : [];
  return (
    <section data-testid="secret-select-probe" data-disabled={String(disabled)}>
      <span data-testid="secret-count">{secrets.length}</span>
      <button type="button" disabled={disabled} onClick={() => onSubmit('prod-db')}>
        Choose prod-db
      </button>
      <button type="button" disabled={disabled} onClick={() => onSubmit('   ')}>
        Choose blank
      </button>
    </section>
  );
}

function renderSubject() {
  return render(
    <CustomActionRenderersProvider renderers={{ secret_select: SecretSelectProbe }}>
      <CustomActionContainer />
    </CustomActionRenderersProvider>,
  );
}

describe('CustomActionContainer', () => {
  const respond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useThreadRunning.mockReturnValue(false);
    useToolResponses.mockReturnValue({ pending: [], respond });
  });

  it('renders nothing while there is no pending tool response', () => {
    renderSubject();
    expect(screen.queryByTestId('secret-select-probe')).not.toBeInTheDocument();
  });

  it('renders nothing when the pending tool has no registered renderer', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'tc-1', toolName: 'ask_user_question', args: {} }],
      respond,
    });
    renderSubject();
    expect(screen.queryByTestId('secret-select-probe')).not.toBeInTheDocument();
  });

  it('renders the host component and resumes with trimmed content', () => {
    useToolResponses.mockReturnValue({
      pending: [
        {
          toolCallId: 'tc-secret',
          toolName: 'secret_select',
          args: { secrets: ['prod-db', 'staging-db'] },
        },
      ],
      respond,
    });
    renderSubject();

    expect(screen.getByTestId('secret-select-probe')).toBeInTheDocument();
    expect(screen.getByTestId('secret-count')).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('button', { name: 'Choose blank' }));
    expect(respond).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose prod-db' }));
    expect(respond).toHaveBeenCalledWith({ toolCallId: 'tc-secret', content: 'prod-db' });
  });

  it('disables the host component while the thread is running', () => {
    useThreadRunning.mockReturnValue(true);
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'tc-secret', toolName: 'secret_select', args: {} }],
      respond,
    });
    renderSubject();

    expect(screen.getByTestId('secret-select-probe')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Choose prod-db' })).toBeDisabled();
  });
});
