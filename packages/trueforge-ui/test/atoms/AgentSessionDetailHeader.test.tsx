// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionDetailHeader } from '@/atoms/agent-details/AgentSessionDetailHeader.js';
import { buildAgentSessionShareUrl } from '@/utils/sessionShareUrl.js';

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
  it('keeps title and session id on one line and shows Share', () => {
    render(<AgentSessionDetailHeader title="Help me find more details" sessionId="sess-1" onClose={() => undefined} />);

    const heading = screen.getByRole('heading', { name: 'Help me find more details' });
    expect(heading.parentElement).toHaveClass('items-center');
    expect(heading.parentElement).toHaveTextContent('sess-1');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy session link' })).not.toBeInTheDocument();
  });

  it('disables Share when canShare is false', () => {
    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        onClose={() => undefined}
        canShare={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('shows Resume Chat as a new-tab link with an external icon', () => {
    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        onClose={() => undefined}
        resumeHref="https://app.example/sessions/sess-1"
        resumeLabel="Resume Chat"
      />,
    );
    const resume = screen.getByRole('link', { name: /Resume Chat/i });
    expect(resume).toHaveAttribute('href', 'https://app.example/sessions/sess-1');
    expect(resume).toHaveAttribute('target', '_blank');
    expect(resume).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to an in-shell Resume button when only onResume is provided', () => {
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

  it('prefers the new-tab link when both resumeHref and onResume are set', () => {
    const onResume = vi.fn();
    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        onClose={() => undefined}
        resumeHref="https://app.example/sessions/sess-1"
        onResume={onResume}
        resumeLabel="Resume Chat"
      />,
    );
    expect(screen.getByRole('link', { name: /Resume Chat/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume Chat' })).not.toBeInTheDocument();
  });

  it('disables Resume Chat when the session is read-only', () => {
    render(
      <AgentSessionDetailHeader
        title="Help me find more details"
        sessionId="sess-1"
        onClose={() => undefined}
        resumeHref="https://app.example/sessions/sess-1"
        resumeLabel="Resume Chat"
        canResume={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resume Chat' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Resume Chat/i })).not.toBeInTheDocument();
  });
});
