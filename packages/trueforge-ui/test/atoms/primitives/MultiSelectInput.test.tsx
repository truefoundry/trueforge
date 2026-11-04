import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiSelectInput } from '@/atoms/primitives/MultiSelectInput.js';

type Item = { id: string; name: string };

const items: Item[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
];

function renderInput({ selected = items, query = '' }: { selected?: Item[]; query?: string } = {}) {
  const onRemove = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <MultiSelectInput
      selected={selected}
      getKey={item => item.id}
      getLabel={item => item.name}
      onRemove={onRemove}
      query={query}
      onQueryChange={onQueryChange}
      placeholder="Add people"
      aria-label="Search"
    />,
  );
  return { onRemove, onQueryChange, input: screen.getByLabelText('Search') };
}

describe('MultiSelectInput', () => {
  it('renders selected items as chips inside the field and hides the placeholder', () => {
    const { input } = renderInput();

    expect(input.closest('label')).toContainElement(screen.getByRole('button', { name: 'Remove Alice' }));
    expect(input.closest('label')).toContainElement(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(input).not.toHaveAttribute('placeholder');
  });

  it('shows the placeholder when nothing is selected', () => {
    const { input } = renderInput({ selected: [] });

    expect(input).toHaveAttribute('placeholder', 'Add people');
  });

  it('removes a chip when its button is clicked', () => {
    const { onRemove } = renderInput();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));

    expect(onRemove).toHaveBeenCalledWith(items[0]);
  });

  it('reports query changes', () => {
    const { onQueryChange, input } = renderInput();

    fireEvent.change(input, { target: { value: 'ca' } });

    expect(onQueryChange).toHaveBeenCalledWith('ca');
  });

  it('removes the last chip on Backspace only when the query is empty', () => {
    const empty = renderInput();
    fireEvent.keyDown(empty.input, { key: 'Backspace' });
    expect(empty.onRemove).toHaveBeenCalledWith(items[1]);
  });

  it('keeps chips on Backspace while the query has text', () => {
    const { onRemove, input } = renderInput({ query: 'b' });

    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('lists matches in a popup and reports the picked item', () => {
    const onSelect = vi.fn();
    render(
      <MultiSelectInput
        selected={[]}
        options={items}
        getKey={item => item.id}
        getLabel={item => item.name}
        onRemove={vi.fn()}
        onSelect={onSelect}
        query="a"
        onQueryChange={vi.fn()}
        placeholder="Add people"
        aria-label="Search"
        optionsLabel="Matching users"
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: 'Alice' }));

    expect(screen.getByRole('listbox', { name: 'Matching users' })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('shows noDataPlaceholder when the query has no matches', () => {
    render(
      <MultiSelectInput
        selected={[]}
        options={[]}
        getKey={item => item.id}
        getLabel={item => item.name}
        onRemove={vi.fn()}
        query="zzz"
        onQueryChange={vi.fn()}
        aria-label="Search"
        noDataPlaceholder="No matching users"
      />,
    );

    expect(screen.getByText('No matching users')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('keeps the popup closed while the query is empty', () => {
    render(
      <MultiSelectInput
        selected={[]}
        options={items}
        getKey={item => item.id}
        getLabel={item => item.name}
        onRemove={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        aria-label="Search"
        noDataPlaceholder="No matching users"
      />,
    );

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching users')).not.toBeInTheDocument();
  });

  it('dismisses the popup and clears the query on Escape', () => {
    const onQueryChange = vi.fn();
    render(
      <MultiSelectInput
        selected={[]}
        options={items}
        getKey={item => item.id}
        getLabel={item => item.name}
        onRemove={vi.fn()}
        query="a"
        onQueryChange={onQueryChange}
        aria-label="Search"
        optionsLabel="Matching users"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search' });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('lets Escape reach the parent after the query is cleared', () => {
    const onQueryChange = vi.fn();
    const onParentEscape = vi.fn();
    const props = {
      selected: [] as Item[],
      options: items,
      getKey: (item: Item) => item.id,
      getLabel: (item: Item) => item.name,
      onRemove: vi.fn(),
      onQueryChange,
      'aria-label': 'Search',
      optionsLabel: 'Matching users',
    };
    const { rerender } = render(
      <div
        onKeyDown={event => {
          if (event.key === 'Escape') onParentEscape();
        }}
      >
        <MultiSelectInput {...props} query="a" />
      </div>,
    );
    rerender(
      <div
        onKeyDown={event => {
          if (event.key === 'Escape') onParentEscape();
        }}
      >
        <MultiSelectInput {...props} query="" />
      </div>,
    );

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search' }), { key: 'Escape' });

    expect(onParentEscape).toHaveBeenCalledOnce();
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it('dismisses the popup and clears the query on outside mousedown', () => {
    const onQueryChange = vi.fn();
    render(
      <div>
        <MultiSelectInput
          selected={[]}
          options={items}
          getKey={item => item.id}
          getLabel={item => item.name}
          onRemove={vi.fn()}
          query="a"
          onQueryChange={onQueryChange}
          aria-label="Search"
        />
        <button type="button">Outside</button>
      </div>,
    );

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onQueryChange).toHaveBeenCalledWith('');
  });
});
