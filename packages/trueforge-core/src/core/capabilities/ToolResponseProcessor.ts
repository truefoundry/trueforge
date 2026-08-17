import type { RegisteredPassthroughEvent } from '../events/PassthroughEvents';
import type { ToolCallResult } from '../mcp/executeToolCalls';
import type { SandboxInfo } from '../sandbox/Sandbox';
import type { AgentThreadExecutionContext } from './AgentContextProcessor';

export interface ToolResponseProcessorResult {
  sandboxCreated?: SandboxInfo | undefined;
  events?: readonly RegisteredPassthroughEvent[] | undefined;
}

export interface ToolResponseProcessor {
  process(
    result: ToolCallResult[],
    execution: Readonly<AgentThreadExecutionContext>,
  ): Promise<ToolResponseProcessorResult>;
}
