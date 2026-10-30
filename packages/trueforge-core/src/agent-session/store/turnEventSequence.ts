import { SessionStoreInvariantError } from './SessionStoreErrors';

/** Stream sequences are positive safe integers. The SSE id is this number. */
export function assertTurnEventSequenceNumber(sequenceNumber: number): void {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new SessionStoreInvariantError('sequence_number must be a positive integer');
  }
}
