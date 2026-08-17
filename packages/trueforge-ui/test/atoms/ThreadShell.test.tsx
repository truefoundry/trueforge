import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { MessageGroup, ThreadComposerAreaShell, ThreadRootShell, ThreadViewportShell } from '@/atoms/ThreadShell.js';

describe('ThreadRootShell', () => {
  it('merges host styles over defaults and forwards its ref and attributes', () => {
    const ref = createRef<HTMLDivElement>();
    const hostStyle = Object.assign({ color: 'red' }, { '--thread-max-width': '60rem' });
    render(<ThreadRootShell ref={ref} data-testid="thread-root" className="host-thread" style={hostStyle} />);

    const root = screen.getByTestId('thread-root');
    expect(root).toBe(ref.current);
    expect(root).toHaveClass('aui-thread-root', 'host-thread');
    expect(root.style.getPropertyValue('--thread-max-width')).toBe('60rem');
    // Composer surface uses --input-box-bg on the theme root; thread shell must not set --composer-bg.
    expect(root.style.getPropertyValue('--composer-bg')).toBe('');
    expect(root.style.color).toBe('red');
  });
});

describe('ThreadViewportShell', () => {
  it('centers empty content and restores message-list spacing when populated', () => {
    const { rerender } = render(
      <ThreadViewportShell isEmpty data-testid="viewport">
        <p>Welcome</p>
      </ThreadViewportShell>,
    );

    const viewport = screen.getByTestId('viewport');
    expect(viewport).toHaveAttribute('data-slot', 'aui_thread-viewport');
    // CSS smooth scroll fights assistant-ui autoScroll and causes bounce on large streams.
    expect(viewport.className).not.toMatch(/\bscroll-smooth\b/);
    expect(viewport.firstElementChild).toHaveClass('min-h-full', 'justify-center', 'pb-4');
    expect(viewport).toHaveTextContent('Welcome');

    rerender(
      <ThreadViewportShell isEmpty={false} data-testid="viewport">
        <p>Messages</p>
      </ThreadViewportShell>,
    );
    expect(viewport.firstElementChild).toHaveClass('pb-32');
    expect(viewport.firstElementChild).not.toHaveClass('justify-center');
  });
});

describe('ThreadComposerAreaShell', () => {
  it('applies populated-state rounding while forwarding content and attributes', () => {
    const { rerender } = render(
      <ThreadComposerAreaShell isEmpty data-testid="composer" className="host-composer">
        Empty composer
      </ThreadComposerAreaShell>,
    );

    const composer = screen.getByTestId('composer');
    expect(composer).toHaveAttribute('data-slot', 'aui_thread-composer');
    expect(composer).toHaveClass('host-composer');
    expect(composer).not.toHaveClass('rounded-t-(--composer-radius)');

    rerender(
      <ThreadComposerAreaShell isEmpty={false} data-testid="composer">
        Populated composer
      </ThreadComposerAreaShell>,
    );
    expect(composer).toHaveClass('rounded-t-(--composer-radius)');
    expect(composer).toHaveTextContent('Populated composer');
  });
});

describe('MessageGroup', () => {
  it('forwards its ref, children, and host attributes', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <MessageGroup ref={ref} data-testid="message-group" className="host-group">
        <article>Message one</article>
      </MessageGroup>,
    );

    const group = screen.getByTestId('message-group');
    expect(group).toBe(ref.current);
    expect(group).toHaveAttribute('data-slot', 'aui_message-group');
    expect(group).toHaveClass('empty:hidden', 'host-group');
    expect(group).toContainElement(screen.getByText('Message one'));
  });
});
