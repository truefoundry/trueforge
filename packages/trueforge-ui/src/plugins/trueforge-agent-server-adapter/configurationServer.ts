/**
 * Maps the trueforge-ui tenant-switch port onto Harness
 * `/api/v1/settings/configuration` (admin-only, one document per tenant).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { ConfigurationServer, TenantConfiguration } from '../../server/types.js';

function toUiConfiguration(manifest: TrueForgeApi.ConfigurationManifest): TenantConfiguration {
  return {
    webSearch: { enabled: manifest.webSearch.enabled },
    memory: { enabled: manifest.memory.enabled },
  };
}

export function createConfigurationServer(client: TrueForge): ConfigurationServer {
  return {
    getConfiguration: async () => {
      const body = await client.settings.configuration.get();
      return toUiConfiguration(body.data.manifest);
    },
    updateConfiguration: async req => {
      const body = await client.settings.configuration.update({
        manifest: {
          ...(req.webSearch === undefined ? {} : { webSearch: { enabled: req.webSearch.enabled } }),
          ...(req.memory === undefined ? {} : { memory: { enabled: req.memory.enabled } }),
        },
      });
      return toUiConfiguration(body.data.manifest);
    },
  };
}
