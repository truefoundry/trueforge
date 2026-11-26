'use client';

import { useState } from 'react';

import { useAuiState } from '@assistant-ui/react';
import { EVENT_TYPE, isThreadSwitchModelEvent } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function ThreadSwitchModelContainer() {
  const ThreadSwitchModelCard = useSlot('ThreadSwitchModelCard');
  const part = useAuiState(s => s.part);
  const [expanded, setExpanded] = useState(false);

  if (part.type !== 'data' || part.name !== EVENT_TYPE.THREAD_SWITCH_MODEL) {
    return null;
  }
  if (!isThreadSwitchModelEvent(part.data)) {
    return null;
  }

  return <ThreadSwitchModelCard data={part.data} expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />;
}
