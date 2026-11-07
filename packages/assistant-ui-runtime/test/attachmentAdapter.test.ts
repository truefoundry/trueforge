import type { PendingAttachment } from '@assistant-ui/core';
import { describe, expect, it } from 'vitest';

import { isDirectoryFile, trueForgeAttachmentAdapter } from '../src/attachmentAdapter.js';

async function addFile(file: File): Promise<PendingAttachment> {
  const result = await trueForgeAttachmentAdapter.add({ file });
  if (Symbol.asyncIterator in result) {
    throw new Error('expected PendingAttachment');
  }
  return result;
}

function unreadableZeroByteFile(name: string): File {
  const file = new File([], name);
  Object.defineProperty(file, 'slice', {
    value: () => ({
      arrayBuffer: () => Promise.reject(new DOMException('not found', 'NotFoundError')),
    }),
  });
  return file;
}

describe('trueForgeAttachmentAdapter', () => {
  it('accepts all file types', () => {
    expect(trueForgeAttachmentAdapter.accept).toBe('*');
  });

  it('add returns a pending attachment awaiting composer send', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const pending = await addFile(file);

    expect(pending).toMatchObject({
      type: 'file',
      name: 'notes.txt',
      contentType: 'text/plain',
      file,
      content: [],
      status: { type: 'requires-action', reason: 'composer-send' },
    });
    expect(pending.id).toBeTruthy();
  });

  it('add accepts readable empty files', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    await expect(addFile(file)).resolves.toMatchObject({ name: 'empty.txt' });
  });

  it('add rejects directory-like files that cannot be read', async () => {
    await expect(trueForgeAttachmentAdapter.add({ file: unreadableZeroByteFile('docs') })).rejects.toThrow(
      /Folders cannot be attached/,
    );
  });

  it('isDirectoryFile is true only when the file blob cannot be read', async () => {
    await expect(isDirectoryFile(new File(['x'], 'a.txt'))).resolves.toBe(false);
    await expect(isDirectoryFile(new File([], 'empty.txt'))).resolves.toBe(false);
    await expect(isDirectoryFile(unreadableZeroByteFile('docs'))).resolves.toBe(true);
  });

  it('send reads the file into a data URI file part', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const pending = await addFile(file);
    const complete = await trueForgeAttachmentAdapter.send(pending);

    expect(complete.status).toEqual({ type: 'complete' });
    expect(complete.content).toHaveLength(1);
    expect(complete.content[0]).toMatchObject({
      type: 'file',
      mimeType: 'text/plain',
      filename: 'notes.txt',
    });
    expect(complete.content[0]).toMatchObject({
      data: expect.stringMatching(/^data:text\/plain;base64,/),
    });
  });

  it('remove is a no-op', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const pending = await addFile(file);
    await expect(trueForgeAttachmentAdapter.remove(pending)).resolves.toBeUndefined();
  });
});
