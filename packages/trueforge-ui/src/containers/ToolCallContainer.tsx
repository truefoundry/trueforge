'use client';

import {
  MessagePartPrimitive,
  MessagePrimitive,
  useToolCallElapsed,
  type ToolApprovalResponse,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import { useTrueFoundryRespondToToolApproval } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useState } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import {
  ASK_USER_TOOL_NAME,
  MCP_META_TOOLS,
  SANDBOX_TOOL_NAMES,
  SUB_AGENT_TOOL_NAME,
  buildApprovalOptions,
  formatDuration,
  getAskUserAnswerResult,
  getJsonDisplayValue,
  getToolResultContent,
  hasPendingAskUserResponse,
  hasPendingToolApproval,
  mcpDisplayName,
  parseAskUserQuestionArgs,
  parseMcpToolArgs,
  parseSandboxArgs,
  parseSandboxResult,
  resolveSubAgentMeta,
  toStatus,
} from '../utils/toolCallParsing.js';
import { useRegisterApprovalExpand } from './approvalFocus.js';
import { AssistantTextContainer } from './AssistantTextContainer.js';
import { NestedApprovalBridgeContext, useNestedApprovalBridge } from './nestedApprovalBridge.js';
import { SandboxToolCallContainer } from './SandboxToolCallContainer.js';
import { ToolApprovalContainer } from './ToolApprovalContainer.js';
import { ToolCallContentBlockContainer } from './ToolCallContentBlockContainer.js';

function NestedSubAgentAssistantMessage() {
  const AssistantMessageBubble = useSlot('AssistantMessageBubble');

  return (
    <div className="mb-3 min-w-0">
      <MessagePrimitive.Root data-role="assistant">
        <AssistantMessageBubble>
          <MessagePrimitive.Parts
            components={{
              Text: AssistantTextContainer,
              Reasoning: AssistantTextContainer,
              tools: { Fallback: ToolCallContainer },
            }}
          />
        </AssistantMessageBubble>
      </MessagePrimitive.Root>
    </div>
  );
}

function ToolApprovalSlot({ part }: { part: ToolCallMessagePartProps }) {
  const isNestedReadonly = useNestedApprovalBridge();
  const respondToNestedApproval = useTrueFoundryRespondToToolApproval();

  const respond = (response: ToolApprovalResponse) => {
    if (!isNestedReadonly) {
      part.respondToApproval(response);
      return;
    }
    // Readonly nested thread: use this part's approval id, not the outer
    // create_sub_agent tool (which usually has no approval of its own).
    if (part.approval == null) return;

    let approved: boolean | undefined;
    let optionId: string | undefined;
    if ('approved' in response) {
      approved = response.approved;
    } else if ('optionId' in response) {
      const option = buildApprovalOptions(part.approval.options).find(o => o.id === response.optionId);
      if (option == null) return;
      approved = option.isAllow;
      optionId = response.optionId;
    }
    if (approved === undefined) return;

    respondToNestedApproval({
      approvalId: part.approval.id,
      approved,
      ...(optionId != null && optionId !== '__allow' && optionId !== '__deny' ? { optionId } : {}),
      ...('reason' in response && response.reason != null ? { reason: response.reason } : {}),
    });
  };

  const onSelectOption = (optionId: string, reason?: string) => {
    if (optionId === '__allow') return respond({ approved: true });
    if (optionId === '__deny') return respond({ approved: false, reason });
    return respond({ optionId, reason });
  };

  return (
    <ToolApprovalContainer
      toolName={part.toolName}
      argsText={part.argsText}
      approvalId={part.approval?.id}
      options={
        buildApprovalOptions(part.approval?.options) as import('./ToolApprovalContainer.js').ToolApprovalOption[]
      }
      onSelectOption={onSelectOption}
    />
  );
}

function RequestResponseSlots({
  request,
  response,
}: {
  request: { value: string; isJson: boolean };
  response: { data: string; isJson: boolean };
}) {
  return {
    requestSlot: request.value ? (
      <ToolCallContentBlockContainer
        title="Request"
        content={request.value}
        isJson={request.isJson}
        maxHeight="10.5rem"
      />
    ) : response.data ? (
      <ToolCallContentBlockContainer title="Request" content="{}" isJson maxHeight="10.5rem" />
    ) : undefined,
    responseSlot: response.data ? (
      <ToolCallContentBlockContainer title="Response" content={response.data} isJson={response.isJson} resizable />
    ) : undefined,
  };
}

export const ToolCallContainer: ToolCallMessagePartComponent = part => {
  const ToolCallCard = useSlot('ToolCallCard');
  const SubAgentCard = useSlot('SubAgentCard');
  const AskUserPrompt = useSlot('AskUserPrompt');
  const elapsedMs = useToolCallElapsed();
  const isRequiresAction = part.status?.type === 'requires-action';
  const isSubAgent = part.toolName === SUB_AGENT_TOOL_NAME;
  const isSandbox = SANDBOX_TOOL_NAMES.has(part.toolName);
  const [expanded, setExpanded] = useState(isRequiresAction);
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction);
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction);
    if (isRequiresAction) setExpanded(true);
  }

  const showApproval = isRequiresAction && hasPendingToolApproval(part.approval);

  const durationText = elapsedMs === undefined ? undefined : formatDuration(elapsedMs);
  const status = toStatus(part.status?.type);
  const onToggle = () => setExpanded(prev => !prev);
  const expandSubAgent = useCallback(() => setExpanded(true), []);
  useRegisterApprovalExpand(isSubAgent ? part.toolCallId : '', expandSubAgent);

  if (part.toolName === ASK_USER_TOOL_NAME) {
    if (hasPendingAskUserResponse(part)) {
      return null;
    }
    const answer = getAskUserAnswerResult(part.result);
    if (answer == null) {
      return null;
    }
    const { question, options = [] } = parseAskUserQuestionArgs(part.argsText);
    const isCustom = options.length > 0 && !options.includes(answer);
    return (
      <AskUserPrompt
        questions={[]}
        answeredQuestions={[
          {
            id: part.toolCallId,
            question: question ?? 'Question',
            options,
            answer,
            isCustom,
          },
        ]}
        onSubmit={() => {}}
        readOnly
      />
    );
  }

  if (isSubAgent) {
    const { agentName, instruction, stepCount } = resolveSubAgentMeta(part);

    return (
      <div data-slot="tool-call-card" data-variant="sub-agent" className="w-full">
        <SubAgentCard
          status={status}
          expanded={expanded}
          onToggle={onToggle}
          durationText={durationText}
          agentName={agentName}
          instruction={instruction}
          stepCount={stepCount}
        >
          <NestedApprovalBridgeContext.Provider value={true}>
            <MessagePartPrimitive.Messages
              components={{
                AssistantMessage: NestedSubAgentAssistantMessage,
                UserMessage: () => null,
              }}
            />
          </NestedApprovalBridgeContext.Provider>
        </SubAgentCard>
      </div>
    );
  }

  const resultString =
    part.result === undefined
      ? undefined
      : typeof part.result === 'string'
        ? part.result
        : JSON.stringify(part.result, null, 2);

  if (isSandbox) {
    const { command, intent, argsJson } = parseSandboxArgs(part.argsText);
    const { exitCode, resultText, resultJson } = parseSandboxResult(resultString);
    return (
      <SandboxToolCallContainer
        name={part.toolName}
        intent={intent}
        status={status}
        expanded={expanded}
        onToggle={onToggle}
        durationText={durationText}
        command={command}
        exitCode={exitCode}
        argsJson={argsJson}
        resultText={resultText}
        resultJson={resultJson}
        approvalSlot={showApproval ? <ToolApprovalSlot part={part} /> : undefined}
        approvalId={showApproval ? part.approval?.id : undefined}
      />
    );
  }

  if (MCP_META_TOOLS.has(part.toolName)) {
    const { mcpServer, innerToolName, input } = parseMcpToolArgs(part.argsText);
    const argsDisplay = getJsonDisplayValue(part.argsText);
    const resultDisplay = getToolResultContent(part.result);

    if (part.toolName === 'list_tools' && mcpServer) {
      const slots = RequestResponseSlots({
        request: argsDisplay,
        response: resultDisplay,
      });
      return (
        <ToolCallCard
          toolName={`Listing tools · ${mcpServer}`}
          icon="mcp-server"
          expanded={expanded}
          onToggle={onToggle}
          awaiting={status === 'running'}
          awaitingText={durationText ?? 'Awaiting Response…'}
          showResponseLine={status !== 'running' && !!resultDisplay.data}
          mcpServerName={mcpServer}
          {...slots}
          approvalSlot={showApproval ? <ToolApprovalSlot part={part} /> : undefined}
          approvalId={showApproval ? part.approval?.id : undefined}
        />
      );
    }

    const inputDisplay = input !== undefined ? getJsonDisplayValue(JSON.stringify(input, null, 2)) : argsDisplay;
    const slots = RequestResponseSlots({
      request: inputDisplay,
      response: resultDisplay,
    });

    return (
      <ToolCallCard
        toolName={mcpDisplayName(part.toolName, mcpServer, innerToolName)}
        icon="mcp-server"
        expanded={expanded}
        onToggle={onToggle}
        awaiting={status === 'running'}
        awaitingText={durationText ?? 'Awaiting Response…'}
        showResponseLine={status !== 'running' && resultDisplay.data !== undefined}
        mcpServerName={mcpServer}
        {...slots}
        approvalSlot={showApproval ? <ToolApprovalSlot part={part} /> : undefined}
        approvalId={showApproval ? part.approval?.id : undefined}
      />
    );
  }

  const argsDisplay = getJsonDisplayValue(part.argsText);
  const resultDisplay = getToolResultContent(part.result);
  const slots = RequestResponseSlots({
    request: argsDisplay,
    response: resultDisplay,
  });

  return (
    <ToolCallCard
      toolName={part.toolName}
      expanded={expanded}
      onToggle={onToggle}
      awaiting={status === 'running'}
      awaitingText={durationText ?? 'Awaiting Response…'}
      showResponseLine={status !== 'running' && resultDisplay.data !== undefined}
      {...slots}
      approvalSlot={showApproval ? <ToolApprovalSlot part={part} /> : undefined}
      approvalId={showApproval ? part.approval?.id : undefined}
    />
  );
};
