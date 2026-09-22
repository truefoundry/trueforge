import type { ListResult } from './server/types.js';

/**
 * Drains all pages of a token-paginated list into a single array.
 * Newest-first APIs should reverse after calling this.
 */
export async function drainListPages<T>(fetchPage: (pageToken?: string) => Promise<ListResult<T>>): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const page = await fetchPage(pageToken);
    items.push(...page.data);
    if (page.nextPageToken == null || page.nextPageToken === '') {
      break;
    }
    pageToken = page.nextPageToken;
  }
  return items;
}
