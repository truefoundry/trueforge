import type { AttachmentAdapter, PendingAttachment } from '@assistant-ui/core';

const bytesToBase64 = (bytes: Uint8Array): string => globalThis.Buffer.from(bytes).toString('base64');

const getFileDataURL = async (file: File): Promise<string> => {
  if (typeof FileReader === 'undefined') {
    const buffer = await file.arrayBuffer();
    return `data:${file.type};base64,${bytesToBase64(new Uint8Array(buffer))}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Attachment reader returned non-text data.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read attachment.'));
    };
    reader.readAsDataURL(file);
  });
};

/**
 * Reads composer files into `CompleteAttachment` `file` parts for send.
 * Wire via `adapters: { attachments: trueForgeAttachmentAdapter }`.
 */
export const trueForgeAttachmentAdapter: AttachmentAdapter = {
  accept: '*',
  add({ file }) {
    return Promise.resolve({
      id: globalThis.crypto.randomUUID(),
      type: 'file',
      name: file.name,
      file,
      contentType: file.type,
      content: [],
      status: {
        type: 'requires-action',
        reason: 'composer-send',
      },
    });
  },
  async send(attachment: PendingAttachment) {
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          mimeType: attachment.contentType ?? '',
          filename: attachment.name,
          data: await getFileDataURL(attachment.file),
        },
      ],
    };
  },
  remove() {
    return Promise.resolve();
  },
};
