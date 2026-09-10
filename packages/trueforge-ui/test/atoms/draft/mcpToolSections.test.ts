import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { MCP_TOOL_SECTION_ORDER, mcpToolSectionId, partitionMcpToolsBySection } from '@/atoms/draft/mcpToolSections.js';
import type { McpToolSelection } from '@/server/types.js';

function tool(name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }): McpToolSelection {
  const row: McpToolSelection = { id: name, name };
  if (annotations !== undefined) Reflect.set(row, 'annotations', annotations);
  return row;
}

describe('mcpToolSections', () => {
  it('classifies tools by readOnlyHint then destructiveHint', () => {
    assert.equal(mcpToolSectionId(tool('list', { readOnlyHint: true })), 'read-only');
    assert.equal(mcpToolSectionId(tool('delete', { destructiveHint: true })), 'destructive');
    assert.equal(mcpToolSectionId(tool('write', { readOnlyHint: false, destructiveHint: false })), 'others');
    assert.equal(mcpToolSectionId(tool('plain')), 'others');
    assert.equal(mcpToolSectionId(tool('both', { readOnlyHint: true, destructiveHint: true })), 'read-only');
  });

  it('partitions in Read-only → Other → Destructive order', () => {
    const sections = partitionMcpToolsBySection([
      tool('delete', { destructiveHint: true }),
      tool('list', { readOnlyHint: true }),
      tool('plain'),
    ]);
    assert.deepEqual(
      MCP_TOOL_SECTION_ORDER.map(id => sections[id].map(item => item.name)),
      [['list'], ['plain'], ['delete']],
    );
  });
});
