// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { LARGE_STREAMING_FENCE_CHARS, Markdown, getActiveStreamingFenceCode } from '@/atoms/Markdown.js';
import type { SyntaxHighlighterProps } from '@/atoms/SyntaxHighlighter.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

// @openuidev mocks are in testSetup.ts; they make OpenUiFenceBlock render
// a simple div with data-testid="aui-openui-renderer" synchronously.

describe('getActiveStreamingFenceCode', () => {
  it('returns null when every fence is closed', () => {
    expect(getActiveStreamingFenceCode('```js\nconst x = 1;\n```\n\ndone')).toBeNull();
  });

  it('returns the body of the final unmatched fence', () => {
    const body = 'x'.repeat(100);
    expect(getActiveStreamingFenceCode(`intro\n\n\`\`\`json\n${body}`)).toBe(body);
  });
});

describe('Markdown', () => {
  it('renders basic markdown formatting', () => {
    render(<Markdown content="**bold** text" />);
    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
    expect(strong.closest('.markdown-body')).toBeTruthy();
  });

  it('opens links in a new tab', () => {
    render(<Markdown content="See [docs](https://example.com/docs) for details." />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('node');
  });

  it('renders openui fenced blocks via OpenUiFenceBlock', async () => {
    render(<Markdown content={'```openui\nCard() { title: "Sales" }\n```'} />);
    await waitFor(() => {
      expect(screen.getByTestId('aui-openui-renderer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('aui-openui-renderer')).toHaveTextContent('Card() { title: "Sales" }');
    expect(document.querySelector('.code-block-header')).not.toBeInTheDocument();
  });

  it('renders a code fence with syntax highlighting for non-openui languages', () => {
    render(<Markdown content={'```js\nconst x = 1;\n```'} />);
    // react-syntax-highlighter renders the code as text nodes inside the fence block.
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });

  it('keeps Prism for small streaming fences', () => {
    render(<Markdown content={'```json\n{"a":1}\n```'} isStreaming />);
    expect(screen.queryByTestId('aui-plain-streaming-fence')).not.toBeInTheDocument();
    expect(screen.getByTestId('aui-syntax-highlighter')).toBeInTheDocument();
  });

  it('keeps Prism for large closed fences while the message is still streaming', () => {
    const huge = 'x'.repeat(LARGE_STREAMING_FENCE_CHARS + 1);
    render(<Markdown content={`\`\`\`json\n${huge}\n\`\`\`\n\nmore text`} isStreaming />);
    expect(screen.queryByTestId('aui-plain-streaming-fence')).not.toBeInTheDocument();
    expect(screen.getByTestId('aui-syntax-highlighter')).toBeInTheDocument();
  });

  it('falls back to a plain pre only for the active unmatched oversized fence', () => {
    const closed = 'c'.repeat(LARGE_STREAMING_FENCE_CHARS + 1);
    const open = 'o'.repeat(LARGE_STREAMING_FENCE_CHARS + 1);
    render(<Markdown content={`\`\`\`json\n${closed}\n\`\`\`\n\n\`\`\`json\n${open}`} isStreaming />);
    expect(screen.getByTestId('aui-plain-streaming-fence')).toBeInTheDocument();
    expect(screen.getByTestId('aui-syntax-highlighter')).toBeInTheDocument();
    expect(screen.getByTestId('aui-plain-streaming-fence')).toHaveTextContent(open.slice(0, 32));
  });

  it('highlights large fences once streaming finishes', () => {
    const huge = 'x'.repeat(LARGE_STREAMING_FENCE_CHARS + 1);
    render(<Markdown content={`\`\`\`json\n${huge}\n\`\`\``} isStreaming={false} />);
    expect(screen.queryByTestId('aui-plain-streaming-fence')).not.toBeInTheDocument();
    expect(screen.getByTestId('aui-syntax-highlighter')).toBeInTheDocument();
  });

  it('does not remount a completed code block when later markdown is appended', () => {
    let mountCount = 0;
    function TrackingHighlighter({ code, language }: SyntaxHighlighterProps) {
      useEffect(() => {
        mountCount += 1;
      }, []);
      return (
        <pre data-testid="aui-syntax-highlighter" data-language={language}>
          {code}
        </pre>
      );
    }

    const closedBody = 'const completed = true;';
    const prefix = `\`\`\`js\n${closedBody}\n\`\`\`\n\n`;

    const { rerender } = render(
      <SlotsProvider overrides={{ SyntaxHighlighter: TrackingHighlighter }}>
        <Markdown content={`${prefix}growing`} isStreaming />
      </SlotsProvider>,
    );

    expect(screen.getByTestId('aui-syntax-highlighter')).toHaveTextContent(closedBody);
    expect(mountCount).toBe(1);

    rerender(
      <SlotsProvider overrides={{ SyntaxHighlighter: TrackingHighlighter }}>
        <Markdown content={`${prefix}growing more text after the fence`} isStreaming />
      </SlotsProvider>,
    );

    expect(screen.getByTestId('aui-syntax-highlighter')).toHaveTextContent(closedBody);
    expect(mountCount).toBe(1);
  });
});
