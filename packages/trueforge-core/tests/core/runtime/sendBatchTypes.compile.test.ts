/**
 * Compile-time ownership of public vs runtime send batches.
 * Accepts the three homogeneous modes; rejects mixed pairs via @ts-expect-error.
 */
import type { UserToolApprovalMessage, UserToolResponseMessage } from '../../../src/core/events/schema';
import type { LLMToolMessage } from '../../../src/core/llm/LLMTypes';
import type { AgentThreadRuntimeSendBatch, AgentThreadSendBatch } from '../../../src/core/runtime/AgentThread.types';
import type { AgentInputUserMessage } from '../../../src/core/runtime/UserInputMessage';

const userMsg = { type: 'user.message' as const, content: 'hi' } satisfies AgentInputUserMessage;
const approval = {
  type: 'user.tool_approval' as const,
  thread_id: 'main',
  tool_call_id: 'tc1',
  approval: { status: 'allow' as const },
} satisfies UserToolApprovalMessage;
const toolResponse = {
  type: 'user.tool_response' as const,
  thread_id: 'main',
  tool_call_id: 'tc1',
  content: 'ok',
} satisfies UserToolResponseMessage;
const llmTool: LLMToolMessage = { role: 'tool', tool_call_id: 'tc1', content: 'ok' };

const _userBatch: AgentThreadSendBatch = [userMsg];
const _approvalBatch: AgentThreadSendBatch = [approval, toolResponse];
const _runtimeLlmBatch: AgentThreadRuntimeSendBatch = [llmTool];
const _runtimePublicBatch: AgentThreadRuntimeSendBatch = _userBatch;
void _userBatch;
void _approvalBatch;
void _runtimeLlmBatch;
void _runtimePublicBatch;

// @ts-expect-error mixed user + approval is not a public send batch
const mixedUserApproval: AgentThreadSendBatch = [userMsg, approval];
// @ts-expect-error mixed user + LLM tool is not a public send batch
const mixedUserLlm: AgentThreadSendBatch = [userMsg, llmTool];
// @ts-expect-error mixed approval + LLM tool is not a public send batch
const mixedApprovalLlm: AgentThreadSendBatch = [approval, llmTool];
// @ts-expect-error mixed user + LLM tool is not a runtime send batch either
const mixedRuntime: AgentThreadRuntimeSendBatch = [userMsg, llmTool];
void mixedUserApproval;
void mixedUserLlm;
void mixedApprovalLlm;
void mixedRuntime;

describe('send batch type ownership', () => {
  it('compiles homogeneous modes and rejects mixed pairs', () => {
    expect(true).toBe(true);
  });
});
