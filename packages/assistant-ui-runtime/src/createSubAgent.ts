import type { ToolCall } from './server/index.js';

export function isCreateSubAgentToolCall(toolCall: Pick<ToolCall, 'toolInfo' | 'function'>): boolean {
  // Gateway may attach trueforge-system toolInfo on persisted turns, but streamed
  // model.message tool calls often only carry function.name. Without the fallback,
  // foldPeerThreads never nests child threads under the spawning tool call.
  if (toolCall.toolInfo?.type === 'trueforge-system' && toolCall.toolInfo.name === 'create_sub_agent') {
    return true;
  }
  return toolCall.function.name === 'create_sub_agent';
}
