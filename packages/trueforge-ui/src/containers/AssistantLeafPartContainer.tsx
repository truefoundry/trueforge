'use client';

import type { EnrichedPartState } from '@assistant-ui/react';
import { CONTEXT_COMPACTION_DATA_NAME } from '@truefoundry/trueforge-assistant-ui-runtime';

import { AssistantTextContainer } from './AssistantTextContainer.js';
import { ContextCompactionContainer } from './ContextCompactionContainer.js';
import { MessageImageContainer } from './MessageImageContainer.js';
import { ToolCallContainer } from './ToolCallContainer.js';

/**
 * Renders a part that is not grouped. Context-compaction `data` parts render here because they are the
 * only data parts we emit today; other data / generative UI parts render nothing until they get a renderer.
 */
export function AssistantLeafPartContainer({ part }: { part: EnrichedPartState }) {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return <AssistantTextContainer />;
    case 'image':
      return <MessageImageContainer />;
    case 'tool-call':
      return <ToolCallContainer {...part} />;
    case 'data':
      if (part.name === CONTEXT_COMPACTION_DATA_NAME) {
        return <ContextCompactionContainer />;
      }
      return null;
    default:
      return null;
  }
}
