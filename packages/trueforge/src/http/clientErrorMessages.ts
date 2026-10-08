/** Client sentences for API error responses. */
export const API_KEY_REQUIRED = 'API key is required';
export const HEADER_SECRET_REQUIRED = 'Header secret is required';
export const OUTBOUND_URL_BLOCKED = 'Outbound URL blocked';
export const SESSION_IMPORT_REQUIRES_POSTGRES = 'Session import requires Postgres (STANDALONE=false)';
export const SANDBOX_PROVIDER_API_KEY_REJECTED = 'Sandbox provider rejected the API key — check the credentials';
export const SANDBOX_PROVIDER_API_KEY_MISSING_PERMISSIONS =
  'Sandbox provider denied access: the API key is missing required permissions. Grant write:sandboxes, write:snapshots, and delete:snapshots on the key, then try again.';
