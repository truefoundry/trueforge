'use client';

import { useApprovalNav } from '../hooks/useApprovalNav.js';
import { useSlot } from '../theme/SlotsProvider.js';

/** Composer banner that navigates pending tool approvals. */
export function ApprovalNavContainer() {
  const ApprovalNavBanner = useSlot('ApprovalNavBanner');
  const { count, index, canPrev, canNext, goPrev, goNext, focusCurrent } = useApprovalNav();

  if (count === 0) return null;

  return (
    <ApprovalNavBanner
      count={count}
      current={index + 1}
      canPrev={canPrev}
      canNext={canNext}
      onPrev={goPrev}
      onNext={goNext}
      onFocusCurrent={focusCurrent}
    />
  );
}
