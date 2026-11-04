'use client';

import { EmptyScreen } from '../atoms/EmptyScreen.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { ComposerContainer } from './ComposerContainer.js';
import { ThreadContainer } from './ThreadContainer.js';

/** The full assembled thread view: message list + composer. */
export function Thread() {
  const shell = useOptionalShellMode();
  if (shell?.sessionAccessError != null) {
    return (
      <EmptyScreen title="Unable to load session" description={shell.sessionAccessError} className="bg-primary-bg" />
    );
  }
  return <ThreadContainer composer={<ComposerContainer />} />;
}
