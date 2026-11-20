// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShellLink } from '@/atoms/primitives/ShellLink.js';
import { ResolvedRoutesProvider } from '@/routing/ResolvedRoutesContext.js';
import { resolveRoutesConfig } from '@/routing/paths.js';

const routes = resolveRoutesConfig();

describe('ShellLink', () => {
  it('renders an href for a place and calls onNavigate on a plain click', () => {
    const onNavigate = vi.fn();
    render(
      <ResolvedRoutesProvider routes={routes}>
        <ShellLink place={{ type: 'library' }} onNavigate={onNavigate}>
          Agents
        </ShellLink>
      </ResolvedRoutesProvider>,
    );

    const link = screen.getByRole('link', { name: 'Agents' });
    expect(link).toHaveAttribute('href', '/library');

    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(click.defaultPrevented).toBe(true);
  });

  it('does not call onNavigate for a modified click', () => {
    const onNavigate = vi.fn();
    render(
      <ResolvedRoutesProvider routes={routes}>
        <ShellLink place={{ type: 'schedules' }} onNavigate={onNavigate}>
          Schedules
        </ShellLink>
      </ResolvedRoutesProvider>,
    );

    const link = screen.getByRole('link', { name: 'Schedules' });
    const metaClick = createEvent.click(link, { button: 0, metaKey: true });
    fireEvent(link, metaClick);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(metaClick.defaultPrevented).toBe(false);

    const ctrlClick = createEvent.click(link, { button: 0, ctrlKey: true });
    fireEvent(link, ctrlClick);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(ctrlClick.defaultPrevented).toBe(false);
  });

  it('renders a button when routes are unavailable', () => {
    const onNavigate = vi.fn();
    render(
      <ShellLink place={{ type: 'library' }} onNavigate={onNavigate}>
        Agents
      </ShellLink>,
    );

    const button = screen.getByRole('button', { name: 'Agents' });
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('forwards hover handlers onto the link', () => {
    const onMouseEnter = vi.fn();
    render(
      <ResolvedRoutesProvider routes={routes}>
        <ShellLink place={{ type: 'library' }} onNavigate={() => undefined} onMouseEnter={onMouseEnter}>
          Agents
        </ShellLink>
      </ResolvedRoutesProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Agents' }));
    expect(onMouseEnter).toHaveBeenCalledOnce();
  });

  it('uses a raw href when provided', () => {
    const onNavigate = vi.fn();
    render(
      <ShellLink href="/sessions?sessionId=s1&view=sessions" onNavigate={onNavigate}>
        Session
      </ShellLink>,
    );

    expect(screen.getByRole('link', { name: 'Session' })).toHaveAttribute(
      'href',
      '/sessions?sessionId=s1&view=sessions',
    );
  });
});
