import {
  ArtifactBundleError,
  collectArtifactBundle,
  type ArtifactLimits,
  type SandboxFileReader,
} from '../../../src/artifacts/collectBundle';

const LIMITS: ArtifactLimits = { maxFiles: 20, maxFileBytes: 1024 * 1024, maxVersionBytes: 5 * 1024 * 1024 };

function fakeSandbox(
  files: Record<string, string>,
  options: { truncated?: boolean } = {},
): SandboxFileReader & { listings: string[]; reads: string[] } {
  const listings: string[] = [];
  const reads: string[] = [];
  return {
    listings,
    reads,
    listDirectory(root) {
      listings.push(root);
      const prefix = root === '/' ? '/' : `${root}/`;
      const listed = Object.entries(files)
        .filter(([filePath]) => filePath.startsWith(prefix))
        .map(([filePath, body]) => ({ path: filePath.slice(prefix.length), sizeBytes: Buffer.byteLength(body) }));
      return Promise.resolve({ files: listed, truncated: options.truncated ?? false });
    },
    readFile(absolutePath) {
      reads.push(absolutePath);
      const body = files[absolutePath];
      return body === undefined
        ? Promise.reject(new Error(`missing ${absolutePath}`))
        : Promise.resolve(Buffer.from(body));
    },
  };
}

describe('collectArtifactBundle', () => {
  it('bundles the files a page references with one directory listing', async () => {
    const sandbox = fakeSandbox({
      '/work/report/index.html': '<link href="styles.css"><script src="js/app.js"></script><img src="/img/logo.png">',
      '/work/report/styles.css': 'body { background: url(img/bg.png); }',
      '/work/report/js/app.js': 'fetch("../data/regions.csv")',
      '/work/report/img/logo.png': 'png',
      '/work/report/img/bg.png': 'png',
      '/work/report/data/regions.csv': 'a,b',
      '/work/report/unrelated.txt': 'not referenced',
    });

    const bundle = await collectArtifactBundle({
      entryPath: '/work/report/index.html',
      sandbox,
      limits: LIMITS,
    });

    expect(bundle.root).toBe('/work/report');
    expect(bundle.entryPath).toBe('index.html');
    expect(bundle.files.map(file => file.bundlePath)).toEqual([
      'data/regions.csv',
      'img/bg.png',
      'img/logo.png',
      'index.html',
      'js/app.js',
      'styles.css',
    ]);
    expect(bundle.missing).toEqual([]);
    expect(sandbox.listings).toEqual(['/work/report']);
  });

  it('never includes files outside the entry directory', async () => {
    const sandbox = fakeSandbox({
      '/opt/tf/uploads/report/index.html': '<img src="../../.git-credentials"><img src="../shared/logo.png">',
      '/opt/tf/.git-credentials': 'https://user:token@example.com',
      '/opt/tf/uploads/shared/logo.png': 'png',
    });

    const bundle = await collectArtifactBundle({
      entryPath: '/opt/tf/uploads/report/index.html',
      sandbox,
      limits: LIMITS,
    });

    expect(bundle.files.map(file => file.bundlePath)).toEqual(['index.html']);
    expect(bundle.missing).toEqual(
      expect.arrayContaining(['/opt/tf/.git-credentials', '/opt/tf/uploads/shared/logo.png']),
    );
    expect(sandbox.reads).toEqual(['/opt/tf/uploads/report/index.html']);
  });

  it('never publishes hidden files or folders next to the page', async () => {
    const sandbox = fakeSandbox({
      '/work/report/index.html':
        '<img src=".env"><img src=".secrets/key.png"><img src="img/.hidden.png"><img src="ok.png">',
      '/work/report/.env': 'TOKEN=1',
      '/work/report/.secrets/key.png': 'k',
      '/work/report/img/.hidden.png': 'h',
      '/work/report/ok.png': 'ok',
    });

    const bundle = await collectArtifactBundle({ entryPath: '/work/report/index.html', sandbox, limits: LIMITS });

    expect(bundle.files.map(file => file.bundlePath)).toEqual(['index.html', 'ok.png']);
    expect(sandbox.reads).not.toContain('/work/report/.env');
    expect(bundle.missing).toHaveLength(3);
  });

  it('reports references that do not exist as missing without more listings', async () => {
    const references = Array.from({ length: 200 }, (_, index) => `<img src="gone/${String(index)}.png">`).join('');
    const sandbox = fakeSandbox({ '/work/report/index.html': references });

    const bundle = await collectArtifactBundle({ entryPath: '/work/report/index.html', sandbox, limits: LIMITS });

    expect(sandbox.listings).toEqual(['/work/report']);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.missing.length).toBeGreaterThan(0);
    expect(bundle.missing.length).toBeLessThanOrEqual(50);
  });

  it('rejects a truncated listing instead of reporting files as missing', async () => {
    const sandbox = fakeSandbox({ '/work/index.html': '<img src="a.png">', '/work/a.png': 'a' }, { truncated: true });

    await expect(
      collectArtifactBundle({ entryPath: '/work/index.html', sandbox, limits: LIMITS }),
    ).rejects.toMatchObject({ statusCode: 413, code: 'artifact_too_large' });
  });

  it('enforces the file count and size limits', async () => {
    const many = fakeSandbox({
      '/work/index.html': '<img src="a.png"><img src="b.png">',
      '/work/a.png': 'a',
      '/work/b.png': 'b',
    });
    await expect(
      collectArtifactBundle({ entryPath: '/work/index.html', sandbox: many, limits: { ...LIMITS, maxFiles: 2 } }),
    ).rejects.toBeInstanceOf(ArtifactBundleError);

    const large = fakeSandbox({ '/work/index.html': '<img src="a.png">', '/work/a.png': 'x'.repeat(2048) });
    await expect(
      collectArtifactBundle({
        entryPath: '/work/index.html',
        sandbox: large,
        limits: { ...LIMITS, maxFileBytes: 1024 },
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects an entry that is not an absolute path or does not exist', async () => {
    const sandbox = fakeSandbox({ '/work/index.html': '<p>hi</p>' });
    await expect(collectArtifactBundle({ entryPath: 'index.html', sandbox, limits: LIMITS })).rejects.toMatchObject({
      statusCode: 422,
      code: 'invalid_path',
    });
    await expect(
      collectArtifactBundle({ entryPath: '/work/other.html', sandbox, limits: LIMITS }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'invalid_path' });
  });

  it('handles a page at the filesystem root', async () => {
    const sandbox = fakeSandbox({ '/index.html': '<img src="a.png">', '/a.png': 'a' });
    const bundle = await collectArtifactBundle({ entryPath: '/index.html', sandbox, limits: LIMITS });
    expect(bundle.files.map(file => file.bundlePath)).toEqual(['a.png', 'index.html']);
  });
});
