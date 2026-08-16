// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ASK_USER_CUSTOM_OPTION, type AskUserPromptProps } from '@/atoms/adapters/AskUserPromptAdapter.js';
import { AskUserContainer } from '@/containers/AskUserContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const useToolResponses = vi.hoisted(() => vi.fn());
const useThreadRunning = vi.hoisted(() => vi.fn());

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryToolResponses: () => useToolResponses(),
}));

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadRunning(),
}));

function AskUserPromptProbe({
  currentQuestion,
  currentAnswer,
  readOnly,
  isSubmitDisabled,
  isSubmitAllDisabled,
  allQuestionsAnswered,
  onCurrentAnswerChange,
  onSubmit,
}: AskUserPromptProps) {
  return (
    <section
      data-testid="ask-user-probe"
      data-question={currentQuestion?.question}
      data-options={currentQuestion?.options.join('|')}
      data-read-only={String(readOnly)}
      data-answer={currentAnswer?.radioValue}
      data-custom={currentAnswer?.custom}
      data-all-answered={String(allQuestionsAnswered)}
    >
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          if (currentQuestion !== undefined) {
            onCurrentAnswerChange?.(currentQuestion.id, { radioValue: 'Proceed' });
          }
        }}
      >
        Choose Proceed
      </button>
      <input
        aria-label="Custom response"
        disabled={readOnly}
        value={currentAnswer?.custom ?? ''}
        onChange={event => {
          if (currentQuestion !== undefined) {
            onCurrentAnswerChange?.(currentQuestion.id, {
              radioValue: ASK_USER_CUSTOM_OPTION,
              custom: event.target.value,
            });
          }
        }}
      />
      <button type="button" disabled={isSubmitDisabled || isSubmitAllDisabled} onClick={onSubmit}>
        Submit response
      </button>
    </section>
  );
}

function renderSubject() {
  return render(
    <SlotsProvider overrides={{ AskUserPrompt: AskUserPromptProbe }}>
      <AskUserContainer />
    </SlotsProvider>,
  );
}

describe('AskUserContainer', () => {
  const respond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useThreadRunning.mockReturnValue(false);
    useToolResponses.mockReturnValue({ pending: [], respond });
  });

  it('renders nothing while there is no pending question', () => {
    renderSubject();

    expect(screen.queryByTestId('ask-user-probe')).not.toBeInTheDocument();
  });

  it('maps the first pending question and submits the selected option', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-1', question: 'Continue?', options: ['Proceed', 'Stop'] }],
      respond,
    });
    renderSubject();

    const probe = screen.getByTestId('ask-user-probe');
    expect(probe).toHaveAttribute('data-question', 'Continue?');
    expect(probe).toHaveAttribute('data-options', 'Proceed|Stop');
    expect(probe).toHaveAttribute('data-all-answered', 'false');
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose Proceed' }));

    expect(probe).toHaveAttribute('data-answer', 'Proceed');
    expect(probe).toHaveAttribute('data-all-answered', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(respond).toHaveBeenCalledWith({ toolCallId: 'question-1', content: 'Proceed' });
  });

  it('trims a custom response and resets draft state for the next pending tool call', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-1', question: 'Why?', options: [] }],
      respond,
    });
    const { rerender } = renderSubject();

    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), {
      target: { value: '  because it is safer  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(respond).toHaveBeenCalledWith({
      toolCallId: 'question-1',
      content: 'because it is safer',
    });

    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-2', question: undefined, options: undefined }],
      respond,
    });
    rerender(
      <SlotsProvider overrides={{ AskUserPrompt: AskUserPromptProbe }}>
        <AskUserContainer />
      </SlotsProvider>,
    );

    expect(screen.getByTestId('ask-user-probe')).toHaveAttribute('data-question', 'Answer required');
    expect(screen.getByTestId('ask-user-probe')).toHaveAttribute('data-answer', '');
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeDisabled();
  });

  it('maps a running thread to read-only pending state', () => {
    useThreadRunning.mockReturnValue(true);
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-1', question: 'Continue?', options: ['Proceed'] }],
      respond,
    });
    renderSubject();

    expect(screen.getByTestId('ask-user-probe')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByRole('button', { name: 'Choose Proceed' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Custom response' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeDisabled();
  });
});
