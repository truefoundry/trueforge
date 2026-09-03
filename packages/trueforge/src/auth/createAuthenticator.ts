import type { TrueFoundryServiceFoundryServerClient } from '../truefoundry/TrueFoundryServiceFoundryServerClient';
import type { Authenticator } from './authenticator';
import { OidcAuthenticator } from './oidcAuthenticator';
import { StandaloneAuthenticator } from './standaloneAuthenticator';
import { TrueFoundryAuthenticator } from './trueFoundryAuthenticator';

export enum TrueforgeMode {
  Standalone = 'standalone',
  Oidc = 'oidc',
  TrueFoundry = 'truefoundry',
}

/** Build the single process authenticator from resolved auth mode. */
export function createAuthenticator(params: {
  mode: TrueforgeMode;
  trueFoundryClient?: TrueFoundryServiceFoundryServerClient;
}): Authenticator {
  switch (params.mode) {
    case TrueforgeMode.TrueFoundry: {
      if (!params.trueFoundryClient) {
        throw new Error('TrueFoundryAuthenticator requires a ServiceFoundry client');
      }
      return new TrueFoundryAuthenticator(params.trueFoundryClient);
    }
    case TrueforgeMode.Oidc:
      return new OidcAuthenticator();
    case TrueforgeMode.Standalone:
      return new StandaloneAuthenticator();
  }
}
