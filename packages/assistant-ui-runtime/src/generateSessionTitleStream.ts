import { createAssistantStream, type AssistantStream } from 'assistant-stream';

import type { AgentChatServer } from './server/types.js';

/**
 * Load the stored session title and stream it for assistant-ui's local
 * thread-list row. The server already wrote the title on the first turn;
 * this only updates the sidebar without a rename PATCH.
 */
export async function generateSessionTitleStream(
  server: Pick<AgentChatServer, 'getSession'>,
  remoteId: string,
): Promise<AssistantStream> {
  try {
    const session = await server.getSession({ sessionId: remoteId });
    const nextTitle = typeof session.title === 'string' ? session.title.trim() : '';
    if (nextTitle.length === 0) {
      return createAssistantStream(() => undefined);
    }
    return createAssistantStream(controller => {
      controller.appendText(nextTitle);
    });
  } catch {
    return createAssistantStream(() => undefined);
  }
}
