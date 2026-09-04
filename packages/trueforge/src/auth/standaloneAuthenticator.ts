import type { Authenticator } from './authenticator';
import { STANDALONE_REQUEST_CONTEXT, type RequestContext } from './identity';

export class StandaloneAuthenticator implements Authenticator {
  authenticate(): Promise<RequestContext> {
    return Promise.resolve(STANDALONE_REQUEST_CONTEXT);
  }
}
