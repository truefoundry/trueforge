import type { McpAuthStatus } from '../schemas/mcpServer';

/** ServiceFoundry public MCP auth status values. */
export type SfyMcpAuthStatusValue = 'authenticated' | 'authentication_required' | 'authentication_not_required';

export interface SfyMcpAuthorizeOrStatusResponse {
  status: string;
  authorization_endpoint?: string | undefined;
}

/**
 * Maps ServiceFoundry MCP auth status (and optional authorize URL) onto TrueForge
 * {@link McpAuthStatus}. Unknown statuses fall through to `auth_required` without a URL.
 */
export function mapSfyMcpAuthStatus(response: SfyMcpAuthorizeOrStatusResponse): McpAuthStatus {
  switch (response.status) {
    case 'authenticated':
      return { status: 'authenticated' };
    case 'authentication_not_required':
      return { status: 'not_required' };
    case 'authentication_required': {
      const url = response.authorization_endpoint;
      if (url !== undefined && url.length > 0) {
        return { status: 'auth_required', authorization_url: url };
      }
      return { status: 'auth_required' };
    }
    default:
      return { status: 'auth_required' };
  }
}
