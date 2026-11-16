import { extractReferences, resolveReference } from '../../../src/artifacts/references';
import { rewriteSiteAbsoluteUrls } from '../../../src/artifacts/rewriteSiteUrls';

describe('artifact references', () => {
  it('follows html, css, and markdown references and ignores external urls', () => {
    expect(extractReferences('<link href="./app.css"><script src="/assets/app.js"></script>', 'html')).toEqual(
      expect.arrayContaining(['./app.css', '/assets/app.js']),
    );
    expect(extractReferences('@import "./theme.css"; body { background: url(../img/bg.png); }', 'css')).toEqual(
      expect.arrayContaining(['./theme.css', '../img/bg.png']),
    );
    expect(extractReferences('See [notes](./notes.md) and ![chart](chart.png)', 'markdown')).toEqual(
      expect.arrayContaining(['./notes.md', 'chart.png']),
    );
    expect(resolveReference('index.html', 'https://example.com/a.css')).toBeUndefined();
    expect(resolveReference('index.html', '/assets/app.css')).toEqual({ kind: 'site', path: 'assets/app.css' });
    expect(resolveReference('pages/index.html', '../img/bg.png')).toEqual({ kind: 'relative', path: 'img/bg.png' });
    expect(resolveReference('index.html', '../../secret.txt')).toBeUndefined();
  });

  it('rewrites root-absolute urls that exist in the bundle', () => {
    const rewritten = rewriteSiteAbsoluteUrls({
      content: '<link href="/assets/app.css"><a href="/missing.css">',
      files: ['assets/app.css'],
      entryDirectory: '',
      urlPrefix: '/artifact-content/token',
    });
    expect(rewritten).toBe('<link href="/artifact-content/token/assets/app.css"><a href="/missing.css">');
  });
});
