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

  it('scans malformed markdown and css in linear time', () => {
    const unmatchedBrackets = '['.repeat(200_000);
    const started = performance.now();
    expect(extractReferences(unmatchedBrackets, 'markdown')).toEqual([]);
    expect(extractReferences(`${'url("'.repeat(50_000)}`, 'css')).toEqual(expect.any(Array));
    expect(extractReferences(`${'](a'.repeat(50_000)}`, 'markdown')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('finds markdown targets only when the link is closed', () => {
    expect(extractReferences('[a](one.png) ![b](two.png "title") [c](three.png', 'markdown')).toEqual(['one.png']);
    expect(extractReferences('[](empty) [x]()', 'markdown')).toEqual(expect.not.arrayContaining(['']));
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
