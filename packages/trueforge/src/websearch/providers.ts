import { ParallelWebSearchProvider, type IWebSearchProvider } from '@truefoundry/trueforge-core/core';
import configuration, { isTrueFoundryModeEnabled } from '../config';

/** Build the host web-search backend (TrueFoundry mode only), or `undefined` when unset. */
export function resolveWebSearchProvider(): IWebSearchProvider | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  const env = configuration.TRUEFOUNDRY_WEB_SEARCH_PROVIDER;
  if (!env) {
    return undefined;
  }
  switch (env.name) {
    case 'parallel':
      return new ParallelWebSearchProvider({ apiKey: env.api_key, mode: 'turbo' });
    default:
      throw new Error(`Unsupported TRUEFOUNDRY_WEB_SEARCH_PROVIDER name: ${env.name}`);
  }
}
