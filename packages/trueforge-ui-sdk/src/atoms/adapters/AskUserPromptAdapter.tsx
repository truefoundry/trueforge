import type { KeyboardEvent } from 'react';
import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';

export type Question = {
  id: string;
  question: string;
  options: string[];
};

export type AnsweredQuestion = Question & {
  answer: string;
  isCustom: boolean;
};

export type AskUserAnswerDraft = {
  radioValue: string;
  custom: string;
};

export const ASK_USER_CUSTOM_OPTION = '__tfy_ask_user_question_custom__';

export type AskUserPromptProps = {
  questions: Question[];
  answeredQuestions?: AnsweredQuestion[];
  onSubmit: () => void;
  currentQuestion?: Question;
  currentQuestionIndex?: number;
  currentAnswer?: AskUserAnswerDraft;
  totalQuestions?: number;
  isMultiQuestion?: boolean;
  isLastQuestion?: boolean;
  allQuestionsAnswered?: boolean;
  isSubmitDisabled?: boolean;
  isSubmitAllDisabled?: boolean;
  onCurrentQuestionIndexChange?: (index: number) => void;
  onCurrentAnswerChange?: (questionId: string, update: Partial<AskUserAnswerDraft>) => void;
  readOnly?: boolean;
  dataTestPrefix?: string;
  className?: string;
};

export function AskUserPrompt({
  questions,
  answeredQuestions = [],
  onSubmit,
  currentQuestion,
  currentQuestionIndex = 0,
  currentAnswer = { radioValue: '', custom: '' },
  totalQuestions = questions.length,
  isMultiQuestion: isMultiQuestionProp,
  isLastQuestion: isLastQuestionProp,
  allQuestionsAnswered = false,
  isSubmitDisabled = true,
  isSubmitAllDisabled = true,
  onCurrentQuestionIndexChange,
  onCurrentAnswerChange,
  readOnly = false,
  dataTestPrefix,
  className,
}: AskUserPromptProps) {
  const isMultiQuestion = isMultiQuestionProp ?? totalQuestions > 1;
  const isLastQuestion = isLastQuestionProp ?? currentQuestionIndex === totalQuestions - 1;

  if (questions.length === 0) {
    if (answeredQuestions.length === 0) return null;
    return (
      <div className={cn('aui-ask-user-prompt mt-2 flex flex-col gap-3', className)}>
        {answeredQuestions.map(q => (
          <div key={q.id} data-testid={dataTestPrefix ? `${dataTestPrefix}-answered-${q.id}` : undefined}>
            <div className="flex items-center justify-between rounded-t-lg border border-primary-button-bg/30 bg-primary-button-bg/10 px-4 py-2">
              <div className="font-sans text-xs font-medium text-primary-button-bg">{q.question}</div>
              <div className="flex h-fit shrink-0 items-center gap-1 rounded border border-primary-button-bg/40 bg-primary-bg px-2 py-0.5 text-[0.6875rem] font-medium text-text-secondary">
                <span className="leading-tight">Answered</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-b-lg border border-t-0 border-border px-4 py-3">
              <Icon name="circle-check" size="0.875em" className="shrink-0 text-primary-button-bg" />
              <span className="font-sans text-[0.8125rem] font-medium text-text-primary">
                {q.isCustom ? `Other: ${q.answer}` : q.answer}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!currentQuestion) return null;

  const isCustomSelected = currentAnswer.radioValue === ASK_USER_CUSTOM_OPTION;
  const hasOptions = currentQuestion.options.length > 0;

  const handleOptionSelect = (value: string) => {
    if (readOnly) return;
    onCurrentAnswerChange?.(currentQuestion.id, { radioValue: value });
  };

  const goToNextQuestion = () => onCurrentQuestionIndexChange?.(currentQuestionIndex + 1);
  const isNextStep = isMultiQuestion && !isLastQuestion;

  const handleAnswerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || readOnly) return;
    event.preventDefault();
    if (isNextStep) {
      if (!isSubmitDisabled) goToNextQuestion();
      return;
    }
    if (!isSubmitAllDisabled) onSubmit();
  };

  const answerInput = (
    <textarea
      rows={1}
      value={currentAnswer.custom}
      disabled={readOnly || !currentQuestion.id}
      onFocus={() =>
        onCurrentAnswerChange?.(currentQuestion.id, {
          radioValue: ASK_USER_CUSTOM_OPTION,
        })
      }
      onChange={e => {
        onCurrentAnswerChange?.(currentQuestion.id, {
          custom: e.target.value,
          radioValue: ASK_USER_CUSTOM_OPTION,
        });
      }}
      placeholder={hasOptions ? 'Other' : 'Type your answer'}
      aria-label={hasOptions ? 'Other (custom answer)' : 'Your answer'}
      className={cn(
        'field-sizing-content min-h-6 max-h-[3lh] w-full resize-none overflow-y-auto rounded border border-input-border bg-primary-bg px-2 py-0.5 text-[0.8125rem] leading-snug text-text-primary',
        'placeholder:text-[0.8125rem] focus:outline-none focus:ring-1 focus:ring-focus-ring',
      )}
    />
  );

  return (
    <div
      className={cn('aui-ask-user-prompt', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-question-card` : undefined}
    >
      <div className="flex items-center justify-between rounded-t-lg border border-primary-button-bg/30 bg-primary-button-bg/10 px-4 py-2">
        <div className="font-sans text-sm font-medium text-primary-button-bg">
          {totalQuestions > 1 ? 'Questions' : currentQuestion.question}
        </div>
        {readOnly ? (
          <div className="flex h-fit shrink-0 items-center gap-1 rounded border border-primary-button-bg/40 bg-primary-bg px-2 py-0.5 text-[0.6875rem] font-medium text-text-secondary">
            <span className="leading-tight">Unanswered</span>
          </div>
        ) : null}
        {!readOnly && isMultiQuestion && (
          <div className="flex items-center gap-1">
            <IconButton
              aria-label="Previous question"
              variant="ghost"
              onClick={() => onCurrentQuestionIndexChange?.(Math.max(0, currentQuestionIndex - 1))}
              disabled={currentQuestionIndex === 0}
              className="text-text-primary"
            >
              <Icon name="chevron-left" size="0.75em" />
            </IconButton>
            <IconButton
              aria-label="Next question"
              variant="ghost"
              onClick={() => onCurrentQuestionIndexChange?.(Math.min(totalQuestions - 1, currentQuestionIndex + 1))}
              disabled={currentQuestionIndex === totalQuestions - 1}
              className="text-text-primary"
            >
              <Icon name="chevron-right" size="0.75em" />
            </IconButton>
            <div className="ml-1 rounded bg-primary-button-bg/20 px-2 py-1 font-sans text-xs font-medium text-text-primary">
              <span> {currentQuestionIndex + 1} </span> <span> of </span> <span> {totalQuestions} </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-b-lg border border-t-0 border-border px-4 py-3">
        <div className="flex flex-col gap-3">
          {isMultiQuestion && (
            <div className="font-sans text-xs font-medium text-text-primary">
              {currentQuestion.question || 'What would you like to do?'}
            </div>
          )}
          <div
            className="flex flex-col gap-3 overflow-visible"
            role={hasOptions ? 'radiogroup' : undefined}
            aria-label={hasOptions ? currentQuestion.question || 'Answer options' : undefined}
            onKeyDown={handleAnswerKeyDown}
          >
            {currentQuestion.options.map((opt, index) => {
              const isSelected = currentAnswer.radioValue === opt;
              return (
                <label
                  key={`${index}:${opt}`}
                  className={cn(
                    'flex w-fit items-start gap-x-2 overflow-visible',
                    readOnly ? 'cursor-default' : 'cursor-pointer',
                  )}
                >
                  <input
                    type="radio"
                    value={opt}
                    disabled={readOnly || !currentQuestion.id}
                    name={`ask-user-question-option-${currentQuestion.id}`}
                    checked={isSelected}
                    onChange={() => handleOptionSelect(opt)}
                    className="mt-0.5 accent-primary-button-bg"
                  />
                  <span className="min-w-0 font-sans text-[0.8125rem] font-medium leading-snug text-text-primary">
                    {opt}
                  </span>
                </label>
              );
            })}

            {hasOptions ? (
              <label
                className={cn(
                  'flex items-start gap-x-2 overflow-visible',
                  readOnly ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                <input
                  type="radio"
                  disabled={readOnly || !currentQuestion.id}
                  value={ASK_USER_CUSTOM_OPTION}
                  name={`ask-user-question-option-${currentQuestion.id}`}
                  checked={isCustomSelected}
                  onChange={() => handleOptionSelect(ASK_USER_CUSTOM_OPTION)}
                  className="mt-1 accent-primary-button-bg"
                />
                <div className="min-w-0 flex-1">{answerInput}</div>
              </label>
            ) : (
              answerInput
            )}
          </div>
        </div>

        {!readOnly && (
          <div
            className={cn('flex items-center', {
              'justify-between': isMultiQuestion,
              'justify-start': !isMultiQuestion,
            })}
          >
            {isMultiQuestion && isLastQuestion && !allQuestionsAnswered ? (
              <span className="text-xs font-medium text-failure-bg">Answer all questions to submit</span>
            ) : (
              <span />
            )}
            {isNextStep ? (
              <Button type="button" size="sm" onClick={goToNextQuestion} disabled={isSubmitDisabled}>
                Next
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={onSubmit} disabled={isSubmitAllDisabled}>
                Submit
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AskUserPrompt: typeof AskUserPrompt;
  }
}
