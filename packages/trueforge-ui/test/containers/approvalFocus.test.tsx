// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuiState = vi.hoisted(() => vi.fn());

vi.mock('@assistant-ui/react', () => ({
  useAuiState,
}));

import {
  ApprovalFocusProvider,
  useApprovalFocus,
  useRegisterApprovalExpand,
  useRegisterApprovalTarget,
} from '@/containers/approvalFocus.js';

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
                        toolCallId: 'tool',
                        toolName: 'call_tool',
                        approval: { id: 'approval' },
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

function InnerTarget() {
  const [expanded, setExpanded] = useState(false);
  const targetRef = useRef<HTMLDivElement>(null);
  useRegisterApprovalExpand('sub-inner', () => setExpanded(true));
  useRegisterApprovalTarget('approval', () => targetRef.current);

  return expanded ? <div ref={targetRef}>approval target</div> : null;
}

function NestedTarget() {
  const [expanded, setExpanded] = useState(false);
  useRegisterApprovalExpand('sub-outer', () => setExpanded(true));
  return expanded ? <InnerTarget /> : null;
}

function FocusButton() {
  const { focus } = useApprovalFocus();
  return <button onClick={() => focus('approval')}>Focus approval</button>;
}

describe('ApprovalFocusProvider', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useAuiState.mockReturnValue(messages);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('expands newly mounted nested ancestors while retrying focus', () => {
    render(
      <ApprovalFocusProvider>
        <FocusButton />
        <NestedTarget />
      </ApprovalFocusProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Focus approval' }));
    act(() => vi.advanceTimersByTime(50));
    act(() => vi.advanceTimersByTime(50));

    expect(screen.getByText('approval target')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
