// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionDetailHeader } from '@/atoms/agent-details/AgentSessionDetailHeader.js';
import { buildAgentSessionShareUrl } from '@/utils/sessionShareUrl.js';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

describe('buildAgentSessionShareUrl', () => {
  it('puts agent id and session id on the current page URL', () => {
    const href = buildAgentSessionShareUrl({
      sessionId: 'sess-1',
      agentId: 'agent-1',
      href: 'https://app.example/library/agent-1',
    });
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://app.example/library/agent-1');
    expect(url.searchParams.get('sessionId')).toBe('sess-1');
    expect(url.searchParams.get('agentId')).toBe('agent-1');
  });
});

describe('AgentSessionDetailHeader', () => {
  afterEach(() => {
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    }
  });

  it('keeps title and session id on one line and copies the session link', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        agentId="agent-1"
        onClose={() => undefined}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Help me find more details' });
    expect(heading.parentElement).toHaveClass('items-center');
    expect(heading.parentElement).toHaveTextContent('sess-1');

    const copyButton = screen.getByRole('button', { name: 'Copy session link' });
    fireEvent.mouseEnter(copyButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy session link');

    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(buildAgentSessionShareUrl({ sessionId: 'sess-1', agentId: 'agent-1' }));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Copied');
    });
  });

  it('shows Resume Chat when onResume is provided', () => {
    const onResume = vi.fn();
    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        onClose={() => undefined}
        onResume={onResume}
        resumeLabel="Resume Chat"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume Chat' }));
    expect(onResume).toHaveBeenCalledOnce();
  });
});
