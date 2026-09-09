import type { ListResult } from '../server/types.js';

/** Drain token-paginated list endpoints until `nextPageToken` is exhausted. */
export async function drainListPages<T>({
  fetchPage,
}: {
  fetchPage: (pageToken?: string) => Promise<ListResult<T>>;
}): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    items.push(...page.data);
    pageToken = page.nextPageToken;
  } while (pageToken != null && pageToken.length > 0);
  return items;
}
