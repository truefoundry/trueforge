'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryToolResponses } from '@truefoundry/assistant-ui-runtime';
import { useCallback } from 'react';

import { useOptionalCustomActionRenderers } from '../server/CustomActionRenderersContext.js';

/** Host custom-action UI for a pending client-side tool response. */
export function CustomActionContainer() {
  const renderers = useOptionalCustomActionRenderers();
  const { pending, respond } = useTrueFoundryToolResponses();
  const isRunning = useThreadIsRunning();
  const item = pending[0];

  const onSubmit = useCallback(
    (content: string) => {
      if (item == null) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      respond({ toolCallId: item.toolCallId, content: trimmed });
    },
    [item, respond],
  );

  if (item == null || item.toolName == null) return null;
  const Renderer = renderers?.[item.toolName];
  if (Renderer == null) return null;

  return <Renderer args={item.args ?? {}} disabled={isRunning} onSubmit={onSubmit} />;
}
