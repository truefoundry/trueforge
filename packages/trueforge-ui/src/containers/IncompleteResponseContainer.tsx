'use client';

import { useAuiState } from '@assistant-ui/react';
import { INCOMPLETE_RESPONSE_DATA_NAME } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function IncompleteResponseContainer() {
  const IncompleteResponseBanner = useSlot('IncompleteResponseBanner');
  const part = useAuiState(s => s.part);

  if (part.type !== 'data' || part.name !== INCOMPLETE_RESPONSE_DATA_NAME) {
    return null;
  }

  return <IncompleteResponseBanner />;
}
