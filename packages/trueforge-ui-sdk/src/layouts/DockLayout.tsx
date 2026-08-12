'use client';

import { cn } from '../atoms/lib/cn.js';
import { CompactLayoutProvider } from '../atoms/lib/CompactLayoutContext.js';
import { StackChatPanel } from './StackChatPanel.js';

/** Fixed-width right panel with list ↔ thread stack navigation. */
export function DockLayout({ className }: { className?: string }) {
  return (
    <CompactLayoutProvider>
      <div
        data-aui-compact-layout
        className={cn(
          'ml-auto flex h-full w-full max-w-[min(400px,100%)] min-h-0 min-w-0 flex-col border-l border-border bg-primary-bg shadow-[-4px_0_24px_color-mix(in_oklab,var(--shadow-color)_6%,transparent)]',
          className,
        )}
      >
        <StackChatPanel />
      </div>
    </CompactLayoutProvider>
  );
}
