// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/atoms/Markdown.js';

// @openuidev mocks are in testSetup.ts; they make OpenUiFenceBlock render
// a simple div with data-testid="aui-openui-renderer" synchronously.

describe('Markdown', () => {
  it('renders basic markdown formatting', () => {
    render(<Markdown content="**bold** text" />);
    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
    expect(strong.closest('.markdown-body')).toBeTruthy();
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
});
