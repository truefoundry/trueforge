// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentSessionTurnHeader } from '@/atoms/agent-details/AgentSessionTurnHeader.js';

describe('AgentSessionTurnHeader', () => {
  it('shows an Input / Output / Cached tooltip on the turn token count', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={8063}
        inputTokens={8000}
        outputTokens={63}
        cachedTokens={0}
        durationMs={1200}
      />,
    );

    const tokens = screen.getByRole('button', { name: /Tokens 8K/i });
    fireEvent.mouseEnter(tokens);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Input');
    expect(screen.getByRole('tooltip')).toHaveTextContent('8K');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Output');
    expect(screen.getByRole('tooltip')).toHaveTextContent('63');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cached');
    expect(screen.getByRole('tooltip')).toHaveTextContent('0');
  });

  it('exposes the breakdown on a focusable token control', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={9000}
        inputTokens={7000}
        outputTokens={1000}
        cachedTokens={1000}
      />,
    );

    const tokens = screen.getByRole('button', {
      name: 'Tokens 9K. Input 7K, Output 1K, Cached 1K',
    });
    fireEvent.focus(tokens);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
