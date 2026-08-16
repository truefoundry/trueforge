import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/atoms/primitives/DropdownMenu.js';

describe('DropdownMenu', () => {
  it('opens and closes from clicks, menu selection, and outside interaction', () => {
    const onTriggerClick = vi.fn();
    const onSelect = vi.fn();

    render(
      <div>
        <DropdownMenu trigger={<button onClick={onTriggerClick}>Actions</button>} className="host-menu">
          <DropdownMenuItem onClick={onSelect}>Rename</DropdownMenuItem>
        </DropdownMenu>
        <button>Outside</button>
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(onTriggerClick).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(menu).toHaveClass('host-menu');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('merges trigger keyboard handling and manages focus across enabled items', () => {
    const onTriggerKeyDown = vi.fn();
    const onDisabledClick = vi.fn();

    render(
      <DropdownMenu
        trigger={
          <button data-host-trigger="true" onKeyDown={onTriggerKeyDown}>
            Actions
          </button>
        }
      >
        <DropdownMenuItem data-item-id="first">First</DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onDisabledClick}>
          Disabled
        </DropdownMenuItem>
        <DropdownMenuItem data-item-id="last">Last</DropdownMenuItem>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('data-host-trigger', 'true');

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(onTriggerKeyDown).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();

    const disabled = screen.getByRole('menuitem', { name: 'Disabled' });
    expect(disabled).toBeDisabled();

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));
    expect(onDisabledClick).not.toHaveBeenCalled();
  });

  it('forwards item and separator host attributes', () => {
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <DropdownMenuItem name="rename" aria-label="Rename item">
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator data-divider="actions" aria-label="More actions" />
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.getByRole('menuitem', { name: 'Rename item' })).toHaveAttribute('name', 'rename');
    expect(screen.getByRole('separator', { name: 'More actions' })).toHaveAttribute('data-divider', 'actions');
  });
});
