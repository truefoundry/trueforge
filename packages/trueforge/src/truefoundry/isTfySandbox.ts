import configuration, { type ServerConfiguration } from '../config';

/** True when `TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry` (TFY on-prem sandbox; no env snapshot builds). */
export function isTfySandbox(config: ServerConfiguration = configuration): boolean {
  if (config.STANDALONE) {
    return false;
  }
  return config.TRUEFOUNDRY_SANDBOX_PROVIDER === 'truefoundry';
}
