/**
 * Maps the trueforge-ui tenant-switch port onto Harness
 * `/api/v1/settings/configurations` (admin-only, one document per tenant).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { ConfigurationsServer, TenantConfigurations } from '../../server/types.js';

function toUiConfigurations(manifest: TrueForgeApi.ConfigurationsManifest): TenantConfigurations {
  return { webSearch: { enabled: manifest.webSearch.enabled } };
}

export function createConfigurationsServer(client: TrueForge): ConfigurationsServer {
  return {
    getConfigurations: async () => {
      const body = await client.settings.configurations.get();
      return toUiConfigurations(body.data.manifest);
    },
    updateConfigurations: async req => {
      const body = await client.settings.configurations.update({
        manifest: req.webSearch === undefined ? {} : { webSearch: { enabled: req.webSearch.enabled } },
      });
      return toUiConfigurations(body.data.manifest);
    },
  };
}
