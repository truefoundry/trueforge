import { largeToolResponse } from '../../../../src/core/capabilities/builtins/LargeToolResponse';
import { lifecycleHooks } from '../../../../src/core/capabilities/builtins/LifecycleHooks';
import type { IToolSet } from '../../../../src/core/mcp/IMCPServer';
import type { ToolCallResult } from '../../../../src/core/mcp/executeToolCalls';
import { getEmptyCurrentContextUsage } from '../../../../src/core/runtime/contextUsage';
import { makeMockIMCPServer, makeSilentLogger, makeStubPublicSandbox } from '../../harnessMocks';

const silentLogger = makeSilentLogger();

const LARGE_CONTENT = 'x'.repeat(50_000);

function makeToolResult(toolSet: IToolSet, name: string): ToolCallResult {
  return {
    message: {
      role: 'tool',
      tool_call_id: 'call-1',
      content: LARGE_CONTENT,
    },
    info: {
      toolSet,
      originalToolName: name,
    },
    failure: false,
    isStructuredContent: false,
    completedAt: new Date().toISOString(),
  };
}

describe('LargeToolResponse sandbox object identity (ISSUE-035)', () => {
  it('classifies only the exact Sandbox instance as sandbox category', async () => {
    const sandbox = makeStubPublicSandbox();
    const sandboxNamedMcp = makeMockIMCPServer({ name: 'sandbox', preload: true });

    const processor = largeToolResponse({
      dynamicSubAgentsPresent: false,
      settings: { individualTokenThreshold: 100, totalTokenThreshold: 200 },
      logger: silentLogger,
    }).toolResponseProcessors?.[0];
    expect(processor).toBeDefined();
    if (!processor) throw new Error('expected largeToolResponse processor');

    const sandboxResult = makeToolResult(sandbox, 'exec');
    const mcpResult = makeToolResult(sandboxNamedMcp, 'search');

    await processor.process([sandboxResult, mcpResult], {
      threadId: 'main',
      sandbox,
      currentContextUsage: getEmptyCurrentContextUsage(),
      context: [],
    });

    expect(sandboxResult.message.content).toContain('write to a file');
    expect(mcpResult.message.content).not.toContain('write to a file');
    expect(mcpResult.message.content).toContain('Content too big');
  });

  it('recognizes the Sandbox through a lifecycle-hooks decorator; a sandbox-NAMED MCP server stays mcp', async () => {
    const sandbox = makeStubPublicSandbox();
    const decorator = lifecycleHooks({
      runner: {
        preToolUse: () => Promise.resolve({ status: 'allow' }),
        postToolUse: () => Promise.resolve(),
      },
      events: { preToolUse: true, postToolUse: true },
    }).toolSetDecorators?.[0];
    if (!decorator) throw new Error('expected a decorator');
    const wrappedSandbox = decorator(sandbox);
    const wrappedImpostor = decorator(makeMockIMCPServer({ name: 'sandbox', preload: true }));

    const processor = largeToolResponse({
      dynamicSubAgentsPresent: false,
      settings: { individualTokenThreshold: 100, totalTokenThreshold: 200 },
      logger: silentLogger,
    }).toolResponseProcessors?.[0];
    if (!processor) throw new Error('expected largeToolResponse processor');

    const sandboxResult = makeToolResult(wrappedSandbox, 'exec');
    const impostorResult = makeToolResult(wrappedImpostor, 'search');

    await processor.process([sandboxResult, impostorResult], {
      threadId: 'main',
      sandbox,
      currentContextUsage: getEmptyCurrentContextUsage(),
      context: [],
    });

    expect(sandboxResult.message.content).toContain('write to a file');
    expect(impostorResult.message.content).toContain('Content too big');
  });
});
