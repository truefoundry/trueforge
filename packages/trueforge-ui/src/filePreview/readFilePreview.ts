/** Cap preview reads so a huge sandbox file cannot freeze the chat. */
export const FILE_PREVIEW_BYTE_LIMIT = 2 * 1024 * 1024;

/** Prism is skipped above this so a long source file still paints as plain text. */
export const FILE_PREVIEW_HIGHLIGHT_CHAR_LIMIT = 100_000;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

const LANGUAGE_BY_EXT: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  json: 'json',
  css: 'css',
  scss: 'scss',
  xml: 'markup',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  graphql: 'graphql',
  toml: 'toml',
};

const HTML_EXT = new Set(['html', 'htm']);
const MARKDOWN_EXT = new Set(['md', 'markdown']);

export type ReadFilePreviewResult =
  | { status: 'text'; text: string; language?: string }
  | { status: 'markdown'; text: string }
  | { status: 'html'; text: string }
  | { status: 'media'; media: 'image' | 'pdf'; mimeType: string }
  | { status: 'unavailable'; message: string };

const EMPTY_FILE_MESSAGE = 'This file is empty.';
const TOO_LARGE_MESSAGE = 'This file is too large to preview. Download it to open it locally.';
const BINARY_MESSAGE = "This file can't be previewed here. Download it to open it locally.";

export function fileExtension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

function looksBinary(text: string): boolean {
  const sample = text.length > 8000 ? text.slice(0, 8000) : text;
  return sample.includes('\0');
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read file'));
    };
    reader.readAsText(blob);
  });
}

export function languageForFileName(name: string): string | undefined {
  return LANGUAGE_BY_EXT[fileExtension(name)];
}

/**
 * Artifact chips use a human label (`Sample HTML`) and a real sandbox path
 * (`/tmp/sample.html`). The path owns the type; the label is only a fallback.
 */
export function previewExtension({ name, path }: { name: string; path: string }): string {
  return fileExtension(path) || fileExtension(name);
}

/** Files that can paint a thumbnail in the message. Source and markdown stay as chips. */
export function inlinePreviewKind(source: { name: string; path: string }): 'html' | 'image' | 'pdf' | null {
  const extension = previewExtension(source);
  if (HTML_EXT.has(extension)) return 'html';
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_MIME_BY_EXT[extension] != null) return 'image';
  return null;
}

function looksLikeHtmlDocument(text: string): boolean {
  const start = text.trimStart().slice(0, 300).toLowerCase();
  return start.startsWith('<!doctype html') || start.startsWith('<html');
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s/m.test(text.trimStart().slice(0, 500));
}

export function blobWithMimeType(blob: Blob, mimeType: string): Blob {
  if (blob.type === mimeType) return blob;
  return new Blob([blob], { type: mimeType });
}

/**
 * Classifies a sandbox file for in-chat preview. Images and PDFs stay binary;
 * everything else is treated as text unless the bytes look binary.
 */
export async function readFilePreview(
  blob: Blob,
  source: { name: string; path: string },
): Promise<ReadFilePreviewResult> {
  if (blob.size === 0) {
    return { status: 'unavailable', message: EMPTY_FILE_MESSAGE };
  }
  if (blob.size > FILE_PREVIEW_BYTE_LIMIT) {
    return { status: 'unavailable', message: TOO_LARGE_MESSAGE };
  }

  const extension = previewExtension(source);
  const imageMime = IMAGE_MIME_BY_EXT[extension];
  if (imageMime != null) {
    return { status: 'media', media: 'image', mimeType: imageMime };
  }
  if (extension === 'pdf') {
    return { status: 'media', media: 'pdf', mimeType: 'application/pdf' };
  }

  const text = await readBlobText(blob);
  if (looksBinary(text)) {
    return { status: 'unavailable', message: BINARY_MESSAGE };
  }
  if (text.trim().length === 0) {
    return { status: 'unavailable', message: EMPTY_FILE_MESSAGE };
  }
  if (HTML_EXT.has(extension) || (extension.length === 0 && looksLikeHtmlDocument(text))) {
    return { status: 'html', text };
  }
  if (MARKDOWN_EXT.has(extension) || (extension.length === 0 && looksLikeMarkdown(text))) {
    return { status: 'markdown', text };
  }

  const language = LANGUAGE_BY_EXT[extension];
  if (language == null) return { status: 'text', text };
  return { status: 'text', text, language };
}
