import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandIcon, BrandLogo } from '@/theme/brand.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';

describe('BrandIcon and BrandLogo', () => {
  it('renders accessible default branding without a provider', () => {
    const { container } = render(
      <>
        <BrandLogo className="host-logo" />
        <BrandIcon className="host-icon" />
      </>,
    );

    expect(screen.getByText('TrueFoundry').parentElement).toHaveClass('host-logo');
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(2);
    expect(icons[1]).toHaveClass('host-icon');
  });

  it('renders configured image descriptors with alt text and classes', () => {
    render(
      <ThemeProvider
        theme={{
          brand: {
            logo: { src: '/acme-logo.svg', alt: 'Acme logo' },
            icon: { src: '/acme-icon.svg', alt: 'Acme icon' },
          },
        }}
      >
        <BrandLogo className="logo-image" />
        <BrandIcon className="icon-image" />
      </ThemeProvider>,
    );

    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveAttribute('src', '/acme-logo.svg');
    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveClass('logo-image');
    expect(screen.getByRole('img', { name: 'Acme icon' })).toHaveAttribute('src', '/acme-icon.svg');
    expect(screen.getByRole('img', { name: 'Acme icon' })).toHaveClass('icon-image');
  });

  it('supports render callbacks and passes through the requested class', () => {
    render(
      <ThemeProvider
        theme={{
          brand: {
            logo: ({ className }) => <span className={className}>Callback logo</span>,
            icon: ({ className }) => <span className={className}>Callback icon</span>,
          },
        }}
      >
        <BrandLogo className="custom-logo" />
        <BrandIcon className="custom-icon" />
      </ThemeProvider>,
    );

    expect(screen.getByText('Callback logo')).toHaveClass('custom-logo');
    expect(screen.getByText('Callback icon')).toHaveClass('custom-icon');
  });
});
