import { describe, expect, it } from 'vitest';

import { approvalSelectorsFromMount, withApprovalSelectors } from '@/atoms/draft/agentConfigMounts.js';
import {
  approvalSelectorsFor,
  approvedToolNames,
  DEFAULT_APPROVAL_SELECTORS,
  namedToolRequiresApproval,
  toolRequiresApproval,
} from '@/atoms/draft/mcpToolApprovals.js';
import type { McpToolSelection } from '@/server/types.js';

function tool(name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }): McpToolSelection {
  const row: McpToolSelection = { id: name, name };
  if (annotations !== undefined) Reflect.set(row, 'annotations', annotations);
  return row;
}

const listItems = tool('list_items', { readOnlyHint: true, destructiveHint: false });
const renameItem = tool('rename_item', { readOnlyHint: false, destructiveHint: false });
const deleteItem = tool('delete_item', { readOnlyHint: false, destructiveHint: true });
const unannotated = tool('run_report');
const tools = [listItems, renameItem, deleteItem, unannotated];

describe('toolRequiresApproval', () => {
  it('resolves class tags from tool annotations', () => {
    const selectors = [...DEFAULT_APPROVAL_SELECTORS];
    expect(toolRequiresApproval({ tool: renameItem, selectors })).toBe(true);
    expect(toolRequiresApproval({ tool: deleteItem, selectors })).toBe(true);
    expect(toolRequiresApproval({ tool: listItems, selectors })).toBe(false);
  });

  it('exempts unannotated tools unless named or covered by @all', () => {
    expect(toolRequiresApproval({ tool: unannotated, selectors: [...DEFAULT_APPROVAL_SELECTORS] })).toBe(false);
    expect(toolRequiresApproval({ tool: unannotated, selectors: ['run_report'] })).toBe(true);
    expect(toolRequiresApproval({ tool: unannotated, selectors: ['@all'] })).toBe(true);
  });

  it('gates nothing for an empty selector list', () => {
    expect(toolRequiresApproval({ tool: deleteItem, selectors: [] })).toBe(false);
  });
});

describe('namedToolRequiresApproval', () => {
  it('falls back to name and @all matching when annotations are unknown', () => {
    expect(
      namedToolRequiresApproval({ toolName: 'delete_item', tools: [], selectors: ['@write', '@destructive'] }),
    ).toBe(false);
    expect(namedToolRequiresApproval({ toolName: 'delete_item', tools: [], selectors: ['delete_item'] })).toBe(true);
    expect(namedToolRequiresApproval({ toolName: 'delete_item', tools, selectors: ['@destructive'] })).toBe(true);
  });
});

describe('approvalSelectorsFor', () => {
  it('keeps class tags while every tool of the class stays gated', () => {
    const approved = approvedToolNames({ tools, selectors: [...DEFAULT_APPROVAL_SELECTORS] });
    approved.add('list_items');

    expect(approvalSelectorsFor({ tools, approved })).toEqual(['@write', '@destructive', 'list_items']);
  });

  it('expands a class tag into names when one of its tools is ungated', () => {
    const approved = new Set(['rename_item']);

    expect(approvalSelectorsFor({ tools, approved })).toEqual(['@write']);
  });

  it('drops a tag whose tools are no longer all gated', () => {
    const moreWrites = [...tools, tool('archive_item', { readOnlyHint: false, destructiveHint: false })];
    const approved = new Set(['rename_item', 'delete_item']);

    expect(approvalSelectorsFor({ tools: moreWrites, approved })).toEqual(['@destructive', 'rename_item']);
  });

  it('collapses to @all when every tool is gated', () => {
    const approved = new Set(tools.map(item => item.name));

    expect(approvalSelectorsFor({ tools, approved })).toEqual(['@all']);
  });

  it('returns an empty list when nothing is gated', () => {
    expect(approvalSelectorsFor({ tools, approved: new Set() })).toEqual([]);
  });
});

describe('mount approval selectors', () => {
  it('reads the harness default when the mount omits the field', () => {
    expect(approvalSelectorsFromMount({ name: 'linear' })).toEqual(['@write', '@destructive']);
    expect(approvalSelectorsFromMount({ name: 'linear', requireApprovalForTools: [] })).toEqual([]);
  });

  it('drops the field again when the selection matches the default', () => {
    const mount = { name: 'linear', requireApprovalForTools: ['@all'] };

    expect(withApprovalSelectors(mount, ['@destructive', '@write'])).toEqual({ name: 'linear' });
    expect(withApprovalSelectors(mount, [])).toEqual({ name: 'linear', requireApprovalForTools: [] });
  });
});
