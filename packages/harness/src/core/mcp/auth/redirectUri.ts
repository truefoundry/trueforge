/**
 * Shape/scheme checks for redirect URLs (http/https only).
 */
import { McpConnectionError } from '../../errors';

/** Validates redirect URLs parse as http(s). */
export function validateRedirectUris({ redirectUris }: { redirectUris: string[] }): void {
  for (const redirectUri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new McpConnectionError(`Invalid redirect URI: ${redirectUri}. Must be a valid URL.`, 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new McpConnectionError(`Invalid redirect URI: ${redirectUri}. Must be a valid URL.`, 400);
    }
  }
}
