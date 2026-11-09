import { SYSTEM_TOOL_NAME, TOOL_INFO_TYPE, type ToolCall } from './server/index.js';

export function isCreateSubAgentToolCall(toolCall: Pick<ToolCall, 'toolInfo' | 'function'>): boolean {
  // Gateway may attach trueforge-system toolInfo on persisted turns, but streamed
  // model.message tool calls often only carry function.name. Without the fallback,
  // foldPeerThreads never nests child threads under the spawning tool call.
  if (
    toolCall.toolInfo?.type === TOOL_INFO_TYPE.TRUEFORGE_SYSTEM &&
    toolCall.toolInfo.name === SYSTEM_TOOL_NAME.CREATE_SUB_AGENT
  ) {
    return true;
  }
  return toolCall.function.name === SYSTEM_TOOL_NAME.CREATE_SUB_AGENT;
}
