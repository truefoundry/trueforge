import { ulid } from 'ulid';

/** Application-generated lowercase ULID for entity / resource ids. */
export function newId(): string {
  return ulid().toLowerCase();
}
