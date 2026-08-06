'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryToolResponses } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ASK_USER_CUSTOM_OPTION,
  type AskUserAnswerDraft,
  type Question,
} from '../atoms/adapters/AskUserPromptAdapter.js';

import { useSlot } from '../theme/SlotsProvider.js';

const EMPTY_ANSWER: AskUserAnswerDraft = { radioValue: '', custom: '' };

export function AskUserContainer() {
  const AskUserPrompt = useSlot('AskUserPrompt');
  const { pending, respond } = useTrueFoundryToolResponses();
  const isRunning = useThreadIsRunning();
  const item = pending[0];

  const questions = useMemo<Question[]>(
    () =>
      item == null
        ? []
        : [
            {
              id: item.toolCallId,
              question: item.question ?? 'Answer required',
              options: item.options ?? [],
            },
          ],
    [item],
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AskUserAnswerDraft>>({});

  useEffect(() => {
    setCurrentQuestionIndex(0);
    setAnswers({});
  }, [item?.toolCallId]);

  const safeIndex = Math.min(currentQuestionIndex, Math.max(questions.length - 1, 0));
  const currentQuestion = questions[safeIndex];
  const currentAnswer = currentQuestion == null ? EMPTY_ANSWER : (answers[currentQuestion.id] ?? EMPTY_ANSWER);
  const getResponseForQuestion = useCallback(
    (questionId: string) => {
      const answer = answers[questionId] ?? EMPTY_ANSWER;
      return answer.radioValue === ASK_USER_CUSTOM_OPTION ? answer.custom.trim() : answer.radioValue.trim();
    },
    [answers],
  );
  const allQuestionsAnswered = useMemo(
    () => questions.every(question => getResponseForQuestion(question.id)),
    [getResponseForQuestion, questions],
  );
  const selectedResponse =
    currentAnswer.radioValue === ASK_USER_CUSTOM_OPTION ? currentAnswer.custom.trim() : currentAnswer.radioValue.trim();
  const isSubmitDisabled = isRunning || currentQuestion == null || selectedResponse.length === 0;
  const isSubmitAllDisabled = isSubmitDisabled || !allQuestionsAnswered;

  const onCurrentAnswerChange = useCallback((questionId: string, update: Partial<AskUserAnswerDraft>) => {
    setAnswers(previous => ({
      ...previous,
      [questionId]: {
        ...(previous[questionId] ?? EMPTY_ANSWER),
        ...update,
      },
    }));
  }, []);

  const onSubmit = useCallback(() => {
    if (item == null || !allQuestionsAnswered) return;
    const content = getResponseForQuestion(item.toolCallId);
    if (!content) return;
    respond({ toolCallId: item.toolCallId, content });
  }, [allQuestionsAnswered, getResponseForQuestion, item, respond]);

  if (item == null || currentQuestion == null) return null;

  return (
    <AskUserPrompt
      questions={questions}
      readOnly={isRunning}
      currentQuestion={currentQuestion}
      currentQuestionIndex={safeIndex}
      currentAnswer={currentAnswer}
      totalQuestions={questions.length}
      isMultiQuestion={questions.length > 1}
      isLastQuestion={safeIndex === questions.length - 1}
      allQuestionsAnswered={allQuestionsAnswered}
      isSubmitDisabled={isSubmitDisabled}
      isSubmitAllDisabled={isSubmitAllDisabled}
      onCurrentQuestionIndexChange={setCurrentQuestionIndex}
      onCurrentAnswerChange={onCurrentAnswerChange}
      onSubmit={onSubmit}
    />
  );
}
