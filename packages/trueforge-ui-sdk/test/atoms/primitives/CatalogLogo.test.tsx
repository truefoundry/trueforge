import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CatalogLogo } from '@/atoms/primitives/CatalogLogo.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function renderLogo({ mode, src }: { mode: 'light' | 'dark'; src: string }) {
  return render(
    <SlotsProvider theme={{ mode }}>
      <CatalogLogo src={src} alt="Provider" />
    </SlotsProvider>,
  );
}

describe('CatalogLogo', () => {
  it('renders the catalog URL in light mode', () => {
    renderLogo({ mode: 'light', src: 'https://assets.example/icon.png' });
    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute('src', 'https://assets.example/icon.png');
  });

  it('strips -dark in light mode when the catalog URL is dark-suffixed', () => {
    renderLogo({ mode: 'light', src: 'https://assets.example/icon-dark.png' });
    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute('src', 'https://assets.example/icon.png');
  });

  it('falls back to the dark catalog URL when the light sibling fails in light mode', () => {
    renderLogo({ mode: 'light', src: 'https://assets.example/icon-dark.png' });

    fireEvent.error(screen.getByRole('img', { name: 'Provider' }));

    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute(
      'src',
      'https://assets.example/icon-dark.png',
    );
  });

  it('prefers the dark sibling in dark mode', () => {
    renderLogo({ mode: 'dark', src: 'https://assets.example/icon.png' });
    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute(
      'src',
      'https://assets.example/icon-dark.png',
    );
  });

  it('falls back to the light URL when the dark sibling fails to load', () => {
    renderLogo({ mode: 'dark', src: 'https://assets.example/icon.png' });

    fireEvent.error(screen.getByRole('img', { name: 'Provider' }));

    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute('src', 'https://assets.example/icon.png');
  });

  it('keeps an already-dark catalog URL in dark mode', () => {
    renderLogo({ mode: 'dark', src: 'https://assets.example/github-dark.svg' });
    expect(screen.getByRole('img', { name: 'Provider' })).toHaveAttribute(
      'src',
      'https://assets.example/github-dark.svg',
    );
  });
});
