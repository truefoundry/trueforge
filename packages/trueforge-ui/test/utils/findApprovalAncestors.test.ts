import { describe, expect, it } from 'vitest';

import { findSubAgentAncestorsForApproval } from '@/utils/findApprovalAncestors.js';

describe('findSubAgentAncestorsForApproval', () => {
  it('returns empty when the approval is on the root thread', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-root',
            toolName: 'call_tool',
            approval: { id: 'appr-1' },
          },
        ],
      },
    ];

    expect(findSubAgentAncestorsForApproval(messages, 'appr-1')).toEqual([]);
  });

  it('returns the create_sub_agent toolCallId for a nested pending approval', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'sub-1',
            toolName: 'create_sub_agent',
            messages: [
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'tc-nested',
                    toolName: 'call_tool',
                    approval: { id: 'appr-nested' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(findSubAgentAncestorsForApproval(messages, 'appr-nested')).toEqual(['sub-1']);
  });

  it('returns nested sub-agent ancestors from outermost to innermost', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'sub-outer',
            toolName: 'create_sub_agent',
            messages: [
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'sub-inner',
                    toolName: 'create_sub_agent',
                    messages: [
                      {
                        role: 'assistant',
                        content: [
                          {
                            type: 'tool-call',
                            toolCallId: 'tc-nested',
                            toolName: 'call_tool',
                            approval: { id: 'appr-nested' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(findSubAgentAncestorsForApproval(messages, 'appr-nested')).toEqual(['sub-outer', 'sub-inner']);
  });

  it('ignores resolved approvals', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'sub-1',
            toolName: 'create_sub_agent',
            messages: [
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'tc-nested',
                    toolName: 'call_tool',
                    approval: { id: 'appr-nested', approved: true },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(findSubAgentAncestorsForApproval(messages, 'appr-nested')).toEqual([]);
  });
});
