/** Every paginated endpoint on this server shares one opaque-token contract. */
export const TOKEN_PAGINATION = {
  cursor: '$request.page_token',
  next_cursor: '$response.pagination.next_page_token',
  results: '$response.data',
};
