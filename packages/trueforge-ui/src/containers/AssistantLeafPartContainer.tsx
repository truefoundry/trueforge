'use client';

import type { EnrichedPartState } from '@assistant-ui/react';
import { CONTEXT_COMPACTION_DATA_NAME, EVENT_TYPE } from '@truefoundry/trueforge-assistant-ui-runtime';

import { AssistantTextContainer } from './AssistantTextContainer.js';
import { ContextCompactionContainer } from './ContextCompactionContainer.js';
import { MessageImageContainer } from './MessageImageContainer.js';
import { ThreadSwitchModelContainer } from './ThreadSwitchModelContainer.js';
import { ToolCallContainer } from './ToolCallContainer.js';

/**
 * Renders a part that is not grouped. Known `data` parts (context compaction,
 * model switch) render here; other data / generative UI parts render nothing
 * until they get a renderer.
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
      if (part.name === EVENT_TYPE.THREAD_SWITCH_MODEL) {
        return <ThreadSwitchModelContainer />;
      }
      return null;
    default:
      return null;
  }
}
