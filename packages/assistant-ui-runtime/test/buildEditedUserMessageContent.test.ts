import { describe, expect, it } from 'vitest';

import {
  buildEditedUserMessageContent,
  parseTurnIdFromMessageId,
  resolveBranchPreviousTurnId,
} from '../src/convertTurnMessages.js';
import type { SessionTurnRecord } from '../src/sessionSnapshot.js';

describe('user message branch helpers', () => {
  it('parseTurnIdFromMessageId strips the user suffix', () => {
    expect(parseTurnIdFromMessageId('turn-abc-user')).toBe('turn-abc');
  });

  it('resolveBranchPreviousTurnId returns null for the first turn', () => {
    const turns: SessionTurnRecord[] = [
      { id: 'a', createdAt: '', state: { status: 'done', requiredActions: [], completedAt: '' } },
    ];
    expect(resolveBranchPreviousTurnId(turns, 'a')).toBeNull();
  });

  it('resolveBranchPreviousTurnId returns the prior turn id', () => {
    const turns: SessionTurnRecord[] = [
      { id: 'a', createdAt: '', state: { status: 'done', requiredActions: [], completedAt: '' } },
      { id: 'b', createdAt: '', state: { status: 'done', requiredActions: [], completedAt: '' } },
    ];
    expect(resolveBranchPreviousTurnId(turns, 'b')).toBe('a');
  });
});

describe('buildEditedUserMessageContent', () => {
  it('returns plain string when there are no attachments', () => {
    expect(buildEditedUserMessageContent('updated', [{ type: 'user.message', content: 'original' }])).toBe('updated');
  });

  it('preserves file parts from the original turn input', () => {
    const filePart = {
      type: 'file' as const,
      name: 'report.pdf',
      data: 'data:application/pdf;base64,AAAA',
    };
    expect(
      buildEditedUserMessageContent('updated question', [
        {
          type: 'user.message',
          content: [{ type: 'text', text: 'original question' }, filePart],
        },
      ]),
    ).toEqual([{ type: 'text', text: 'updated question' }, filePart]);
  });
});
