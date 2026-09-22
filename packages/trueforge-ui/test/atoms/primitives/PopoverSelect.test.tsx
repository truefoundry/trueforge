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

  it('opens the menu above the trigger when menuPlacement is top and there is room', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    render(
      <PopoverSelect
        aria-label="Timezone"
        menuPlacement="top"
        options={[{ value: 'UTC', label: 'UTC' }]}
        value="UTC"
        onValueChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Timezone' });
    trigger.getBoundingClientRect = () => new DOMRect(12, 400, 120, 32);

    fireEvent.click(trigger);

    const menu = screen.getByRole('listbox').parentElement;
    expect(menu).toHaveClass('fixed');
    expect(menu).toHaveStyle({ transform: 'translateY(-100%)' });
  });

  it('flips the menu above the trigger when there is no room below', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });
    render(
      <PopoverSelect
        aria-label="Rows per page"
        options={[
          { value: '10', label: '10' },
          { value: '25', label: '25' },
          { value: '50', label: '50' },
        ]}
        value="10"
        onValueChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Rows per page' });
    // Trigger sits near the bottom edge of a short viewport.
    trigger.getBoundingClientRect = () => new DOMRect(100, 170, 72, 32);

    fireEvent.click(trigger);

    expect(screen.getByRole('listbox').parentElement).toHaveStyle({ transform: 'translateY(-100%)' });
  });

  it('keeps the menu below the trigger when there is room', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    render(
      <PopoverSelect
        aria-label="Rows per page"
        options={[
          { value: '10', label: '10' },
          { value: '25', label: '25' },
        ]}
        value="10"
        onValueChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Rows per page' });
    trigger.getBoundingClientRect = () => new DOMRect(100, 40, 72, 32);

    fireEvent.click(trigger);

    expect(screen.getByRole('listbox').parentElement).not.toHaveStyle({ transform: 'translateY(-100%)' });
  });

  it('portals the menu so overflow parents do not clip it', () => {
    render(
      <div style={{ overflow: 'hidden', height: 40 }}>
        <PopoverSelect
          aria-label="Rows per page"
          options={[
            { value: '10', label: '10' },
            { value: '25', label: '25' },
          ]}
          value="25"
          onValueChange={() => undefined}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rows per page' }));

    const listbox = screen.getByRole('listbox');
    expect(listbox.parentElement).toHaveClass('fixed');
    expect(listbox.closest('[style*="overflow"]')).toBeNull();
  });

  it('keeps a portaled full-width menu matched to its trigger', () => {
    render(
      <PopoverSelect
        aria-label="Timezone"
        className="w-full"
        menuClassName="w-full min-w-0"
        options={[{ value: 'UTC', label: 'UTC' }]}
        value="UTC"
        onValueChange={() => undefined}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Timezone' });
    trigger.getBoundingClientRect = () => new DOMRect(12, 20, 240, 32);

    fireEvent.click(trigger);

    expect(screen.getByRole('listbox').parentElement).toHaveStyle({ width: '240px' });
  });
});
