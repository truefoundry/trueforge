import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { IToolSet } from '../../../src/core/mcp/IMCPServer';
import { DeferredTool } from '../../../src/core/runtime/DeferredTool';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

const DEFERRED_TOOLS_INSTRUCTION = 'deferred-tools-instructions';

const silentLogger = makeSilentLogger();

function deferredInstructionText(servers: IToolSet[]): string {
  const builder = InstructionBuilder.createSystemPrompt('test');
  const capabilities = builder.beginSection('agent-capabilities');
  new DeferredTool(servers, { tracing: NOOP_AGENT_TRACING, logger: silentLogger }).buildInstruction(capabilities);
  return builder.build();
}

describe('DeferredTool deferred loading behavior', () => {
  it('includes preload:false servers in deferred-tools instructions', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({ name: 'eager-server', preload: true }),
      makeMockIMCPServer({ name: 'lazy-server', preload: false }),
    ]);
    expect(text).toContain(`<${DEFERRED_TOOLS_INSTRUCTION}>`);
    expect(text).toContain('lazy-server');
    expect(text).not.toContain('eager-server');
  });

  it('omits deferred-tools instructions when every server is preload:true', () => {
    const text = deferredInstructionText([makeMockIMCPServer({ name: 'all-eager', preload: true })]);
    expect(text).not.toContain(`<${DEFERRED_TOOLS_INSTRUCTION}>`);
  });

  it('lists preload:false servers even when hasPreloadedTools is true (selective preload)', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({
        name: 'partial-preload-server',
        preload: false,
        hasPreloadedTools: true,
        preloadTools: ['tool_a'],
      }),
    ]);
    expect(text).toContain('partial-preload-server');
  });

  it('lists preload:false with no preloads and omits preload:true', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({ name: 'lazy-empty', preload: false, hasPreloadedTools: false }),
      makeMockIMCPServer({ name: 'eager', preload: true, hasPreloadedTools: true }),
    ]);
    expect(text).toContain('lazy-empty');
    expect(text).not.toContain('eager');
  });
});
