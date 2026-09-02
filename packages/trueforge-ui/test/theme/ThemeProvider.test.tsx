// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WelcomeScreen } from '@/atoms/WelcomeScreen.js';
import { BrandLogo } from '@/theme/brand.js';
import { ThemeProvider, useBrand, useTheme } from '@/theme/ThemeProvider.js';

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

function getThemeRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.aui-theme-root');
  if (root === null) {
    throw new Error('Expected theme root');
  }
  return root;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.getElementById('trueforge-ui-styles')?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
    document.getElementById('trueforge-ui-styles')?.remove();
  });

  it('applies controlled dark mode on the theme root only', () => {
    const { container } = render(
      <ThemeProvider theme={{ mode: 'dark' }}>
        <ModeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(getThemeRoot(container)).toHaveClass('dark');
    expect(getThemeRoot(container)).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('requires a provider for useTheme', () => {
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within a ThemeProvider');
  });

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
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(getThemeRoot(document.body).classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('aui-theme-preference')).toBe('dark');
  });

  it('follows system preference changes and removes the listener on unmount', () => {
    let systemDark = false;
    const listeners = new Set<() => void>();
    const addEventListener = vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    });
    const removeEventListener = vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return systemDark;
        },
        addEventListener,
        removeEventListener,
      })),
    );
    localStorage.setItem('aui-theme-preference', 'system');

    const { unmount, container } = render(
      <ThemeProvider>
        <ModeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(getThemeRoot(container).classList.contains('dark')).toBe(false);

    systemDark = true;
    act(() => {
      for (const listener of listeners) listener();
    });

    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(getThemeRoot(container).classList.contains('dark')).toBe(true);

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('exposes brand config and labels BrandLogo with the brand name', () => {
    render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: '/acme.svg' } }}>
        <BrandProbe />
        <BrandLogo className="size-4" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Acme');
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/acme.svg');
  });

  it('writes token CSS vars on the theme root', () => {
    const { container } = render(
      <ThemeProvider theme={{ tokens: { primaryButtonBg: '#e11d48' }, className: 'host-chat' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.classList.contains('host-chat')).toBe(true);
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#e11d48');
  });

  it('applies preset tokens', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.getAttribute('data-preset')).toBe('chatgpt');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#0d0d0d');
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      '"GeistSans", "GeistSans Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    );
    expect(root.style.fontFamily).toBe('');
    expect(root.style.getPropertyValue('--radius')).toBe('1.5rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('1.75rem');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#e9e9e980');
    expect(root.style.getPropertyValue('--user-message-text')).toBe('#0d0d0d');
    expect(root.style.getPropertyValue('--input-box-bg')).toBe('#ffffff');
  });

  it('applies chatgpt dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'chatgpt', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#000000');
    expect(root.style.getPropertyValue('--card-bg')).toBe('#212121');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--secondary-bg')).toBe('#303030');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#323232');
    expect(root.style.getPropertyValue('--user-message-text')).toBe('#ffffff');
  });

  it('applies claude palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.getAttribute('data-preset')).toBe('claude');
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#f0ece0');
    expect(root.style.getPropertyValue('--text-primary')).toBe('#1a1a18');
    expect(root.style.getPropertyValue('--card-bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#c96442');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    );
    expect(root.style.getPropertyValue('--radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#e5e0d6');
    expect(root.style.getPropertyValue('--user-message-text')).toBe('#1a1a18');
  });

  it('applies claude dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#2b2a27');
    expect(root.style.getPropertyValue('--text-primary')).toBe('#eeeeee');
    expect(root.style.getPropertyValue('--card-bg')).toBe('#1f1e1b');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#c96442');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#3d3a35');
    expect(root.style.getPropertyValue('--user-message-text')).toBe('#eeeeee');
  });

  it('applies gemini light palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'light' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#fdfcfc');
    expect(root.style.getPropertyValue('--text-primary')).toBe('#1f1f1f');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#1f3b9b');
    expect(root.style.getPropertyValue('--font-agent-ui')).toBe(
      '"GeistSans", "GeistSans Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    );
    expect(root.style.getPropertyValue('--radius')).toBe('1rem');
    expect(root.style.getPropertyValue('--composer-radius')).toBe('2rem');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#f3f6fc');
  });

  it('applies gemini dark palette', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'gemini', mode: 'dark' }}>
        <span>child</span>
      </ThemeProvider>,
    );
    const root = getThemeRoot(container);
    expect(root.style.getPropertyValue('--primary-bg')).toBe('#0c0c0c');
    expect(root.style.getPropertyValue('--card-bg')).toBe('#1e1f20');
    expect(root.style.getPropertyValue('--primary-button-bg')).toBe('#a8c7fa');
    expect(root.style.getPropertyValue('--primary-button-text')).toBe('#062e6f');
    expect(root.style.getPropertyValue('--focus-ring')).toBe('#a8c7fa');
    expect(root.style.getPropertyValue('--user-message-bg')).toBe('#222327');
  });

  it('preserves the semibold TrueFoundry welcome heading', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'trueforge', mode: 'light' }}>
        <WelcomeScreen />
      </ThemeProvider>,
    );

    expect(getThemeRoot(container).style.getPropertyValue('--font-agent-ui')).toBe(
      '"Google Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
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
