import { describe, expect, it } from 'vitest';

import { resolveCatalogLogoSrc, toDarkCatalogLogoUrl, toLightCatalogLogoUrl } from '@/utils/catalogLogo.js';

describe('toDarkCatalogLogoUrl', () => {
  it('inserts -dark before the file extension', () => {
    expect(toDarkCatalogLogoUrl('https://assets.example/icon.png')).toBe('https://assets.example/icon-dark.png');
    expect(toDarkCatalogLogoUrl('https://assets.production.truefoundry.com/openai.svg')).toBe(
      'https://assets.production.truefoundry.com/openai-dark.svg',
    );
  });

  it('preserves query and hash suffixes', () => {
    expect(toDarkCatalogLogoUrl('https://assets.example/icon.png?v=2#mark')).toBe(
      'https://assets.example/icon-dark.png?v=2#mark',
    );
  });

  it('returns undefined when the URL is already dark-suffixed', () => {
    expect(toDarkCatalogLogoUrl('https://assets.example/icon-dark.png')).toBeUndefined();
    expect(toDarkCatalogLogoUrl('https://assets.example/Sentry-Dark.svg')).toBeUndefined();
  });

  it('returns undefined for paths without a file extension', () => {
    expect(toDarkCatalogLogoUrl('https://assets.example/icon')).toBeUndefined();
  });
});

describe('toLightCatalogLogoUrl', () => {
  it('strips -dark before the file extension', () => {
    expect(toLightCatalogLogoUrl('https://assets.example/icon-dark.png')).toBe('https://assets.example/icon.png');
    expect(toLightCatalogLogoUrl('https://assets.production.truefoundry.com/github-dark.svg')).toBe(
      'https://assets.production.truefoundry.com/github.svg',
    );
  });

  it('preserves query and hash suffixes', () => {
    expect(toLightCatalogLogoUrl('https://assets.example/icon-dark.png?v=2#mark')).toBe(
      'https://assets.example/icon.png?v=2#mark',
    );
  });

  it('returns undefined when the URL is not dark-suffixed', () => {
    expect(toLightCatalogLogoUrl('https://assets.example/icon.png')).toBeUndefined();
    expect(toLightCatalogLogoUrl('https://assets.example/icon-darkmode.png')).toBeUndefined();
  });
});

describe('resolveCatalogLogoSrc', () => {
  it('keeps a light catalog URL in light mode', () => {
    expect(resolveCatalogLogoSrc({ src: 'https://assets.example/icon.png', mode: 'light' })).toBe(
      'https://assets.example/icon.png',
    );
  });

  it('strips -dark in light mode when the catalog URL is dark-suffixed', () => {
    expect(resolveCatalogLogoSrc({ src: 'https://assets.example/github-dark.svg', mode: 'light' })).toBe(
      'https://assets.example/github.svg',
    );
  });

  it('prefers the dark sibling in dark mode', () => {
    expect(resolveCatalogLogoSrc({ src: 'https://assets.example/icon.png', mode: 'dark' })).toBe(
      'https://assets.example/icon-dark.png',
    );
  });

  it('keeps a dark-suffixed catalog URL in dark mode', () => {
    expect(resolveCatalogLogoSrc({ src: 'https://assets.example/icon-dark.png', mode: 'dark' })).toBe(
      'https://assets.example/icon-dark.png',
    );
  });
});
