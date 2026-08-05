'use client';

import { ComposerContainer } from './ComposerContainer.js';
import { ThreadContainer } from './ThreadContainer.js';

/** The full assembled thread view: message list + composer. */
export function Thread() {
  return <ThreadContainer composer={<ComposerContainer />} />;
}
