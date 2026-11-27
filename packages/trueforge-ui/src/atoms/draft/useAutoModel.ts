import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalConfigurationServer } from '../../server/ServerContext.js';
import type { Model } from '../../server/types.js';

/** Auto over the tenant's candidate models; undefined until the configuration has loaded. */
export function useAutoModel(): Model | undefined {
  const configuration = useOptionalConfigurationServer();
  const queryClient = useServerQueryClient();
  const { data } = useQuery(
    {
      queryKey: queryKeys.settings.configuration(),
      queryFn: () =>
        configuration == null
          ? Promise.reject(new Error('Configuration server is not configured.'))
          : configuration.getConfiguration(),
      enabled: configuration != null,
    },
    queryClient,
  );
  return useMemo(
    () => (data === undefined ? undefined : { type: 'auto', candidateModels: data.autoModelRouting.candidateModels }),
    [data],
  );
}
