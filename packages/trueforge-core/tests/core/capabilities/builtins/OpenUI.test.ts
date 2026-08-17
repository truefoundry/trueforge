import { InstructionBuilder } from '../../../../src/core/InstructionBuilder';
import {
  GET_OPENUI_INSTRUCTIONS_TOOL_NAME,
  OPENUI_MARKDOWN_FENCING_TAG,
  OPENUI_SECTION_TAG,
  OPENUI_SERVER_ID,
  buildOpenUIInstruction,
  openUI,
  renderOpenUIPrompt,
} from '../../../../src/core/capabilities/builtins/OpenUI';
import { isCallToolResponseResult } from '../../../../src/core/mcp/IMCPServer';
import { NOOP_AGENT_TRACING } from '../../../../src/core/tracing/NoopAgentTracing';

describe('openUI', () => {
  it('preload true (default) matches instruction-only wiring', () => {
    const capability = openUI();
    expect(capability.systemToolSets).toBeUndefined();
    expect(capability.instructionBuilders).toHaveLength(1);
    expect(capability.instructionBuilders?.[0]).toBe(buildOpenUIInstruction);

    const preloaded = openUI({ preload: true });
    expect(preloaded.systemToolSets).toBeUndefined();
    expect(preloaded.instructionBuilders?.[0]).toBe(buildOpenUIInstruction);
  });

  it('preload false exposes get_openui_instructions and a short deferred instruction', async () => {
    const capability = openUI({ preload: false, tracing: NOOP_AGENT_TRACING });
    expect(capability.systemToolSets).toHaveLength(1);
    expect(capability.instructionBuilders).toHaveLength(1);

    const toolSet = capability.systemToolSets?.[0];
    expect(toolSet?.name).toBe(OPENUI_SERVER_ID);
    const listed = await toolSet?.listTools();
    if (!listed || 'authRequired' in listed) {
      throw new Error('expected listTools result');
    }
    expect(listed.result.tools.map(t => t.name)).toEqual([GET_OPENUI_INSTRUCTIONS_TOOL_NAME]);

    const deferred = new InstructionBuilder('capabilities');
    capability.instructionBuilders?.[0]?.(deferred);
    const deferredText = deferred.build();
    expect(deferredText).toContain(GET_OPENUI_INSTRUCTIONS_TOOL_NAME);
    expect(deferredText).not.toContain(OPENUI_MARKDOWN_FENCING_TAG);

    const response = await toolSet?.callTool({ name: GET_OPENUI_INSTRUCTIONS_TOOL_NAME, arguments: {} });
    if (!response || !isCallToolResponseResult(response)) {
      throw new Error('expected tool result response');
    }
    const text = response.result.content[0]?.type === 'text' ? response.result.content[0].text : '';
    expect(text).toContain(`<${OPENUI_SECTION_TAG}>`);
    expect(text).toContain(`<${OPENUI_MARKDOWN_FENCING_TAG}>`);
    expect(text).toBe(renderOpenUIPrompt());
  });
});
