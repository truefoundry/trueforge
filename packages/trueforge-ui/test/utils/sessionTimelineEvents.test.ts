import { describe, expect, it } from 'vitest';

import { toolCallDescription } from '@/utils/sessionTimelineEvents.js';

describe('toolCallDescription', () => {
  it('shows the sandbox tool name and intent', () => {
    expect(
      toolCallDescription({
        function: {
          name: 'exec',
          arguments: JSON.stringify({ command: 'ls', intent: 'List workspace files' }),
        },
      }),
    ).toBe('Sandbox: exec - List workspace files');
    expect(
      toolCallDescription({
        function: { name: 'sandbox_exec', arguments: '{"intent":"Generate a PDF"}' },
      }),
    ).toBe('Sandbox: sandbox_exec - Generate a PDF');
  });

  it('falls back to the tool name when intent is missing', () => {
    expect(toolCallDescription({ function: { name: 'exec', arguments: '{"command":"ls"}' } })).toBe('Sandbox: exec');
    expect(toolCallDescription({ function: { name: 'search', arguments: '{"q":"x"}' } })).toBe('search');
  });

  it('unwraps deferred MCP meta-tool args so the real tool name is visible', () => {
    expect(
      toolCallDescription({
        function: {
          name: 'call_tool',
          arguments: JSON.stringify({
            mcp_server: 'github',
            tool_name: 'search_issues',
            input: { q: 'bug' },
          }),
        },
      }),
    ).toBe('call_tool: search_issues (github)');
    expect(
      toolCallDescription({
        function: {
          name: 'get_tool_info',
          arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'create_issue' }),
        },
      }),
    ).toBe('get_tool_info: create_issue (linear)');
    expect(
      toolCallDescription({
        function: {
          name: 'list_tools',
          arguments: JSON.stringify({ mcp_server: 'slack-workspace' }),
        },
      }),
    ).toBe('list_tools (slack-workspace)');
  });
});
