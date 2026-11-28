// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectableList, type SelectableListProps } from '@/atoms/primitives/SelectableList.js';

type Item = { id: string; label: string };

const items: Item[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
];

function renderList(props: Partial<SelectableListProps<Item>> = {}) {
  const onSelect = vi.fn();
  render(
    <SelectableList
      aria-label="Letters"
      items={items}
      selectedKey="a"
      getKey={item => item.id}
      renderOption={item => item.label}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect };
}

describe('SelectableList', () => {
  it('marks only the selected option', () => {
    renderList();
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the clicked item', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it('ignores clicks while disabled', () => {
    const { onSelect } = renderList({ disabled: true });
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the placeholder instead of an empty list', () => {
    renderList({ items: [], noDataPlaceholder: <p>Nothing here</p> });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
