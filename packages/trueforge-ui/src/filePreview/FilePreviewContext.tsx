'use client';

import { useAuiState } from '@assistant-ui/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { isNewChatView } from '../utils/isNewChatView.js';

export type SandboxFilePreviewTarget = {
  name: string;
  path: string;
  turnId: string;
  load: () => Promise<Blob>;
};

export type FilePreviewPresentation = 'panel' | 'full';

type FilePreviewContextValue = {
  target: SandboxFilePreviewTarget | null;
  presentation: FilePreviewPresentation;
  open: (target: SandboxFilePreviewTarget) => void;
  close: () => void;
  setPresentation: (presentation: FilePreviewPresentation) => void;
};

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null);
const FilePreviewTurnContext = createContext<string | undefined>(undefined);
const FilePreviewLoaderContext = createContext<((path: string) => Promise<Blob>) | null>(null);

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<SandboxFilePreviewTarget | null>(null);
  const [presentation, setPresentation] = useState<FilePreviewPresentation>('panel');
  const threadId = useAuiState(state => state.threadListItem.id);
  const isNewChat = useAuiState(isNewChatView);
  const targetKey = target == null ? null : `${target.turnId}:${target.path}`;
  const previousTargetKey = useRef(targetKey);
  if (previousTargetKey.current !== targetKey) {
    previousTargetKey.current = targetKey;
    if (presentation !== 'panel') setPresentation('panel');
  }

  // Local id changes for unsaved threads too. remoteId stays null until the session is stored.
  const previousThreadId = useRef(threadId);
  if (previousThreadId.current !== threadId) {
    previousThreadId.current = threadId;
    setTarget(null);
  }

  const previousIsNewChat = useRef(isNewChat);
  if (previousIsNewChat.current !== isNewChat) {
    previousIsNewChat.current = isNewChat;
    if (isNewChat) setTarget(null);
  }

  const open = useCallback((next: SandboxFilePreviewTarget) => {
    setTarget(next);
  }, []);
  const close = useCallback(() => {
    setTarget(null);
  }, []);
  const value = useMemo(
    () => ({ target, presentation, open, close, setPresentation }),
    [target, presentation, open, close, setPresentation],
  );

  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>;
}

export function useFilePreview(): FilePreviewContextValue {
  const value = useContext(FilePreviewContext);
  if (value == null) {
    throw new Error('File preview is only available inside FilePreviewProvider.');
  }
  return value;
}

export function useOptionalFilePreview(): FilePreviewContextValue | null {
  return useContext(FilePreviewContext);
}

/** Uses the layout provider when the sidebar already owns preview state. */
export function FilePreviewBoundary({ children }: { children: ReactNode }) {
  const existing = useOptionalFilePreview();
  if (existing != null) return children;
  return <FilePreviewProvider>{children}</FilePreviewProvider>;
}

/** Binds artifact chips in one assistant message to the turn that wrote them. */
export function FilePreviewTurnScope({ turnId, children }: { turnId: string | undefined; children: ReactNode }) {
  return <FilePreviewTurnContext.Provider value={turnId}>{children}</FilePreviewTurnContext.Provider>;
}

export function useFilePreviewTurnId(): string | undefined {
  return useContext(FilePreviewTurnContext);
}

/** Turn-scoped sandbox read for artifact chips. Not a markdown prop, so opening a preview does not remount the message. */
export function FilePreviewLoaderScope({
  load,
  children,
}: {
  load: (path: string) => Promise<Blob>;
  children: ReactNode;
}) {
  return <FilePreviewLoaderContext.Provider value={load}>{children}</FilePreviewLoaderContext.Provider>;
}

export function useFilePreviewLoader(): ((path: string) => Promise<Blob>) | null {
  return useContext(FilePreviewLoaderContext);
}
