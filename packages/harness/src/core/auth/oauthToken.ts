/** True when `expiresAtIso` parses and is strictly in the future relative to `nowMs`. */
export function isOAuthAccessTokenUsable(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  return !Number.isNaN(expiresAtMs) && expiresAtMs > nowMs;
}
