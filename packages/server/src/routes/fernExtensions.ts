/**
 * Codegen hints Fern reads off the emitted OpenAPI document. They express two
 * things plain OpenAPI cannot: that a list endpoint is paginated, and that a
 * response is an SSE stream rather than a single body.
 */

/** Every list endpoint on this server shares one opaque-token contract. */
export const TOKEN_PAGINATION = {
  cursor: '$request.page_token',
  next_cursor: '$response.pagination.next_page_token',
  results: '$response.data',
};

/**
 * Turn creation streams events. Not resumable: replaying a running turn needs a
 * live-stream registry this single-process server does not have.
 */
export const SSE_STREAM = { format: 'sse', resumable: false };
