import { describe, expect, it } from 'vitest';

import { webSearchGate } from '@/atoms/draft/agentCapabilities.js';

describe('webSearchGate', () => {
  it('locks nothing while capabilities are still loading', () => {
    expect(webSearchGate({ capabilities: null, enabled: false })).toEqual({ locked: false, offIsFinal: false });
    expect(webSearchGate({ capabilities: null, enabled: true })).toEqual({ locked: false, offIsFinal: false });
  });

  it('locks an off spec once the host says web search is unavailable', () => {
    expect(webSearchGate({ capabilities: { webSearch: { enabled: false } }, enabled: false })).toEqual({
      locked: true,
      offIsFinal: false,
    });
  });

  it('keeps an on spec toggleable but warns the turn-off is final', () => {
    expect(webSearchGate({ capabilities: { webSearch: { enabled: false } }, enabled: true })).toEqual({
      locked: false,
      offIsFinal: true,
    });
  });

  it('leaves both off when the host allows web search', () => {
    expect(webSearchGate({ capabilities: { webSearch: { enabled: true } }, enabled: false })).toEqual({
      locked: false,
      offIsFinal: false,
    });
  });

  it('treats a host that omits web search as unavailable', () => {
    expect(webSearchGate({ capabilities: {}, enabled: false })).toEqual({ locked: true, offIsFinal: false });
  });
});
