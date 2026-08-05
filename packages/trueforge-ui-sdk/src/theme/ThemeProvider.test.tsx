// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from '../atoms/WelcomeScreen.js';
import { BrandIcon, BrandLogo } from './brand.js';
import { ThemeProvider, useBrand, useTheme } from './ThemeProvider.js';

function ModeProbe() {
  const { mode, preference, setTheme } = useTheme();
  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="preference">{preference}</output>
      <button type="button" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        system
      </button>
    </div>
  );
}

function BrandProbe() {
  const brand = useBrand();
  return <output data-testid="brand-name">{brand.name ?? 'none'}</output>;
}

describe('ThemeProvider', () => {
  it('applies controlled mode and ignores setTheme', () => {
    render(
      <ThemeProvider theme={{ mode: 'dark' }}>
        <ModeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    act(() => {
      screen.getByRole('button', { name: 'system' }).click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('toggles mode when uncontrolled', () => {
    render(
      <ThemeProvider>
        <ModeProbe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'dark' }).click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('exposes brand config and BrandLogo / BrandIcon', () => {
    render(
      <ThemeProvider theme={{ brand: { name: 'Acme' } }}>
        <BrandProbe />
        <BrandLogo />
        <BrandIcon className="size-4" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Acme');
    expect(screen.getAllByText('Acme').length).toBeGreaterThanOrEqual(1);
  });

  it('writes token CSS vars on the theme root', () => {
    const { container } = render(
      <ThemeProvider theme={{ tokens: { primary: '#e11d48' }, className: 'host-chat' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.classList.contains('host-chat')).toBe(true);
    expect(root.style.getPropertyValue('--primary')).toBe('#e11d48');
  });

  it('applies preset tokens', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.getAttribute('data-preset')).toBe('chatgpt');
    expect(root.style.getPropertyValue('--primary')).toBe('#0d0d0d');
    expect(root.style.getPropertyValue('--background')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      '"GeistSans", "GeistSans Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    );
    expect(root.style.fontFamily).toBe('');
    expect(root.style.getPropertyValue('--radius')).toBe('1.5rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('1.75rem');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#e9e9e980');
    expect(root.style.getPropertyValue('--user-bubble-foreground')).toBe('#0d0d0d');
  });

  it('applies chatgpt dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.style.getPropertyValue('--background')).toBe('#000000');
    expect(root.style.getPropertyValue('--card')).toBe('#212121');
    expect(root.style.getPropertyValue('--primary')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--secondary')).toBe('#303030');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#323232');
    expect(root.style.getPropertyValue('--user-bubble-foreground')).toBe('#ffffff');
  });

  it('applies claude palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.getAttribute('data-preset')).toBe('claude');
    expect(root.style.getPropertyValue('--background')).toBe('#f0ece0');
    expect(root.style.getPropertyValue('--foreground')).toBe('#1a1a18');
    expect(root.style.getPropertyValue('--card')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--primary')).toBe('#c96442');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    );
    expect(root.style.getPropertyValue('--radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#e5e0d6');
    expect(root.style.getPropertyValue('--user-bubble-foreground')).toBe('#1a1a18');
  });

  it('applies claude dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.style.getPropertyValue('--background')).toBe('#2b2a27');
    expect(root.style.getPropertyValue('--foreground')).toBe('#eeeeee');
    expect(root.style.getPropertyValue('--card')).toBe('#1f1e1b');
    expect(root.style.getPropertyValue('--primary')).toBe('#c96442');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#3d3a35');
    expect(root.style.getPropertyValue('--user-bubble-foreground')).toBe('#eeeeee');
  });

  it('applies gemini light palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.style.getPropertyValue('--background')).toBe('#fdfcfc');
    expect(root.style.getPropertyValue('--foreground')).toBe('#1f1f1f');
    expect(root.style.getPropertyValue('--primary')).toBe('#1f3b9b');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      '"GeistSans", "GeistSans Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    );
    expect(root.style.getPropertyValue('--radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('2rem');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#f3f6fc');
  });

  it('applies gemini dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = container.querySelector('.aui-theme-root') as HTMLElement;
    expect(root.style.getPropertyValue('--background')).toBe('#0c0c0c');
    expect(root.style.getPropertyValue('--card')).toBe('#1e1f20');
    expect(root.style.getPropertyValue('--primary')).toBe('#a8c7fa');
    expect(root.style.getPropertyValue('--primary-foreground')).toBe('#062e6f');
    expect(root.style.getPropertyValue('--ring')).toBe('#a8c7fa');
    expect(root.style.getPropertyValue('--user-bubble')).toBe('#222327');
  });

  it('preserves the semibold TrueFoundry welcome heading', () => {
    render(
      <ThemeProvider theme={{ preset: 'truefoundry', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'How can I help you today?' })).toHaveClass('font-semibold');
  });

  it('uses regular heading weight for the ChatGPT welcome', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'How can I help you today?' })).toHaveClass('font-normal');
    expect(container.querySelector('.aui-thread-welcome-root')).toHaveAttribute('data-preset', 'chatgpt');
  });

  it("renders Claude's filled sparkle welcome icon", () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );

    expect(container.querySelector('.aui-thread-welcome-root svg')).toHaveClass('fill-current');
  });

  it('renders the animated Gemini welcome glow', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'dark' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'How can I help you today?' })).toHaveClass(
      'font-normal',
      'duration-300',
    );
    expect(container.querySelector('[aria-hidden].motion-safe\\:animate-pulse')).toBeInTheDocument();
  });
});
