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
            <div className="flex items-center justify-between rounded-t-lg border border-primary/30 bg-primary/10 px-4 py-2">
              <div className="font-sans text-xs font-medium text-primary">{q.question}</div>
              <div className="flex h-fit shrink-0 items-center gap-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                <span className="leading-tight">Answered</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-b-lg border border-t-0 border-border px-4 py-3">
              <Icon name="circle-check" size="0.875em" className="shrink-0 text-primary" />
              <span className="font-sans text-[0.8125rem] font-medium text-foreground">
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

  const handleOptionSelect = (value: string) => {
    if (readOnly) return;
    onCurrentAnswerChange?.(currentQuestion.id, { radioValue: value });
  };

  return (
    <div
      className={cn('aui-ask-user-prompt', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-question-card` : undefined}
    >
      <div className="flex items-center justify-between rounded-t-lg border border-primary/30 bg-primary/10 px-4 py-2">
        <div className="font-sans text-sm font-medium text-primary">
          {totalQuestions > 1 ? 'Questions' : currentQuestion.question}
        </div>
        {readOnly ? (
          <div className="flex h-fit shrink-0 items-center gap-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
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
              className="text-foreground"
            >
              <Icon name="chevron-left" size="0.75em" />
            </IconButton>
            <IconButton
              aria-label="Next question"
              variant="ghost"
              onClick={() => onCurrentQuestionIndexChange?.(Math.min(totalQuestions - 1, currentQuestionIndex + 1))}
              disabled={currentQuestionIndex === totalQuestions - 1}
              className="text-foreground"
            >
              <Icon name="chevron-right" size="0.75em" />
            </IconButton>
            <div className="ml-1 rounded bg-primary/20 px-2 py-1 font-sans text-xs font-medium text-foreground">
              <span> {currentQuestionIndex + 1} </span> <span> of </span> <span> {totalQuestions} </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-b-lg border border-t-0 border-border px-4 py-3">
        <div className="flex flex-col gap-3">
          {isMultiQuestion && (
            <div className="font-sans text-xs font-medium text-foreground">
              {currentQuestion.question || 'What would you like to do?'}
            </div>
          )}
          <div
            className="flex flex-col gap-3 overflow-visible"
            role="radiogroup"
            aria-label={currentQuestion.question || 'Answer options'}
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
                    className="mt-0.5 accent-primary"
                  />
                  <span className="min-w-0 font-sans text-[0.8125rem] font-medium leading-snug text-foreground">
                    {opt}
                  </span>
                </label>
              );
            })}

            <label
              className={cn(
                'flex items-center gap-x-2 overflow-visible',
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
                className="accent-primary"
              />
              <div className="min-w-0 flex-1">
                <input
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
                  placeholder="Other"
                  aria-label="Other (custom answer)"
                  className={cn(
                    'h-6 w-full rounded border border-input bg-background px-2 text-[0.8125rem] text-foreground',
                    'placeholder:text-[0.8125rem] focus:outline-none focus:ring-1 focus:ring-ring',
                  )}
                />
              </div>
            </label>
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
              <span className="text-xs font-medium text-destructive">Answer all questions to submit</span>
            ) : (
              <span />
            )}
            {isMultiQuestion && !isLastQuestion ? (
              <Button
                type="button"
                size="sm"
                onClick={() => onCurrentQuestionIndexChange?.(currentQuestionIndex + 1)}
                disabled={isSubmitDisabled}
              >
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
