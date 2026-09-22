import type { Turn } from './server/index.js';

import { buildMcpAuthTextParts, findMcpAuthRequired, mcpAuthAssistantStatus, mcpAuthMessageCustom } from './mcpAuth.js';
import type { AssistantContentPart } from './modelMessageContent.js';
import { findApprovalRequiredInTurn, toolApprovalMessageCustom, toolApprovalStatus } from './toolApproval.js';
import { findResponseRequiredInTurn, toolResponseMessageCustom, toolResponseStatus } from './toolResponse.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

function buildToolApprovalUpdate(content: AssistantContentPart[], turn: Pick<Turn, 'state'>): TurnStreamUpdate {
  const pendingApproval = findApprovalRequiredInTurn(turn);
  if (pendingApproval == null) {
    return { content };
  }
  return {
    content,
    status: toolApprovalStatus(),
    metadata: { custom: toolApprovalMessageCustom(pendingApproval.threadId) },
  };
}

function buildToolResponseUpdate(update: TurnStreamUpdate, turn: Pick<Turn, 'state'>): TurnStreamUpdate {
  const pendingResponse = findResponseRequiredInTurn(turn);
  if (pendingResponse == null) {
    return update;
  }
  return {
    ...update,
    content: update.content,
    status: toolResponseStatus(),
    metadata: {
      custom: {
        ...update.metadata?.custom,
        ...toolResponseMessageCustom(pendingResponse.threadId),
      },
    },
  };
}

export function appendToolResponseToTurnContent(update: TurnStreamUpdate, turn: Pick<Turn, 'state'>): TurnStreamUpdate {
  if (update.status?.type === 'requires-action') {
    return update;
  }
  return buildToolResponseUpdate(update, turn);
}

export function appendToolApprovalToTurnContent(update: TurnStreamUpdate, turn: Pick<Turn, 'state'>): TurnStreamUpdate {
  if (update.status?.type === 'requires-action') {
    return update;
  }
  const approvalUpdate = buildToolApprovalUpdate(update.content, turn);
  return appendToolResponseToTurnContent(approvalUpdate, turn);
}

export function appendMcpAuthToTurnContent(
  content: AssistantContentPart[],
  turn: Pick<Turn, 'state'>,
): TurnStreamUpdate {
  const pendingMcpAuth = findMcpAuthRequired(turn.state.status === 'done' ? turn.state.requiredActions : undefined);
  if (pendingMcpAuth == null) {
    return appendToolApprovalToTurnContent({ content }, turn);
  }

  return appendToolApprovalToTurnContent(
    {
      content: [...content, ...buildMcpAuthTextParts(pendingMcpAuth.mcpServers)],
      status: mcpAuthAssistantStatus(),
      metadata: { custom: mcpAuthMessageCustom(pendingMcpAuth.mcpServers) },
    },
    turn,
  );
}
