/**
 * Fields a turn needs to stamp gateway metadata, plus the raw inbound request headers.
 * TrueFoundry stores read the headers they care about. Other stores ignore them.
 */
export interface TurnMetadata {
  sessionId: string;
  turnId: string;
  /** Saved agent. Inline sessions have no registry id to stamp. */
  agent?: { id: string; name: string | null };
  requestHeaders?: Record<string, string>;
}
