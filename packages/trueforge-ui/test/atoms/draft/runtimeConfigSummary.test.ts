import { describe, expect, it } from 'vitest';

import { runtimeConfigSummary, runtimeConfigValueClassName } from '@/atoms/draft/runtimeConfigSummary.js';

describe('runtimeConfigValueClassName', () => {
  it('uses destructive color for off', () => {
    expect(runtimeConfigValueClassName('off')).toContain('text-failure-bg');
  });

  it('uses primary color for on and numeric values', () => {
    expect(runtimeConfigValueClassName('on')).toContain('text-primary-button-bg');
    expect(runtimeConfigValueClassName('105')).toContain('text-primary-button-bg');
  });
});

describe('runtimeConfigSummary', () => {
  it.each([undefined, {}])('defaults the iteration limit to 1024 with config %p', config => {
    expect(runtimeConfigSummary(config).find(entry => entry.label === 'iteration limit')).toEqual({
      label: 'iteration limit',
      value: '1024',
    });
  });

  it('preserves an explicit iteration limit', () => {
    expect(runtimeConfigSummary({ iterationLimit: 512 }).find(entry => entry.label === 'iteration limit')).toEqual({
      label: 'iteration limit',
      value: '512',
    });
  });

  it('lists web search even when the host capability is unavailable', () => {
    expect(runtimeConfigSummary({ webSearch: { enabled: true } }).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'on',
    });
  });

  it('falls back to the host capability when the spec says nothing', () => {
    expect(runtimeConfigSummary({}, { webSearchAvailable: true }).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'on',
    });
    expect(runtimeConfigSummary({}).find(entry => entry.label === 'web search')).toEqual({
      label: 'web search',
      value: 'off',
    });
  });

  it('includes memory defaulting to off when the host offers it', () => {
    expect(runtimeConfigSummary({}, { memoryOffered: true }).find(entry => entry.label === 'memory')).toEqual({
      label: 'memory',
      value: 'off',
    });
    expect(
      runtimeConfigSummary({ memory: { enabled: true } }, { memoryOffered: true }).find(
        entry => entry.label === 'memory',
      ),
    ).toEqual({ label: 'memory', value: 'on' });
  });

  it('omits memory when the host does not offer it', () => {
    expect(runtimeConfigSummary({ memory: { enabled: true } }).map(entry => entry.label)).not.toContain('memory');
  });
});
