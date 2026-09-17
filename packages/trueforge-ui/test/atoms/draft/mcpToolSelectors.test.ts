import { describe, expect, it } from 'vitest';

import { disableSelectorsFromMount, enableSelectorsFromMount } from '@/atoms/draft/agentConfigMounts.js';
import { selectedToolNames, toolMatchesSelectors } from '@/atoms/draft/mcpToolSelectors.js';
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

describe('toolMatchesSelectors', () => {
  it('resolves class tags from tool annotations', () => {
    const selectors = ['@write', '@destructive'];
    expect(toolMatchesSelectors({ tool: renameItem, selectors })).toBe(true);
    expect(toolMatchesSelectors({ tool: deleteItem, selectors })).toBe(true);
    expect(toolMatchesSelectors({ tool: listItems, selectors })).toBe(false);
    expect(toolMatchesSelectors({ tool: listItems, selectors: ['@read-only'] })).toBe(true);
    expect(toolMatchesSelectors({ tool: renameItem, selectors: ['@read-only'] })).toBe(false);
  });

  it('matches unannotated tools only by name or @all', () => {
    expect(toolMatchesSelectors({ tool: unannotated, selectors: ['@write', '@destructive'] })).toBe(false);
    expect(toolMatchesSelectors({ tool: unannotated, selectors: ['run_report'] })).toBe(true);
    expect(toolMatchesSelectors({ tool: unannotated, selectors: ['@all'] })).toBe(true);
  });

  it('matches nothing for an empty selector list', () => {
    expect(toolMatchesSelectors({ tool: deleteItem, selectors: [] })).toBe(false);
  });
});

describe('selectedToolNames', () => {
  it('applies enable tags and subtracts disabled tools', () => {
    expect(selectedToolNames({ enableSelectors: ['@read-only'], disableSelectors: [], tools })).toEqual({
      names: ['list_items'],
      resolved: true,
    });
    expect(selectedToolNames({ enableSelectors: ['@all'], disableSelectors: ['@destructive'], tools })).toEqual({
      names: ['list_items', 'rename_item', 'run_report'],
      resolved: true,
    });
    expect(
      selectedToolNames({ enableSelectors: ['list_items', 'delete_item'], disableSelectors: ['delete_item'], tools }),
    ).toEqual({ names: ['list_items'], resolved: true });
  });

  it('reports tags as unresolved until the tool list is known', () => {
    expect(selectedToolNames({ enableSelectors: ['@read-only'], disableSelectors: [], tools: [] })).toEqual({
      names: [],
      resolved: false,
    });
    expect(
      selectedToolNames({ enableSelectors: ['list_items', 'delete_item'], disableSelectors: [], tools: [] }),
    ).toEqual({ names: ['list_items', 'delete_item'], resolved: true });
  });
});

describe('mount tool selectors', () => {
  it('treats a missing enableTools as every tool', () => {
    expect(enableSelectorsFromMount({ name: 'linear' })).toEqual(['@all']);
    expect(enableSelectorsFromMount({ name: 'linear', enableTools: ['@read-only'] })).toEqual(['@read-only']);
    expect(enableSelectorsFromMount({ name: 'linear', enableTools: [] })).toEqual([]);
    expect(disableSelectorsFromMount({ name: 'linear' })).toEqual([]);
    expect(disableSelectorsFromMount({ name: 'linear', disableTools: ['delete_item'] })).toEqual(['delete_item']);
  });
});
