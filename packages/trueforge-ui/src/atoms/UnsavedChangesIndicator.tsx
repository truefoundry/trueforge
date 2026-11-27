'use client';

export function UnsavedChangesIndicator() {
  return (
    <span role="status" className="text-text-secondary flex shrink-0 items-center gap-1.5 text-[0.625rem]">
      Unsaved changes
      <span aria-hidden="true" className="size-1.5 rounded-full bg-red-500" />
    </span>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UnsavedChangesIndicator: typeof UnsavedChangesIndicator;
  }
}
