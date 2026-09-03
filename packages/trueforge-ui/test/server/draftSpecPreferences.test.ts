// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { withCapabilitiesSandbox } from '@/server/draftSpecPreferences.js';

describe('withCapabilitiesSandbox', () => {
  it('does not enable sandbox merely because it is available', () => {
    expect(withCapabilitiesSandbox({ model: { name: 'model' } }, true)).toEqual({
      model: { name: 'model' },
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
      },
    });
  });

  it('disables a spec-owned sandbox when it is unavailable', () => {
    expect(
      withCapabilitiesSandbox({ model: { name: 'model' }, config: { sandbox: { enabled: true } } }, false),
    ).toEqual({
      model: { name: 'model' },
      config: { sandbox: { enabled: false } },
    });
  });

  it('preserves the spec sandbox while capabilities are unavailable', () => {
    const spec = { model: { name: 'model' }, config: { sandbox: { enabled: true } } };

    expect(withCapabilitiesSandbox(spec, undefined)).toBe(spec);
    expect(withCapabilitiesSandbox(spec, null)).toBe(spec);
  });

  it('returns the same spec when sandbox already matches capabilities', () => {
    const spec = { model: { name: 'model' }, config: { sandbox: { enabled: false } } };

    expect(withCapabilitiesSandbox(spec, false)).toBe(spec);
  });
});
