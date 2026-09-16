import { ParallelWebSearchProvider, type WebSearchProvider } from '@truefoundry/trueforge-core/core';
import configuration, { isTrueFoundryModeEnabled } from '../config';

/** Build the host web-search backend (TrueFoundry mode only), or `undefined` when unset. */
export function resolveWebSearchProvider(): WebSearchProvider | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  const env = configuration.TRUEFOUNDRY_WEB_SEARCH_PROVIDER;
  if (!env) {
    return undefined;
  }
  const name = env['name'];
  const apiKey = env['api_key'];
  if (!name || !apiKey) {
    throw new Error('TRUEFOUNDRY_WEB_SEARCH_PROVIDER must include non-empty "name" and "api_key" string fields');
  }
  switch (name) {
    case 'parallel':
      return new ParallelWebSearchProvider({ apiKey });
    default:
      throw new Error(`Unsupported TRUEFOUNDRY_WEB_SEARCH_PROVIDER name: ${name}`);
  }
}
