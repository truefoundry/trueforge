import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from '@/atoms/WelcomeScreen.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

describe('WelcomeScreen', () => {
  it('renders the default heading and brand icon outside a provider', () => {
    const { container } = render(<WelcomeScreen className="host-welcome" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'How can I help you today?' });
    const root = container.querySelector('[data-preset="trueforge"]');
    expect(root).toHaveClass('aui-thread-welcome-root', 'host-welcome');
    expect(root?.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(heading).toHaveClass('font-semibold', 'delay-75');
  });

  it('renders a custom heading and icon', () => {
    render(<WelcomeScreen heading="Start a task" icon={<span aria-label="Custom welcome icon">★</span>} />);

    expect(screen.getByRole('heading', { name: 'Start a task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom welcome icon')).toHaveTextContent('★');
  });

  it('allows callers to explicitly suppress the icon', () => {
    const { container } = render(<WelcomeScreen icon={null} />);

    const heading = screen.getByRole('heading');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(heading).not.toHaveClass('delay-75');
  });

  it('uses preset-specific icon behavior', () => {
    const { container, rerender } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );
    expect(container.querySelector('.aui-thread-welcome-root svg')).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveClass('font-normal');

    rerender(
      <ThemeProvider theme={{ preset: 'claude', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );
    expect(container.querySelector('.aui-thread-welcome-root svg')).toHaveClass('fill-current');

    rerender(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );
    expect(container.querySelector('.aui-thread-welcome-root')).toHaveClass('py-8');
    expect(container.querySelector('[aria-hidden].motion-safe\\:animate-pulse')).toBeInTheDocument();
  });
});
