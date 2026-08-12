import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from '@/atoms/WelcomeScreen.js';
import { BrandLogo, useBrandName } from '@/theme/brand.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

function BrandNameProbe() {
  return <output data-testid="brand-name">{useBrandName()}</output>;
}

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

  it('labels the configured logo with the brand name', () => {
    render(
      <ThemeProvider theme={{ brand: { name: 'Acme', logo: { src: '/acme-logo.svg' } } }}>
        <BrandLogo className="logo-image" />
      </ThemeProvider>,
    );

    const logo = screen.getByRole('img', { name: 'Acme' });
    expect(logo).toHaveAttribute('src', '/acme-logo.svg');
    expect(logo).toHaveClass('logo-image');
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

  it('pairs a host name with the default mark when logo is omitted', () => {
    const { container } = render(
      <ThemeProvider theme={{ brand: { name: 'Acme' } }}>
        <BrandNameProbe />
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass('host-logo');
    expect(screen.getByTestId('brand-name')).toHaveTextContent('Acme');
  });

  it('treats a bare string as an image source', () => {
    render(
      <ThemeProvider theme={{ brand: { logo: '/acme-logo.svg', name: 'Acme' } }}>
        <BrandLogo className="logo-image" />
      </ThemeProvider>,
    );

    const img = screen.getByRole('img', { name: 'Acme' });
    expect(img).toHaveAttribute('src', '/acme-logo.svg');
    expect(img).toHaveClass('logo-image');
  });

  it('picks the light source in light mode and the dark source in dark mode', () => {
    const logo = { light: '/logo/light.svg', dark: '/logo/dark.svg' };

    const { rerender } = render(
      <ThemeProvider theme={{ mode: 'light', brand: { name: 'Acme', logo } }}>
        <BrandLogo />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/logo/light.svg');

    rerender(
      <ThemeProvider theme={{ mode: 'dark', brand: { name: 'Acme', logo } }}>
        <BrandLogo />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/logo/dark.svg');
  });

  it('falls back to the other mode when only one source is configured', () => {
    render(
      <ThemeProvider theme={{ mode: 'dark', brand: { name: 'Acme', logo: { light: '/logo/light.svg' } } }}>
        <BrandLogo />
      </ThemeProvider>,
    );

    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/logo/light.svg');
  });

  it('wraps the logo in a same-tab link when href is set', () => {
    render(
      <ThemeProvider
        theme={{ brand: { name: 'Acme', logo: { light: '/logo/light.svg', href: 'https://trueforge.dev' } } }}
      >
        <BrandLogo />
      </ThemeProvider>,
    );

    const link = screen.getByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', 'https://trueforge.dev');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('img')).toHaveAttribute('src', '/logo/light.svg');
  });

  it('lets a slot override replace the mark with a component', () => {
    function CustomMark({ className }: { className?: string }) {
      return <span className={className}>custom mark</span>;
    }

    render(
      <SlotsProvider overrides={{ BrandLogo: CustomMark }} theme={{ brand: { name: 'Acme', logo: '/logo.svg' } }}>
        <WelcomeScreen />
      </SlotsProvider>,
    );

    expect(screen.getByText('custom mark')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Acme' })).toBeNull();
  });

  it('falls back to the default mark when a logo config resolves to no source', () => {
    const { container } = render(
      <ThemeProvider theme={{ brand: { name: 'Acme', logo: { href: '/' } } }}>
        <BrandLogo className="host-logo" />
      </ThemeProvider>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass('host-logo');
  });
});
