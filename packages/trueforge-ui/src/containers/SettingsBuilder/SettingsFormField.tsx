import { useCallback, useState, type ReactNode } from 'react';

export const SETTINGS_INPUT_ERROR_CLASS_NAME =
  'border-failure-bg focus-visible:border-failure-bg focus-visible:ring-failure-bg';

export function RequiredMark() {
  return <span className="ml-0.5 text-failure-bg after:content-['*']" aria-hidden />;
}

export function SettingsFieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-failure-bg">
      {children}
    </p>
  );
}

export function useTouchedFields<Field extends string>() {
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set());

  const touch = useCallback((field: Field) => {
    setTouched(current => new Set(current).add(field));
  }, []);

  const touchAll = useCallback((fields: readonly Field[]) => {
    setTouched(new Set(fields));
  }, []);

  const resetTouched = useCallback(() => {
    setTouched(new Set());
  }, []);

  const isTouched = useCallback((field: Field) => touched.has(field), [touched]);

  return { isTouched, resetTouched, touch, touchAll };
}
