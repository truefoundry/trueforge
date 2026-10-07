// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalUrlConfirmProvider, MarkdownExternalLink } from '@/atoms/externalUrlConfirm.js';
import { EXTERNAL_URL_TRUST_STORAGE_KEY } from '@/atoms/externalUrlTrust.js';
import { LARGE_STREAMING_FENCE_CHARS, Markdown, getActiveStreamingFenceCode } from '@/atoms/Markdown.js';
import type { SyntaxHighlighterProps } from '@/atoms/SyntaxHighlighter.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

// @openuidev mocks are in testSetup.ts; they make OpenUiFenceBlock render
// a simple div with data-testid="aui-openui-renderer" synchronously.

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  window.localStorage.removeItem(EXTERNAL_URL_TRUST_STORAGE_KEY);
  vi.restoreAllMocks();
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

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

  it('marks external links for a new tab and confirms before opening', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Markdown content="See [docs](https://example.com/docs) for details." />);
    const link = screen.getByRole('link', { name: 'docs' });
    // Unapproved external destinations stay off href so middle-click / context-menu cannot bypass.
    expect(link).toHaveAttribute('href', '#');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('node');

    fireEvent.click(link);
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Open external link' })).toBeInTheDocument();
    expect(screen.getByTestId('aui-external-url-confirm-url')).toHaveTextContent('https://example.com/docs');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Open external link' })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();

    fireEvent.click(link);
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
  });

  it('confirms protocol-relative external links and blocks middle-click bypass', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Markdown content="See [cdn](//cdn.example.com/a) for details." />);
    const link = screen.getByRole('link', { name: 'cdn' });
    expect(link).toHaveAttribute('href', '#');

    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Open external link' })).toBeInTheDocument();
    expect(screen.getByTestId('aui-external-url-confirm-url')).toHaveTextContent('//cdn.example.com/a');

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    const expected = new URL('//cdn.example.com/a', window.location.href).href;
    expect(openSpy).toHaveBeenCalledWith(expected, '_blank', 'noopener,noreferrer');
  });

  it('blocks javascript, data, and vbscript href activation', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ExternalUrlConfirmProvider>
        <MarkdownExternalLink href="javascript:alert(1)">js</MarkdownExternalLink>
        <MarkdownExternalLink href="data:text/html,hi">data</MarkdownExternalLink>
        <MarkdownExternalLink href="vbscript:msgbox(1)">vb</MarkdownExternalLink>
      </ExternalUrlConfirmProvider>,
    );

    for (const name of ['js', 'data', 'vb'] as const) {
      const el = screen.getByText(name);
      expect(el).not.toHaveAttribute('href');
      fireEvent.click(el);
      fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    }

    expect(screen.queryByRole('dialog', { name: 'Open external link' })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('skips the link dialog after trusting a host', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Markdown content="See [docs](https://example.com/docs) for details." />);
    const link = screen.getByRole('link', { name: 'docs' });

    fireEvent.click(link);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('href', '#');

    fireEvent.click(link);
    expect(screen.queryByRole('dialog', { name: 'Open external link' })).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('does not confirm same-origin links', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const href = `${window.location.origin}/local-docs`;
    render(<Markdown content={`See [local](${href}) for details.`} />);
    fireEvent.click(screen.getByRole('link', { name: 'local' }));
    expect(screen.queryByRole('dialog', { name: 'Open external link' })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('blocks external images until confirmed', () => {
    render(<Markdown content={'![chart](https://cdn.example.com/a.png)'} />);
    const placeholder = screen.getByTestId('aui-external-image-placeholder');
    expect(placeholder).toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.example.com/a.png"]')).toBeNull();

    fireEvent.click(within(placeholder).getByRole('button', { name: 'Show image' }));
    const dialog = screen.getByRole('dialog', { name: 'Show external image' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show image' }));

    expect(screen.queryByTestId('aui-external-image-placeholder')).not.toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.example.com/a.png"]')).toBeTruthy();
  });

  it('blocks protocol-relative external images until confirmed', () => {
    render(<Markdown content={'![chart](//cdn.example.com/a.png)'} />);
    expect(screen.getByTestId('aui-external-image-placeholder')).toBeInTheDocument();
    expect(document.querySelector('img[src="//cdn.example.com/a.png"]')).toBeNull();
  });

  it('auto-loads external images for a trusted host', () => {
    window.localStorage.setItem(
      EXTERNAL_URL_TRUST_STORAGE_KEY,
      JSON.stringify({ version: 1, links: [], images: ['cdn.example.com'] }),
    );
    render(<Markdown content={'![chart](https://cdn.example.com/a.png)'} />);
    expect(screen.queryByTestId('aui-external-image-placeholder')).not.toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.example.com/a.png"]')).toBeTruthy();
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
