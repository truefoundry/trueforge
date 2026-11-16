import { describe, expect, it } from 'vitest';

import { sandboxEntryPath } from '@/atoms/artifacts/sandboxEntryPath.js';

describe('sandboxEntryPath', () => {
  it('joins a bundle-relative entry onto its source root', () => {
    expect(sandboxEntryPath({ sourceRoot: '/workspace/site', entryPath: 'index.html' })).toBe(
      '/workspace/site/index.html',
    );
    expect(sandboxEntryPath({ sourceRoot: '/workspace/site', entryPath: 'pages/index.html' })).toBe(
      '/workspace/site/pages/index.html',
    );
  });

  it('keeps a root entry absolute', () => {
    expect(sandboxEntryPath({ sourceRoot: '/', entryPath: 'index.html' })).toBe('/index.html');
  });
});
