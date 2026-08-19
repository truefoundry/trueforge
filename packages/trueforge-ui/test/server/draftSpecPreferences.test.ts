// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { withCapabilitiesSandbox } from '@/server/draftSpecPreferences.js';

describe('withCapabilitiesSandbox', () => {
  it('adds sandbox config when config is missing', () => {
    expect(withCapabilitiesSandbox({ model: { name: 'model' } }, true)).toEqual({
      model: { name: 'model' },
      config: { sandbox: { enabled: true } },
    });
  });

  it('preserves other runtime config', () => {
    expect(
      withCapabilitiesSandbox(
        {
          model: { name: 'model' },
          config: { askUserQuestions: { enabled: false } },
        },
        true,
      ),
    ).toEqual({
      model: { name: 'model' },
      config: {
        askUserQuestions: { enabled: false },
        sandbox: { enabled: true },
      },
    });
  });

  it('overrides a spec-owned sandbox flag from capabilities', () => {
    expect(withCapabilitiesSandbox(withCapabilitiesSandbox({ model: { name: 'model' } }, true), false)).toEqual({
      model: { name: 'model' },
      config: { sandbox: { enabled: false } },
    });
  });

  it('preserves the spec sandbox while capabilities are unavailable', () => {
    const spec = withCapabilitiesSandbox({ model: { name: 'model' } }, true);

    expect(withCapabilitiesSandbox(spec, undefined)).toBe(spec);
    expect(withCapabilitiesSandbox(spec, null)).toBe(spec);
  });

  it('returns the same spec when sandbox already matches capabilities', () => {
    const spec = withCapabilitiesSandbox({ model: { name: 'model' } }, true);

    expect(withCapabilitiesSandbox(spec, true)).toBe(spec);
  });
});
