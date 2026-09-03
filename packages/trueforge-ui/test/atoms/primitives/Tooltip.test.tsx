import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { clampCenteredTooltip, LightTooltip, Tooltip } from '@/atoms/primitives/Tooltip.js';

describe('Tooltip', () => {
  it('shows and hides on hover while merging the child callbacks', () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();

    render(
      <Tooltip content="Copy message" className="host-tooltip">
        <button onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
          Copy
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Copy' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(trigger);

    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy message');
    expect(screen.getByRole('tooltip')).toHaveClass('host-tooltip');

    fireEvent.mouseLeave(trigger);

    expect(onMouseLeave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not render an empty tooltip shell', () => {
    render(
      <Tooltip content="">
        <button>Chart</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Chart' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows and hides on keyboard focus while merging the child callbacks', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();

    render(
      <Tooltip content="Open settings">
        <button onFocus={onFocus} onBlur={onBlur}>
          Settings
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Settings' });
    act(() => trigger.focus());

    expect(onFocus).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveAccessibleName('Open settings');

    act(() => trigger.blur());

    expect(onBlur).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('preserves child attributes and disabled behavior', () => {
    const onClick = vi.fn();

    render(
      <Tooltip content="Unavailable">
        <button disabled data-action="archive" onClick={onClick}>
          Archive
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Archive' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('data-action', 'archive');

    fireEvent.click(trigger);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('follows the cursor horizontally when followCursor is set', () => {
    render(
      <Tooltip content="Turn 1" side="bottom" followCursor>
        <button>Chart</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Chart' });
    fireEvent.mouseEnter(trigger, { clientX: 240 });
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '240px' });

    fireEvent.mouseMove(trigger, { clientX: 410 });
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '410px' });
  });

  it('pins the tooltip to explicit cursor-anchor coords', () => {
    render(
      <Tooltip content="Turn 1" side="bottom" followCursor anchor={{ left: 640, top: 120 }}>
        <button>Chart</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Chart' });
    fireEvent.mouseEnter(trigger, { clientX: 240 });
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '640px', top: '126px' });

    fireEvent.mouseMove(trigger, { clientX: 410 });
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '640px', top: '126px' });
  });

  it('clamps a centered tooltip so it stays inside the viewport', () => {
    expect(
      clampCenteredTooltip({
        left: 800,
        top: 40,
        width: 320,
        height: 80,
        side: 'bottom',
        viewportWidth: 900,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 732, top: 40 });

    expect(
      clampCenteredTooltip({
        left: 10,
        top: 40,
        width: 200,
        height: 80,
        side: 'bottom',
        viewportWidth: 900,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 108, top: 40 });
  });

  it('opens below the trigger when side is bottom', () => {
    render(
      <Tooltip content="Below tip" side="bottom">
        <button>Anchor</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Anchor' }));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Below tip');
    expect(tooltip).toHaveStyle({ transform: 'translate(-50%, 0)' });
    expect(tooltip.className).toMatch(/fixed/);
  });

  it('keeps the tooltip open on click when dismissOnClick is false', () => {
    render(
      <Tooltip content="Copy session link" dismissOnClick={false}>
        <button>Link</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Link' });
    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy session link');
  });

  it('dismisses on click while still invoking the child handler', () => {
    const onClick = vi.fn();

    render(
      <Tooltip content="Open picker">
        <button onClick={onClick}>Chip</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Chip' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('LightTooltip', () => {
  it('forwards its title and tooltip attributes', () => {
    render(
      <LightTooltip title="Light help" className="host-light-tooltip" size="small">
        <button>Help</button>
      </LightTooltip>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Help' }));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Light help');
    expect(tooltip).toHaveClass('host-light-tooltip');
  });
});
