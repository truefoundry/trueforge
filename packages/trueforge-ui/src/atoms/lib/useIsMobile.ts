'use client';

import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
