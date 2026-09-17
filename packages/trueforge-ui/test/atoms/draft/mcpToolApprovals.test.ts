import { describe, expect, it } from 'vitest';

import { approvalSelectorsFromMount, withApprovalSelectors } from '@/atoms/draft/agentConfigMounts.js';
import {
  approvalSelectorsAfterEnabling,
  approvalSelectorsFor,
  approvedToolNames,
  DEFAULT_APPROVAL_SELECTORS,
  namedToolRequiresApproval,
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

describe('namedToolRequiresApproval', () => {
  it('falls back to name and @all matching when annotations are unknown', () => {
    expect(
      namedToolRequiresApproval({ toolName: 'delete_item', tools: [], selectors: ['@write', '@destructive'] }),
    ).toBe(false);
    expect(namedToolRequiresApproval({ toolName: 'delete_item', tools: [], selectors: ['delete_item'] })).toBe(true);
    expect(namedToolRequiresApproval({ toolName: 'delete_item', tools, selectors: ['@destructive'] })).toBe(true);
  });
});

describe('approvalSelectorsAfterEnabling', () => {
  it('ungates Other tools and keeps destructive tools gated', () => {
    expect(
      approvalSelectorsAfterEnabling({
        tools,
        selectors: ['@write', '@destructive'],
        newlyEnabledNames: ['rename_item', 'delete_item'],
      }),
    ).toEqual(['@destructive']);
  });

  it('keeps the harness default when enabling tools on a server with no destructive class', () => {
    expect(
      approvalSelectorsAfterEnabling({
        tools: [unannotated],
        selectors: [...DEFAULT_APPROVAL_SELECTORS],
        newlyEnabledNames: ['run_report'],
      }),
    ).toEqual([...DEFAULT_APPROVAL_SELECTORS]);
  });
});

describe('approvalSelectorsFor', () => {
  it('keeps class tags while every tool of the class stays gated', () => {
    const approved = approvedToolNames({ tools, selectors: [...DEFAULT_APPROVAL_SELECTORS] });
    approved.add('list_items');

    expect(approvalSelectorsFor({ tools, approved })).toEqual(['@destructive', 'list_items']);
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

  it('omits class tags when the server has no tools in that class', () => {
    expect(approvalSelectorsFor({ tools: [unannotated], approved: new Set() })).toEqual([]);
    expect(approvalSelectorsFor({ tools: [listItems], approved: new Set([listItems.name]) })).toEqual(['@all']);
  });
});

describe('mount approval selectors', () => {
  it('reads the harness default when the mount omits the field', () => {
    expect(approvalSelectorsFromMount({ name: 'linear' })).toEqual(['@destructive']);
    expect(approvalSelectorsFromMount({ name: 'linear', requireApprovalForTools: [] })).toEqual([]);
  });

  it('drops the field again when the selection matches the default', () => {
    const mount = { name: 'linear', requireApprovalForTools: ['@all'] };

    expect(withApprovalSelectors(mount, ['@destructive'])).toEqual({ name: 'linear' });
    expect(withApprovalSelectors(mount, [])).toEqual({ name: 'linear', requireApprovalForTools: [] });
  });
});
