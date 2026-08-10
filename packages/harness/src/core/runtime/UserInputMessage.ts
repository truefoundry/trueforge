import type { ChatCompletionContentPart } from 'openai/resources/chat';
import { AgentSandboxRequiredError, InvalidFileInputError } from '../errors';
import {
  EventType,
  type AgentInputUserMessage,
  type FileContentPart,
  type TextContentPart,
  type UserContentPart,
} from '../events/schema';
import type { LLMUserMessage } from '../llm/LLMTypes';
import type { Sandbox, SandboxInfo } from '../sandbox/Sandbox';
import type { AgentSendInput } from './AgentThread.types';
import { internalSystemTag } from './contextUtils';

export type { AgentInputUserMessage, FileContentPart, TextContentPart, UserContentPart };

export type AgentUserMessageContent = AgentInputUserMessage['content'];
export type AgentUserContentPart = UserContentPart;

export function isFileContentPart(part: UserContentPart): part is FileContentPart {
  return part.type === 'file';
}

export function isAgentInputUserMessage(msg: AgentSendInput): msg is AgentInputUserMessage {
  return 'type' in msg && msg.type === EventType.USER_MESSAGE;
}

export function isEmptyMessageContent(content: AgentUserMessageContent): boolean {
  return typeof content === 'string' ? content.trim().length === 0 : content.length === 0;
}

const INLINE_MIME_PREFIXES = ['image/', 'application/pdf'];

function isInlineMime(mime: string): boolean {
  return INLINE_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function parseMimeFromFileData(fileData: string): string {
  const match = /^data:([^;,]+)/.exec(fileData);
  if (!match?.[1]) {
    throw new InvalidFileInputError('File data URI is missing or has unparseable MIME type');
  }
  return match[1];
}

function extractBase64(dataUri: string): Buffer {
  const commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) {
    throw new InvalidFileInputError('File data URI has no base64 payload');
  }
  const raw = dataUri.substring(commaIndex + 1);
  if (!raw) {
    throw new InvalidFileInputError('File data URI has empty base64 payload');
  }
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length === 0) {
    throw new InvalidFileInputError('File data URI decoded to zero bytes');
  }
  return buffer;
}

function validatePublicFilename(filename: string): void {
  if (!filename.length) {
    throw new InvalidFileInputError('File name must not be empty');
  }
  const normalized = filename.replace(/\\/g, '/');
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..') {
      throw new InvalidFileInputError(`File name contains path traversal: ${filename}`);
    }
  }
}

function buildUploadedFilesAnnouncement(
  files: { filename: string; path: string; mime: string; size: number }[],
): string {
  const entries = files
    .map(
      (f, i) =>
        `[file_${String(i + 1)}]\n  filename: ${f.filename}\n  path: ${f.path}\n  mime: ${f.mime}\n  size: ${String(f.size)} bytes`,
    )
    .join('\n\n');
  return internalSystemTag(`Uploaded files (${String(files.length)}):\n${entries}`);
}

function partitionContent(parts: readonly AgentUserContentPart[]): {
  fileParts: FileContentPart[];
  textParts: TextContentPart[];
} {
  const fileParts: FileContentPart[] = [];
  const textParts: TextContentPart[] = [];

  for (const part of parts) {
    if (isFileContentPart(part)) {
      fileParts.push(part);
    } else {
      textParts.push(part);
    }
  }

  return { fileParts, textParts };
}

export interface ProcessAgentUserInputResult {
  message: LLMUserMessage;
  sandboxCreated?: SandboxInfo | undefined;
}

export async function processAgentUserInput(
  msg: AgentInputUserMessage,
  sandbox: Sandbox | undefined,
): Promise<ProcessAgentUserInputResult> {
  if (typeof msg.content === 'string') {
    return { message: { role: 'user', content: msg.content }, sandboxCreated: undefined };
  }

  const { fileParts, textParts } = partitionContent(msg.content);

  if (fileParts.length === 0) {
    return { message: { role: 'user', content: textParts }, sandboxCreated: undefined };
  }

  const modelParts: ChatCompletionContentPart[] = [];
  const filesToUploadToSandbox: { filename: string; buffer: Buffer; mime: string }[] = [];

  for (const filePart of fileParts) {
    const filename = filePart.name.replace(/^\/+/, '');
    if (!filename.length) {
      throw new InvalidFileInputError('File name must not be empty');
    }
    validatePublicFilename(filename);

    const file_data = filePart.data;
    const mime = parseMimeFromFileData(file_data);

    if (isInlineMime(mime)) {
      modelParts.push(
        isImageMime(mime)
          ? { type: 'image_url', image_url: { url: file_data } }
          : { type: 'file', file: { filename, file_data } },
      );
    } else {
      const buffer = extractBase64(file_data);
      filesToUploadToSandbox.push({ filename, buffer, mime });
    }
  }

  let sandboxCreated: SandboxInfo | undefined;

  if (filesToUploadToSandbox.length > 0) {
    if (!sandbox) {
      throw new AgentSandboxRequiredError(
        'File uploads requiring sandbox are not supported: no sandbox configured for this agent',
      );
    }

    const uploadResults = await Promise.allSettled(
      filesToUploadToSandbox.map(file =>
        sandbox.uploadUserFile({
          fileName: file.filename,
          content: file.buffer,
          mime: file.mime,
        }),
      ),
    );

    const uploadedFiles: { filename: string; path: string; mime: string; size: number }[] = [];
    for (let i = 0; i < uploadResults.length; i++) {
      const result = uploadResults[i];
      const file = filesToUploadToSandbox[i];
      if (result === undefined || file === undefined) {
        throw new Error('Unreachable: uploadResults/files length mismatch');
      }
      if (result.status === 'fulfilled') {
        if (result.value.sandboxCreated) {
          sandboxCreated = result.value.sandboxCreated;
        }
        uploadedFiles.push({
          filename: file.filename,
          path: result.value.filePath,
          mime: file.mime,
          size: file.buffer.length,
        });
      } else {
        throw result.reason;
      }
    }
    if (uploadedFiles.length > 0) {
      modelParts.push({ type: 'text', text: buildUploadedFilesAnnouncement(uploadedFiles) });
    }
  }

  modelParts.push(...textParts);

  return { message: { role: 'user', content: modelParts }, sandboxCreated };
}
