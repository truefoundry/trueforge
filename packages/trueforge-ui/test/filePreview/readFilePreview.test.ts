import { describe, expect, it } from 'vitest';

import {
  FILE_PREVIEW_BYTE_LIMIT,
  fileExtension,
  inlinePreviewKind,
  languageForFileName,
  readFilePreview,
} from '@/filePreview/readFilePreview.js';

describe('fileExtension', () => {
  it('reads the last extension and ignores a leading dot', () => {
    expect(fileExtension('report.TXT')).toBe('txt');
    expect(fileExtension('/tmp/chart.min.js')).toBe('js');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('README')).toBe('');
  });
});

function source(name: string, path = name) {
  return { name, path };
}

describe('readFilePreview', () => {
  it('classifies source, markup, and media from the file name', async () => {
    await expect(readFilePreview(new Blob(['export const n = 1;\n']), source('demo.js'))).resolves.toEqual({
      status: 'text',
      text: 'export const n = 1;\n',
      language: 'javascript',
    });
    await expect(readFilePreview(new Blob(['<h1>Hi</h1>']), source('page.html'))).resolves.toEqual({
      status: 'html',
      text: '<h1>Hi</h1>',
    });
    await expect(readFilePreview(new Blob(['# Notes\n']), source('notes.md'))).resolves.toEqual({
      status: 'markdown',
      text: '# Notes\n',
    });
    await expect(readFilePreview(new Blob(['plain']), source('notes.txt'))).resolves.toEqual({
      status: 'text',
      text: 'plain',
    });
    await expect(readFilePreview(new Blob([new Uint8Array([1, 2, 3])]), source('shot.png'))).resolves.toEqual({
      status: 'media',
      media: 'image',
      mimeType: 'image/png',
    });
    await expect(readFilePreview(new Blob([new Uint8Array([1, 2, 3])]), source('brief.pdf'))).resolves.toEqual({
      status: 'media',
      media: 'pdf',
      mimeType: 'application/pdf',
    });
  });

  it('uses the sandbox path when the chip label has no extension', async () => {
    const html = '<!DOCTYPE html><html><body><h1>Sample</h1></body></html>';
    await expect(readFilePreview(new Blob([html]), source('Sample HTML', '/tmp/sample.html'))).resolves.toEqual({
      status: 'html',
      text: html,
    });
    const markdown = '# Sample Markdown\n\n**Bold** text\n';
    await expect(readFilePreview(new Blob([markdown]), source('Sample Markdown', '/tmp/notes.md'))).resolves.toEqual({
      status: 'markdown',
      text: markdown,
    });
  });

  it('renders an extensionless html document instead of raw source', async () => {
    const html = '<!DOCTYPE html><html><body>Hi</body></html>';
    await expect(readFilePreview(new Blob([html]), source('Sample HTML', '/tmp/Sample HTML'))).resolves.toEqual({
      status: 'html',
      text: html,
    });
  });

  it('renders an extensionless markdown note that starts with a heading', async () => {
    const markdown = '# Sample Markdown Preview\n\n**Bold** text\n';
    await expect(
      readFilePreview(new Blob([markdown]), source('Sample Markdown', '/tmp/Sample Markdown')),
    ).resolves.toEqual({
      status: 'markdown',
      text: markdown,
    });
  });

  it('refuses empty, oversized, and binary files', async () => {
    await expect(readFilePreview(new Blob([]), source('empty.txt'))).resolves.toEqual({
      status: 'unavailable',
      message: 'This file is empty.',
    });
    await expect(
      readFilePreview(new Blob([new Uint8Array(FILE_PREVIEW_BYTE_LIMIT + 1)]), source('big.txt')),
    ).resolves.toEqual({
      status: 'unavailable',
      message: 'This file is too large to preview. Download it to open it locally.',
    });
    await expect(readFilePreview(new Blob([new Uint8Array([0, 1, 2])]), source('data.txt'))).resolves.toEqual({
      status: 'unavailable',
      message: "This file can't be previewed here. Download it to open it locally.",
    });
  });

  it('maps a known source extension to a highlighter language', () => {
    expect(languageForFileName('main.py')).toBe('python');
    expect(languageForFileName('notes.txt')).toBeUndefined();
  });

  it('picks a chat thumbnail for pages and images, and a chip for source', () => {
    expect(inlinePreviewKind(source('Metrics', '/tmp/metrics.html'))).toBe('html');
    expect(inlinePreviewKind(source('chart.png'))).toBe('image');
    expect(inlinePreviewKind(source('brief.pdf'))).toBe('pdf');
    expect(inlinePreviewKind(source('main.py'))).toBeNull();
    expect(inlinePreviewKind(source('Sample HTML', '/tmp/Sample HTML'))).toBeNull();
  });
});
