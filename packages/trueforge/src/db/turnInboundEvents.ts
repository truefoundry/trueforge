import type { TurnUserEvent, TurnUserEventMessage } from '@truefoundry/trueforge-core/agent-session';

export function toTurnUserEventMessage(event: TurnUserEvent): TurnUserEventMessage {
  switch (event.type) {
    case 'user.tool_approval':
      return {
        type: event.type,
        thread_id: event.thread_id,
        tool_call_id: event.tool_call_id,
        approval: event.approval,
      };
    case 'user.tool_response':
      return {
        type: event.type,
        thread_id: event.thread_id,
        tool_call_id: event.tool_call_id,
        content: event.content,
      };
    case 'user.tool_approval_policy':
      return {
        type: event.type,
        policies: event.policies,
      };
    case 'user.mcp_auth_continue':
      return { type: event.type };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function toTurnUserEvent(row: {
  event_id: string;
  payload: TurnUserEventMessage;
  created_at: string;
}): TurnUserEvent {
  return {
    ...row.payload,
    id: row.event_id,
    created_at: row.created_at,
  };
}
