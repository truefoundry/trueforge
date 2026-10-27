'use client';

import { useState } from 'react';

import { useAuiState } from '@assistant-ui/react';
import { CONTEXT_COMPACTION_DATA_NAME, isContextCompactionPartData } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function ContextCompactionContainer() {
  const ContextCompactionCard = useSlot('ContextCompactionCard');
  const part = useAuiState(s => s.part);
  const [expanded, setExpanded] = useState(false);

  if (part.type !== 'data' || part.name !== CONTEXT_COMPACTION_DATA_NAME) {
    return null;
  }
  if (!isContextCompactionPartData(part.data)) {
    return null;
  }

  return <ContextCompactionCard data={part.data} expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />;
}
