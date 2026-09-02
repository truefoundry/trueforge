// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { PopoverSelect } from '@/atoms/primitives/PopoverSelect.js';

const options = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
] as const;

function SingleSelect() {
  const [value, setValue] = useState<'active' | 'paused'>('active');
  return <PopoverSelect aria-label="Status" options={options} value={value} onValueChange={setValue} />;
}

function MultiSelect() {
  const [value, setValue] = useState<Array<'active' | 'paused'>>([]);
  return <PopoverSelect multiple aria-label="Statuses" options={options} value={value} onValueChange={setValue} />;
}

describe('PopoverSelect', () => {
  it('selects one option and closes the popover', () => {
    render(<SingleSelect />);

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('option', { name: 'Paused' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('Paused');
  });

  it('keeps the popover open while toggling multiple options', () => {
    render(<MultiSelect />);

    fireEvent.click(screen.getByRole('button', { name: 'Statuses' }));
    fireEvent.click(screen.getByRole('option', { name: 'Active' }));

    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getByRole('option', { name: 'Active' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Statuses' })).toHaveTextContent('Active');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<SingleSelect />);
    const trigger = screen.getByRole('button', { name: 'Status' });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders a prefixed chip trigger', () => {
    render(
      <PopoverSelect
        aria-label="Filter by agent"
        prefix="Agents"
        options={[{ value: 'a', label: 'alpha' }]}
        value="a"
        onValueChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Filter by agent' });
    expect(trigger).toHaveTextContent('Agents');
    expect(trigger).toHaveTextContent('alpha');
    expect(trigger.querySelector('.border-r')).not.toBeNull();
  });

  it('opens the menu above the trigger when menuPlacement is top', () => {
    render(
      <PopoverSelect
        aria-label="Timezone"
        menuPlacement="top"
        options={[{ value: 'UTC', label: 'UTC' }]}
        value="UTC"
        onValueChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Timezone' }));

    expect(screen.getByRole('listbox').className).toContain('bottom-full');
    expect(screen.getByRole('listbox').className).toContain('mb-1');
  });
});
