'use client';

import type { EnrichedPartState } from '@assistant-ui/react';
import {
  CONTEXT_COMPACTION_DATA_NAME,
  INCOMPLETE_RESPONSE_DATA_NAME,
} from '@truefoundry/trueforge-assistant-ui-runtime';

import { AssistantTextContainer } from './AssistantTextContainer.js';
import { ContextCompactionContainer } from './ContextCompactionContainer.js';
import { IncompleteResponseContainer } from './IncompleteResponseContainer.js';
import { MessageImageContainer } from './MessageImageContainer.js';
import { ToolCallContainer } from './ToolCallContainer.js';

/**
 * Renders a part that is not grouped. Only the `data` parts we emit ourselves have a renderer here;
 * other data / generative UI parts render nothing until they get one.
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
      if (part.name === INCOMPLETE_RESPONSE_DATA_NAME) {
        return <IncompleteResponseContainer />;
      }
      return null;
    default:
      return null;
  }
}
