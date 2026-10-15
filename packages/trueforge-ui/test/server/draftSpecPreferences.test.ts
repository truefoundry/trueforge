// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
  CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
  DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
  readDraftSpecPreferences,
  recoverWebSearchAfterCapabilityAvailable,
  selectAgentDraftSpecPreferences,
  selectChatDraftSpecPreferences,
  webSearchPreferenceToStore,
  withCapabilitiesSandbox,
  withCapabilitiesWebSearch,
  withoutWebSearchPreference,
  writeDraftSpecPreferences,
} from '@/server/draftSpecPreferences.js';

describe('selectDraftSpecPreferences', () => {
  it('keeps model, skills, MCP, and web-search for chat — not other runtime config', () => {
    expect(
      selectChatDraftSpecPreferences({
        model: { name: 'm', params: { reasoningEffort: 'high' } },
        skills: [{ name: 's' }],
        mcpServers: [{ name: 'c' }],
        config: { sandbox: { enabled: true }, webSearch: { enabled: false } },
        instructions: 'nope',
      }),
    ).toEqual({
      model: { name: 'm', params: { reasoningEffort: 'high' } },
      skills: [{ name: 's' }],
      mcpServers: [{ name: 'c' }],
      config: { webSearch: { enabled: false } },
    });
  });

  it('omits chat config when web search was never set', () => {
    expect(
      selectChatDraftSpecPreferences({
        model: { name: 'm' },
        config: { sandbox: { enabled: true } },
      }),
    ).toEqual({ model: { name: 'm' } });
  });

  it('keeps runtime config for agent', () => {
    expect(
      selectAgentDraftSpecPreferences({
        model: { name: 'm' },
        config: { sandbox: { enabled: true } },
        instructions: 'nope',
      }),
    ).toEqual({
      model: { name: 'm' },
      config: { sandbox: { enabled: true } },
    });
  });
});

describe('draft preference storage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
    window.localStorage.removeItem(CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
    window.localStorage.removeItem(AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
  });

  it('stores chat and agent preferences separately', () => {
    writeDraftSpecPreferences('chat', {
      model: { name: 'chat/model' },
      config: { sandbox: { enabled: true } },
    });
    writeDraftSpecPreferences('agent', {
      model: { name: 'agent/model' },
      config: { sandbox: { enabled: true } },
    });

    expect(readDraftSpecPreferences('chat')).toEqual({ model: { name: 'chat/model' } });
    expect(readDraftSpecPreferences('agent')).toEqual({
      model: { name: 'agent/model' },
      config: { sandbox: { enabled: true } },
    });
  });

  it('persists the chat web-search toggle across read/write', () => {
    writeDraftSpecPreferences('chat', {
      model: { name: 'chat/model' },
      config: { sandbox: { enabled: true }, webSearch: { enabled: false } },
    });

    expect(readDraftSpecPreferences('chat')).toEqual({
      model: { name: 'chat/model' },
      config: { webSearch: { enabled: false } },
    });
  });

  it('migrates the legacy shared key into both stores', () => {
    window.localStorage.setItem(
      DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        spec: {
          model: { name: 'legacy/model' },
          skills: [{ name: 'Skill' }],
          config: { sandbox: { enabled: true } },
        },
      }),
    );

    expect(readDraftSpecPreferences('chat')).toEqual({
      model: { name: 'legacy/model' },
      skills: [{ name: 'Skill' }],
    });
    expect(readDraftSpecPreferences('agent')).toEqual({
      model: { name: 'legacy/model' },
      skills: [{ name: 'Skill' }],
      config: { sandbox: { enabled: true } },
    });
    expect(window.localStorage.getItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it('keeps the legacy key when a destination write fails', () => {
    window.localStorage.setItem(
      DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        spec: {
          model: { name: 'legacy/model' },
          config: { sandbox: { enabled: true } },
        },
      }),
    );

    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY) {
        throw new Error('quota exceeded');
      }
      return originalSetItem.call(this, key, value);
    });

    expect(readDraftSpecPreferences('chat')).toEqual({ model: { name: 'legacy/model' } });
    expect(readDraftSpecPreferences('agent')).toBeNull();
    expect(window.localStorage.getItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY)).not.toBeNull();

    setItemSpy.mockRestore();
    expect(readDraftSpecPreferences('agent')).toEqual({
      model: { name: 'legacy/model' },
      config: { sandbox: { enabled: true } },
    });
    expect(window.localStorage.getItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY)).toBeNull();
  });
});

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

describe('withCapabilitiesWebSearch', () => {
  it('forces false when the host capability is off', () => {
    expect(
      withCapabilitiesWebSearch({
        spec: { model: { name: 'model' }, config: { webSearch: { enabled: true } } },
        webSearchEnabled: false,
        kind: 'chat',
      }),
    ).toEqual({
      model: { name: 'model' },
      config: { webSearch: { enabled: false } },
    });
  });

  it('preserves an explicit chat toggle when the capability is on', () => {
    const spec = { model: { name: 'model' }, config: { webSearch: { enabled: false } } };

    expect(withCapabilitiesWebSearch({ spec, webSearchEnabled: true, kind: 'chat' })).toBe(spec);
  });

  it('fills true when the field is absent and the capability is on', () => {
    expect(
      withCapabilitiesWebSearch({
        spec: { model: { name: 'model' } },
        webSearchEnabled: true,
        kind: 'chat',
      }),
    ).toEqual({
      model: { name: 'model' },
      config: { webSearch: { enabled: true } },
    });
  });

  it('preserves an explicit agent value when the capability is on', () => {
    const spec = { model: { name: 'model' }, config: { webSearch: { enabled: false } } };

    expect(withCapabilitiesWebSearch({ spec, webSearchEnabled: true, kind: 'agent' })).toBe(spec);
  });

  it('does not change the spec while capabilities are still loading', () => {
    const spec = { model: { name: 'model' } };

    expect(withCapabilitiesWebSearch({ spec, webSearchEnabled: undefined, kind: 'chat' })).toBe(spec);
    expect(withCapabilitiesWebSearch({ spec, webSearchEnabled: null, kind: 'agent' })).toBe(spec);
  });
});

describe('withoutWebSearchPreference', () => {
  it('removes webSearch and drops empty config', () => {
    expect(
      withoutWebSearchPreference({
        model: { name: 'model' },
        config: { webSearch: { enabled: false } },
      }),
    ).toEqual({ model: { name: 'model' } });
  });

  it('keeps other config fields', () => {
    expect(
      withoutWebSearchPreference({
        model: { name: 'model' },
        config: { sandbox: { enabled: true }, webSearch: { enabled: false } },
      }),
    ).toEqual({
      model: { name: 'model' },
      config: { sandbox: { enabled: true } },
    });
  });

  it('returns the same spec when webSearch is already absent', () => {
    const spec = { model: { name: 'model' } };
    expect(withoutWebSearchPreference(spec)).toBe(spec);
  });
});

describe('recoverWebSearchAfterCapabilityAvailable', () => {
  it('default-fills on when capability flips unavailable → available with forced-off live', () => {
    expect(
      recoverWebSearchAfterCapabilityAvailable({
        spec: { model: { name: 'model' }, config: { webSearch: { enabled: false } } },
        previousWebSearchEnabled: false,
        webSearchEnabled: true,
        kind: 'chat',
      }),
    ).toEqual({
      model: { name: 'model' },
      config: { webSearch: { enabled: true } },
    });
  });

  it('is a no-op when capability did not just become available', () => {
    const spec = { model: { name: 'model' }, config: { webSearch: { enabled: false } } };
    expect(
      recoverWebSearchAfterCapabilityAvailable({
        spec,
        previousWebSearchEnabled: true,
        webSearchEnabled: true,
        kind: 'chat',
      }),
    ).toBe(spec);
  });

  it('is a no-op when live webSearch is not forced off', () => {
    const spec = { model: { name: 'model' }, config: { webSearch: { enabled: true } } };
    expect(
      recoverWebSearchAfterCapabilityAvailable({
        spec,
        previousWebSearchEnabled: false,
        webSearchEnabled: true,
        kind: 'chat',
      }),
    ).toBe(spec);
  });

  it('keeps an explicit off when capability becomes available', () => {
    const spec = { model: { name: 'model' }, config: { webSearch: { enabled: false } } };
    expect(
      recoverWebSearchAfterCapabilityAvailable({
        spec,
        previousWebSearchEnabled: false,
        webSearchEnabled: true,
        explicitOff: true,
        kind: 'chat',
      }),
    ).toBe(spec);
  });
});

describe('webSearchPreferenceToStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem(CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
  });

  it('omits a forced off when nothing was chosen', () => {
    expect(
      webSearchPreferenceToStore({
        spec: { model: { name: 'model' }, config: { webSearch: { enabled: false } } },
        webSearchEnabled: false,
        previousWebSearchEnabled: true,
        kind: 'chat',
      }),
    ).toEqual({ model: { name: 'model' } });
  });

  it('keeps a stored off while search is unavailable and after it returns', () => {
    writeDraftSpecPreferences('chat', {
      model: { name: 'model' },
      config: { webSearch: { enabled: false } },
    });
    const forcedOff = { model: { name: 'model' }, config: { webSearch: { enabled: false } } };

    expect(
      webSearchPreferenceToStore({
        spec: forcedOff,
        webSearchEnabled: false,
        previousWebSearchEnabled: true,
        kind: 'chat',
      }),
    ).toEqual(forcedOff);
    expect(
      webSearchPreferenceToStore({
        spec: forcedOff,
        webSearchEnabled: true,
        previousWebSearchEnabled: false,
        kind: 'chat',
      }),
    ).toEqual(forcedOff);
  });

  it('default-fills on after an outage when no choice was stored', () => {
    expect(
      webSearchPreferenceToStore({
        spec: { model: { name: 'model' }, config: { webSearch: { enabled: false } } },
        webSearchEnabled: true,
        previousWebSearchEnabled: false,
        kind: 'chat',
      }),
    ).toEqual({
      model: { name: 'model' },
      config: { webSearch: { enabled: true } },
    });
  });
});
