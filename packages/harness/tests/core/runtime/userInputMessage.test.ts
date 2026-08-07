import { AgentSandboxRequiredError, InvalidFileInputError } from '../../../src/core/errors';
import { EventType } from '../../../src/core/events/schema';
import {
  isEmptyMessageContent,
  processAgentUserInput,
  type AgentInputUserMessage,
  type FileContentPart,
} from '../../../src/core/runtime/UserInputMessage';
import '../harnessMocks';
import { makeStubPublicSandbox } from '../harnessMocks';

describe('UserInputMessage validation', () => {
  const sandbox = makeStubPublicSandbox();

  it('detects empty string content', () => {
    expect(isEmptyMessageContent('   ')).toBe(true);
    expect(isEmptyMessageContent('hello')).toBe(false);
  });

  it('detects empty multipart content', () => {
    expect(isEmptyMessageContent([])).toBe(true);
    expect(isEmptyMessageContent([{ type: 'text', text: 'hi' }])).toBe(false);
  });

  it('rejects file uploads when sandbox is unavailable', async () => {
    const msg: AgentInputUserMessage = {
      type: EventType.USER_MESSAGE,
      content: [
        {
          type: 'file',
          name: 'notes.txt',
          data: 'data:text/plain;base64,bm90ZXM=',
        } satisfies FileContentPart,
      ],
    };

    await expect(processAgentUserInput(msg, undefined)).rejects.toBeInstanceOf(AgentSandboxRequiredError);
    await expect(processAgentUserInput(msg, undefined)).rejects.toMatchObject({
      message: 'File uploads requiring sandbox are not supported: no sandbox configured for this agent',
    });
  });

  it('rejects empty file names', async () => {
    const msg: AgentInputUserMessage = {
      type: EventType.USER_MESSAGE,
      content: [
        {
          type: 'file',
          name: '',
          data: 'data:text/plain;base64,bm90ZXM=',
        } satisfies FileContentPart,
      ],
    };

    await expect(processAgentUserInput(msg, sandbox)).rejects.toBeInstanceOf(InvalidFileInputError);
    await expect(processAgentUserInput(msg, sandbox)).rejects.toMatchObject({
      message: 'File name must not be empty',
    });
  });

  it('rejects path traversal in file names', async () => {
    const msg: AgentInputUserMessage = {
      type: EventType.USER_MESSAGE,
      content: [
        {
          type: 'file',
          name: '../secrets.txt',
          data: 'data:text/plain;base64,c2VjcmV0',
        } satisfies FileContentPart,
      ],
    };

    await expect(processAgentUserInput(msg, sandbox)).rejects.toBeInstanceOf(InvalidFileInputError);
    await expect(processAgentUserInput(msg, sandbox)).rejects.toMatchObject({
      message: 'File name contains path traversal: ../secrets.txt',
    });
  });

  it('rejects malformed file data URIs', async () => {
    const msg: AgentInputUserMessage = {
      type: EventType.USER_MESSAGE,
      content: [
        {
          type: 'file',
          name: 'broken.txt',
          data: 'not-a-data-uri',
        } satisfies FileContentPart,
      ],
    };

    await expect(processAgentUserInput(msg, sandbox)).rejects.toBeInstanceOf(InvalidFileInputError);
    await expect(processAgentUserInput(msg, sandbox)).rejects.toMatchObject({
      message: 'File data URI is missing or has unparseable MIME type',
    });
  });
});
