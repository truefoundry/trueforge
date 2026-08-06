'use client';

import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type RespondToToolApprovalOptions,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { ReactNode } from 'react';

/** Test-only harness driving a real assistant-ui runtime from plain message fixtures. */
export function RuntimeHarness({
  messages,
  isRunning = false,
  isLoading = false,
  onRespondToToolApproval,
  onEdit,
  onNew = async () => {},
  children,
}: {
  messages: ThreadMessageLike[];
  isRunning?: boolean;
  isLoading?: boolean;
  onRespondToToolApproval?: (options: RespondToToolApprovalOptions) => void;
  onEdit?: (message: AppendMessage) => Promise<void>;
  onNew?: (message: AppendMessage) => Promise<void>;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning,
    isLoading,
    convertMessage: message => message,
    onNew,
    onEdit,
    onRespondToToolApproval,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
