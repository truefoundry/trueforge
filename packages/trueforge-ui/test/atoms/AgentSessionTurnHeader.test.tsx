// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentSessionTurnHeader } from '@/atoms/agent-details/AgentSessionTurnHeader.js';

describe('AgentSessionTurnHeader', () => {
  it('shows total, input and output, then output and cache rows', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={8063}
        inputTokens={7000}
        outputTokens={63}
        cacheReadTokens={1000}
        cacheWriteTokens={63}
        durationMs={1200}
      />,
    );

    const tokens = screen.getByRole('button', { name: /Tokens 8K/i });
    fireEvent.mouseEnter(tokens);
    const tooltip = screen.getByRole('tooltip');
    const text = tooltip.textContent ?? '';
    expect(text).toContain('8,063 total tokens');
    expect(text).toContain('8,063 input · 63 output');
    expect(text).toContain('Output tokens');
    expect(text).toContain('Cache read');
    expect(text).toContain('1,000');
    expect(text).toContain('Cache write');
    expect(text).not.toContain('Cached');
    expect(text).not.toContain('Input breakdown');
    expect(text.indexOf('total tokens')).toBeLessThan(text.indexOf('input ·'));
    expect(text.indexOf('Output tokens')).toBeLessThan(text.indexOf('Cache read'));
    expect(text.indexOf('Cache read')).toBeLessThan(text.indexOf('Cache write'));
  });

  it('exposes the breakdown on a focusable token control', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={9000}
        inputTokens={7000}
        outputTokens={1000}
        cacheReadTokens={800}
        cacheWriteTokens={200}
      />,
    );

    const tokens = screen.getByRole('button', {
      name: 'Tokens 9K. Input 8K, Output 1K, Cache read 800, Cache write 200',
    });
    fireEvent.focus(tokens);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('shows the input breakdown bar above output and cache rows', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={9000}
        inputTokens={7000}
        outputTokens={1000}
        cacheReadTokens={800}
        cacheWriteTokens={200}
        inputTokensBreakdown={{
          harness: 100,
          skills: 50,
          instructions: 200,
          toolDefinitions: 150,
          messages: 6500,
        }}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /Tokens 9K/i }));
    const tooltip = screen.getByRole('tooltip');
    const text = tooltip.textContent ?? '';
    expect(text).toContain('Input breakdown');
    expect(text).toContain('Harness');
    expect(text).toContain('Messages');
    expect(text).toContain('Output tokens');
    expect(text).toContain('Cache read');
    expect(text).toContain('Cache write');
    expect(text).not.toContain('Cached');
    expect(text.indexOf('total tokens')).toBeLessThan(text.indexOf('Input breakdown'));
    expect(text.indexOf('Input breakdown')).toBeLessThan(text.indexOf('Output tokens'));
  });

  it('omits the input breakdown section when attribution is absent', () => {
    render(
      <AgentSessionTurnHeader
        turnNumber={1}
        totalTokens={8000}
        inputTokens={7000}
        outputTokens={1000}
        cacheReadTokens={0}
        cacheWriteTokens={0}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /Tokens 8K/i }));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Input breakdown');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Harness');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cache read');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cache write');
  });
});
