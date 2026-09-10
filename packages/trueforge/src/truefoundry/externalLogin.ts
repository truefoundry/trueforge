import { getPublicBaseUrl } from '../config';

/**
 * TrueFoundry platform browser login. Harness is mounted under the TF frontend
 * origin (e.g. `https://app.example.com/trueforge`); after login TF
 * `location.replace`s to `redirectPath` on that same origin.
 */
export function buildTrueFoundryExternalLoginHref(redirectPath: string): string {
  const publicUrl = new URL(getPublicBaseUrl());
  const params = new URLSearchParams({ redirectPath });
  return `${publicUrl.origin}/signin/external?${params.toString()}`;
}
