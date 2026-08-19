import { describe, expect, it } from 'vitest';

import {
  validateGitPath,
  validateGitRef,
  validateGitRepositoryUrl,
  validateHttpHeaderName,
  validateHttpUrl,
  validateNonNegativeInteger,
  validatePositiveInteger,
  validateResourceName,
  validateUniqueValue,
} from '@/containers/SettingsBuilder/settingsFormValidation.js';

describe('settings form validation', () => {
  it('validates resource-name format and existing names', () => {
    expect(validateResourceName({ value: 'custom-mcp', label: 'Connector name' })).toBeNull();
    expect(validateResourceName({ value: 'Custom MCP', label: 'Connector name' })).toMatch(/2–64 lowercase/);
    expect(validateResourceName({ value: 'custom-mcp', label: 'Connector name', existingNames: ['custom-mcp'] })).toBe(
      'Connector name “custom-mcp” already exists.',
    );
    expect(
      validateResourceName({
        value: 'custom-mcp',
        label: 'Connector name',
        existingNames: ['custom-mcp'],
        originalName: 'custom-mcp',
      }),
    ).toBeNull();
  });

  it('accepts only HTTP(S) endpoints', () => {
    expect(validateHttpUrl({ value: 'http://localhost:11434/v1', label: 'Base URL' })).toBeNull();
    expect(validateHttpUrl({ value: 'ftp://example.com', label: 'Base URL' })).toBe(
      'Base URL must use http:// or https://.',
    );
    expect(validateHttpUrl({ value: '', label: 'Base URL', required: false })).toBeNull();
  });

  it('validates Git repository, path, and ref formats', () => {
    expect(validateGitRepositoryUrl('https://github.com/truefoundry/skills')).toBeNull();
    expect(validateGitRepositoryUrl('https://example.com/truefoundry/skills')).toMatch(/GitHub or GitLab/);
    expect(validateGitPath('skills/release-notes')).toBeNull();
    expect(validateGitPath('../secrets')).toMatch(/must not contain/);
    expect(validateGitRef('feature/validation')).toBeNull();
    expect(validateGitRef('../main')).toMatch(/must not contain/);
  });

  it('validates HTTP header names and integer ranges', () => {
    expect(validateHttpHeaderName('X-Api-Key')).toBeNull();
    expect(validateHttpHeaderName('Bad Header')).toMatch(/Header name/);
    expect(validatePositiveInteger({ value: '1', label: 'Timeout' })).toBeNull();
    expect(validatePositiveInteger({ value: '0', label: 'Timeout' })).toMatch(/greater than 0/);
    expect(validateNonNegativeInteger({ value: '0', label: 'Interval' })).toBeNull();
    expect(validateNonNegativeInteger({ value: '1.5', label: 'Interval' })).toMatch(/whole number/);
  });

  it('detects repeated values within a form', () => {
    expect(validateUniqueValue({ value: 'model-a', values: ['model-a', 'model-b'], label: 'Model ID' })).toBeNull();
    expect(validateUniqueValue({ value: 'model-a', values: ['model-a', 'model-a'], label: 'Model ID' })).toBe(
      'Model ID “model-a” must be unique.',
    );
  });
});
