import { describe, expect, it } from 'vitest';

import { createdByLabel, hasCreatedBySubject } from '@/utils/createdBySubject.js';

describe('createdBySubject helpers', () => {
  it('prefers display name and falls back to id', () => {
    expect(
      createdByLabel({
        subjectId: 'u1',
        subjectType: 'user',
        subjectDisplayName: 'alice@example.com',
      }),
    ).toBe('alice@example.com');
    expect(
      createdByLabel({
        subjectId: 'u1',
        subjectType: 'user',
        subjectDisplayName: '',
      }),
    ).toBe('u1');
  });

  it('detects whether any row carries createdBySubject', () => {
    expect(hasCreatedBySubject([{}])).toBe(false);
    expect(
      hasCreatedBySubject([
        {},
        {
          createdBySubject: {
            subjectId: 'u1',
            subjectType: 'user',
            subjectDisplayName: 'alice',
          },
        },
      ]),
    ).toBe(true);
  });
});
