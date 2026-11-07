// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { partitionDroppedFiles } from '@/utils/partitionDroppedFiles.js';

describe('partitionDroppedFiles', () => {
  it('keeps files and counts directory entries', () => {
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    const fileItem = {
      kind: 'file' as const,
      getAsFile: () => note,
      webkitGetAsEntry: () => ({ isDirectory: false, isFile: true, name: 'note.txt' }) as FileSystemEntry,
    };
    const folderItem = {
      kind: 'file' as const,
      getAsFile: () => new File([], 'docs'),
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name: 'docs' }) as FileSystemEntry,
    };
    const dataTransfer = {
      items: {
        length: 2,
        0: fileItem,
        1: folderItem,
        [Symbol.iterator]: function* () {
          yield fileItem;
          yield folderItem;
        },
      },
      files: [note, new File([], 'docs')],
    } as unknown as DataTransfer;

    expect(partitionDroppedFiles(dataTransfer)).toEqual({
      files: [note],
      rejectedDirectoryCount: 1,
    });
  });

  it('falls back to dataTransfer.files when items is empty', () => {
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: { length: 0, [Symbol.iterator]: function* () {} },
      files: [note],
    } as unknown as DataTransfer;

    expect(partitionDroppedFiles(dataTransfer)).toEqual({ files: [note], rejectedDirectoryCount: 0 });
  });
});
