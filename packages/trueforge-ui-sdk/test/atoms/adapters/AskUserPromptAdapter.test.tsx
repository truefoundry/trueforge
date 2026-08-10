// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ASK_USER_CUSTOM_OPTION, AskUserPrompt, type Question } from '@/atoms/adapters/AskUserPromptAdapter.js';

const firstQuestion: Question = {
  id: 'deployment',
  question: 'How should this deploy?',
  options: ['Immediately', 'Schedule it'],
};

const secondQuestion: Question = {
  id: 'region',
  question: 'Which region?',
  options: ['US', 'EU'],
};

describe('AskUserPrompt', () => {
  it('renders nothing without questions or answers, then summarizes answered questions', () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(<AskUserPrompt questions={[]} onSubmit={onSubmit} />);

    expect(container).toBeEmptyDOMElement();

    rerender(
      <AskUserPrompt
        questions={[]}
        answeredQuestions={[
          { ...firstQuestion, answer: 'Immediately', isCustom: false },
          { ...secondQuestion, answer: 'Near the users', isCustom: true },
        ]}
        onSubmit={onSubmit}
        dataTestPrefix="ask"
      />,
    );

    expect(screen.getByTestId('ask-answered-deployment')).toHaveTextContent('Immediately');
    expect(screen.getByTestId('ask-answered-region')).toHaveTextContent('Other: Near the users');
    expect(screen.getAllByText('Answered')).toHaveLength(2);
  });

  it('reports option and custom-answer edits and submits an enabled single question', () => {
    const onCurrentAnswerChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AskUserPrompt
        questions={[firstQuestion]}
        currentQuestion={firstQuestion}
        currentAnswer={{ radioValue: '', custom: '' }}
        isSubmitAllDisabled={false}
        onCurrentAnswerChange={onCurrentAnswerChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Immediately' }));
    expect(onCurrentAnswerChange).toHaveBeenCalledWith('deployment', { radioValue: 'Immediately' });

    const customAnswer = screen.getByRole('textbox', { name: 'Other (custom answer)' });
    fireEvent.focus(customAnswer);
    expect(onCurrentAnswerChange).toHaveBeenCalledWith('deployment', {
      radioValue: ASK_USER_CUSTOM_OPTION,
    });

    fireEvent.change(customAnswer, { target: { value: 'After approval' } });
    expect(onCurrentAnswerChange).toHaveBeenLastCalledWith('deployment', {
      custom: 'After approval',
      radioValue: ASK_USER_CUSTOM_OPTION,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('derives multi-question navigation and prevents premature submission', () => {
    const onCurrentQuestionIndexChange = vi.fn();
    const { rerender } = render(
      <AskUserPrompt
        questions={[firstQuestion, secondQuestion]}
        currentQuestion={secondQuestion}
        currentQuestionIndex={1}
        currentAnswer={{ radioValue: '', custom: '' }}
        onCurrentQuestionIndexChange={onCurrentQuestionIndexChange}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('Which region?')).toBeInTheDocument();
    expect(screen.getByText('Answer all questions to submit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous question' }));
    expect(onCurrentQuestionIndexChange).toHaveBeenCalledWith(0);

    rerender(
      <AskUserPrompt
        questions={[firstQuestion, secondQuestion]}
        currentQuestion={firstQuestion}
        currentQuestionIndex={0}
        currentAnswer={{ radioValue: 'Immediately', custom: '' }}
        isSubmitDisabled={false}
        onCurrentQuestionIndexChange={onCurrentQuestionIndexChange}
        onSubmit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onCurrentQuestionIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('makes an unanswered read-only question non-interactive', () => {
    const onCurrentAnswerChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AskUserPrompt
        questions={[firstQuestion]}
        currentQuestion={firstQuestion}
        currentAnswer={{ radioValue: '', custom: '' }}
        readOnly
        onCurrentAnswerChange={onCurrentAnswerChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText('Unanswered')).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
    expect(screen.getByRole('textbox', { name: 'Other (custom answer)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Immediately' }));
    expect(onCurrentAnswerChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
