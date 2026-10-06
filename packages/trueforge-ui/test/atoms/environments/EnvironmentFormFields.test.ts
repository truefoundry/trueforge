import { describe, expect, it } from 'vitest';

import { validateEnvironmentForm, type EnvironmentFormValues } from '@/atoms/environments/EnvironmentFormFields.js';

const VALID_FORM: EnvironmentFormValues = {
  name: 'limited-env',
  description: '',
  buildScript: '',
  cpu: '1',
  memory: '1',
  disk: '3',
  networkBlockAll: false,
  domainAllowList: '',
  secrets: [],
  environmentVariables: [],
};

describe('validateEnvironmentForm resource limits', () => {
  it.each([
    ['cpu', '5', 'CPU must be between 1 and 4 vCPU'],
    ['memory', '9', 'Memory must be between 1 and 8 GiB'],
    ['disk', '11', 'Disk must be between 1 and 10 GiB'],
  ] as const)('rejects %s above its maximum', (resource, value, message) => {
    expect(validateEnvironmentForm({ ...VALID_FORM, [resource]: value })).toBe(message);
  });

  it('accepts the maximum resources', () => {
    expect(validateEnvironmentForm({ ...VALID_FORM, cpu: '4', memory: '8', disk: '10' })).toBeNull();
  });
});

describe('validateEnvironmentForm field limits', () => {
  it('rejects oversized environment variable values', () => {
    expect(
      validateEnvironmentForm({
        ...VALID_FORM,
        environmentVariables: [{ key: 'CONFIG', value: 'x'.repeat(4097) }],
      }),
    ).toBe('Environment variable value must not exceed 4096 characters');
  });

  it('rejects oversized secret names', () => {
    expect(
      validateEnvironmentForm({
        ...VALID_FORM,
        secrets: [{ env: `S${'E'.repeat(128)}`, value: 'value', hosts: [] }],
      }),
    ).toBe('Secret name is invalid or exceeds 128 characters');
  });
});
