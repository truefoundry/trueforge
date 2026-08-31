// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useApprovals = vi.hoisted(() => vi.fn());
const focus = vi.hoisted(() => vi.fn());

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryApprovals: useApprovals,
}));

vi.mock('@/containers/approvalFocus.js', () => ({
  useOptionalApprovalFocus: () => ({ focus }),
}));

import { useApprovalNav } from '@/hooks/useApprovalNav.js';

type PendingApproval = {
  approvalId: string;
};

let pending: PendingApproval[];

describe('useApprovalNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending = [];
    useApprovals.mockImplementation(() => ({ pending }));
  });

  it('keeps the selected approval when an earlier approval resolves', () => {
    pending = [{ approvalId: 'A' }, { approvalId: 'B' }, { approvalId: 'C' }];
    const { result, rerender } = renderHook(() => useApprovalNav());

    act(() => result.current.goNext());
    expect(result.current.index).toBe(1);
    expect(focus).toHaveBeenCalledTimes(2);

    pending = [{ approvalId: 'B' }, { approvalId: 'C' }];
    rerender();

    expect(result.current.index).toBe(0);
    expect(focus).toHaveBeenLastCalledWith('B');
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('keeps the same slot when the selected approval resolves', () => {
    pending = [{ approvalId: 'A' }, { approvalId: 'B' }, { approvalId: 'C' }];
    const { result, rerender } = renderHook(() => useApprovalNav());

    act(() => result.current.goNext());
    pending = [{ approvalId: 'A' }, { approvalId: 'C' }];
    rerender();

    expect(result.current.index).toBe(1);
    expect(focus).toHaveBeenLastCalledWith('C');
  });

  it('starts at the first approval and does not wrap', () => {
    pending = [{ approvalId: 'A' }, { approvalId: 'B' }];
    const { result } = renderHook(() => useApprovalNav());

    expect(result.current.index).toBe(0);
    act(() => result.current.goPrev());
    expect(result.current.index).toBe(0);

    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.index).toBe(1);
  });
});
