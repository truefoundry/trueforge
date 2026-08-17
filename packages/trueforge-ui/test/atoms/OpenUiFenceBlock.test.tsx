// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OpenUiFenceBlock } from '@/atoms/OpenUiFenceBlock.js';

const openUiMocks = vi.hoisted(() => ({
  library: { name: 'test-openui-library' },
  renderer: vi.fn(),
}));

vi.mock('@openuidev/react-lang', () => ({
  Renderer: ({ response, library, isStreaming }: { response: string; library: unknown; isStreaming?: boolean }) => {
    openUiMocks.renderer({ response, library, isStreaming });
    return (
      <div data-testid="openui-renderer" data-streaming={String(Boolean(isStreaming))}>
        {response}
      </div>
    );
  },
}));

vi.mock('@openuidev/react-ui', () => ({
  ThemeProvider: ({ mode, children }: { mode: string; children: ReactNode }) => (
    <div data-testid="openui-theme" data-mode={mode}>
      {children}
    </div>
  ),
  openuiLibrary: openUiMocks.library,
}));

describe('OpenUiFenceBlock', () => {
  it('passes content, streaming state, and the OpenUI library to the renderer', () => {
    render(<OpenUiFenceBlock content='{"type":"Text","text":"Working"}' isStreaming />);

    expect(screen.getByTestId('openui-renderer')).toHaveTextContent('{"type":"Text","text":"Working"}');
    expect(screen.getByTestId('openui-renderer')).toHaveAttribute('data-streaming', 'true');
    expect(openUiMocks.renderer).toHaveBeenCalledWith({
      response: '{"type":"Text","text":"Working"}',
      library: openUiMocks.library,
      isStreaming: true,
    });
  });

  it('selects light and dark OpenUI themes from the public prop', () => {
    const { rerender } = render(<OpenUiFenceBlock content="content" />);
    expect(screen.getByTestId('openui-theme')).toHaveAttribute('data-mode', 'light');

    rerender(<OpenUiFenceBlock content="content" darkTheme />);
    expect(screen.getByTestId('openui-theme')).toHaveAttribute('data-mode', 'dark');
  });
});
