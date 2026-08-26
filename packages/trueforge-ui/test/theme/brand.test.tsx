import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from '@/atoms/WelcomeScreen.js';
import { BrandLogo, resolveBrandChrome, useBrandName } from '@/theme/brand.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

function BrandNameProbe() {
  return <output data-testid="brand-name">{useBrandName()}</output>;
}

describe('resolveBrandChrome', () => {
  it('uses the default wordmark when brand.mode is omitted', () => {
    expect(resolveBrandChrome(undefined)).toEqual({
      expandedVariant: 'logo',
      collapsedVariant: 'icon',
      showTitle: false,
    });
    expect(resolveBrandChrome({})).toEqual({
      expandedVariant: 'logo',
      collapsedVariant: 'icon',
      showTitle: false,
    });
  });

  it('shows icon + title for mode icon-title', () => {
    expect(resolveBrandChrome({ mode: 'icon-title', name: 'Acme', icon: '/icon.svg' })).toEqual({
      expandedVariant: 'icon',
      collapsedVariant: 'icon',
      showTitle: true,
    });
  });

  it('hides the text title for mode icon-only', () => {
    expect(resolveBrandChrome({ mode: 'icon-only', name: 'Acme', icon: '/icon.svg' })).toEqual({
      expandedVariant: 'icon',
      collapsedVariant: 'icon',
      showTitle: false,
    });
  });

  it('uses the wide logo for mode logo', () => {
    expect(resolveBrandChrome({ mode: 'logo', name: 'Acme', icon: '/icon.svg', logo: '/wordmark.svg' })).toEqual({
      expandedVariant: 'logo',
      collapsedVariant: 'icon',
      showTitle: false,
    });
  });

  it('pairs a host name with the default mark in icon-title without icon', () => {
    expect(resolveBrandChrome({ mode: 'icon-title', name: 'Acme' })).toEqual({
      expandedVariant: 'icon',
      collapsedVariant: 'icon',
      showTitle: true,
    });
  });
});

describe('BrandLogo', () => {
  it('renders the default mark without a provider', () => {
    const { container } = render(<BrandLogo className="host-logo" />);

    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).toHaveClass('host-logo');
    expect(icon).toHaveAttribute('viewBox', '0 0 140 140');
  });

  it('uses the dark logomark in dark mode', () => {
    const { container } = render(
      <ThemeProvider theme={{ mode: 'dark' }}>
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).toHaveClass('host-logo');
    expect(icon).toHaveAttribute('viewBox', '0 0 120 120');
  });

  it('labels the configured icon with the brand name', () => {
    render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: { src: '/acme-icon.svg' } } }}>
        <BrandLogo className="logo-image" />
      </ThemeProvider>,
    );

    const logo = screen.getByRole('img', { name: 'Acme' });
    expect(logo).toHaveAttribute('src', '/acme-icon.svg');
    expect(logo).toHaveClass('logo-image');
  });

  it('keeps the brand name as alt for icon-only chrome', () => {
    render(
      <ThemeProvider theme={{ brand: { mode: 'icon-only', name: 'Acme', icon: '/acme-icon.svg' } }}>
        <BrandNameProbe />
        <BrandLogo />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('brand-name')).toHaveTextContent('Acme');
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/acme-icon.svg');
  });

  it('renders the default mark and name when brand is omitted', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'claude' }}>
        <BrandNameProbe />
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass('host-logo');
    expect(screen.getByTestId('brand-name')).toHaveTextContent('TrueForge');
  });

  it('renders the default wordmark for the logo variant', () => {
    const { container, rerender } = render(
      <ThemeProvider theme={{ mode: 'light' }}>
        <BrandLogo variant="logo" className="host-logo" />
      </ThemeProvider>,
    );

    const light = screen.getByRole('img', { name: 'TrueForge' });
    expect(light).toHaveClass('host-logo', 'w-auto');
    expect(light).toHaveAttribute('viewBox', '0 0 614 100');
    // Sizing must come from the viewBox, not svgr's 1em width/height.
    expect(light).not.toHaveAttribute('width');
    expect(light).not.toHaveAttribute('height');
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeNull();

    rerender(
      <ThemeProvider theme={{ mode: 'dark' }}>
        <BrandLogo variant="logo" className="host-logo" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'TrueForge' })).toHaveAttribute('viewBox', '0 0 737 120');
  });

  it('pairs a host name with the default mark when icon is omitted', () => {
    const { container } = render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <BrandNameProbe />
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass('host-logo');
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Acme');
  });

  it('treats a bare string as an icon source', () => {
    render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', icon: '/acme-icon.svg', name: 'Acme' } }}>
        <BrandLogo className="logo-image" />
      </ThemeProvider>,
    );

    const img = screen.getByRole('img', { name: 'Acme' });
    expect(img).toHaveAttribute('src', '/acme-icon.svg');
    expect(img).toHaveClass('logo-image');
  });

  it('picks the light source in light mode and the dark source in dark mode', () => {
    const icon = { light: '/icon/light.svg', dark: '/icon/dark.svg' };

    const { rerender } = render(
      <ThemeProvider theme={{ mode: 'light', brand: { mode: 'icon-title', name: 'Acme', icon } }}>
        <BrandLogo />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/icon/light.svg');

    rerender(
      <ThemeProvider theme={{ mode: 'dark', brand: { mode: 'icon-title', name: 'Acme', icon } }}>
        <BrandLogo />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/icon/dark.svg');
  });

  it('falls back to the other mode when only one source is configured', () => {
    render(
      <ThemeProvider
        theme={{ mode: 'dark', brand: { mode: 'icon-title', name: 'Acme', icon: { light: '/icon/light.svg' } } }}
      >
        <BrandLogo />
      </ThemeProvider>,
    );

    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/icon/light.svg');
  });

  it('uses the wide logo only for the logo variant', () => {
    const brand = {
      mode: 'logo' as const,
      name: 'Acme',
      icon: '/acme-icon.svg',
      logo: '/acme-wordmark.svg',
    };
    const { rerender } = render(
      <ThemeProvider theme={{ brand }}>
        <BrandLogo variant="icon" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/acme-icon.svg');

    rerender(
      <ThemeProvider theme={{ brand }}>
        <BrandLogo variant="logo" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/acme-wordmark.svg');
  });

  it('falls back to the square icon when the wide logo is omitted from BrandLogo logo variant', () => {
    render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: '/acme-icon.svg' } }}>
        <BrandLogo variant="logo" />
      </ThemeProvider>,
    );

    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/acme-icon.svg');
  });

  it('wraps the logo in a same-tab link when href is set', () => {
    render(
      <ThemeProvider
        theme={{
          brand: {
            mode: 'icon-title',
            name: 'Acme',
            icon: { light: '/icon/light.svg' },
            href: 'https://trueforge.dev',
          },
        }}
      >
        <BrandLogo />
      </ThemeProvider>,
    );

    const link = screen.getByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', 'https://trueforge.dev');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('img')).toHaveAttribute('src', '/icon/light.svg');
  });

  it('lets a slot override replace the mark with a component', () => {
    function CustomMark({ className }: { className?: string }) {
      return <span className={className}>custom mark</span>;
    }

    render(
      <SlotsProvider
        overrides={{ BrandLogo: CustomMark }}
        theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: '/icon.svg' } }}
      >
        <WelcomeScreen />
      </SlotsProvider>,
    );

    expect(screen.getByText('custom mark')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Acme' })).toBeNull();
  });

  it('falls back to the default mark when an icon config resolves to no source', () => {
    const { container } = render(
      <ThemeProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: {}, href: '/' } }}>
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass('host-logo');
  });
});
