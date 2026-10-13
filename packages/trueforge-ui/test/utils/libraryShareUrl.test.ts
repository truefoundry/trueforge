import {
  clearLibraryShareSearch,
  readLibraryShareSearch,
  replaceLibraryShareSearch,
  writeLibraryShareSearch,
} from '@/utils/libraryShareUrl.js';

describe('libraryShareUrl', () => {
  it('reads agent_name from the search string', () => {
    expect(readLibraryShareSearch('?agent_name=ask-ai-clone&theme=dark')).toEqual({
      agentName: 'ask-ai-clone',
    });
    expect(readLibraryShareSearch('?agent_name=&theme=dark')).toEqual({
      agentName: null,
    });
    expect(readLibraryShareSearch('?theme=dark')).toEqual({
      agentName: null,
    });
  });

  it('writes and clears library-owned keys without touching host keys', () => {
    const params = new URLSearchParams('theme=dark&agent_name=old');
    writeLibraryShareSearch(params, { agentName: 'ask-ai-clone' });
    expect(params.toString()).toBe('theme=dark&agent_name=ask-ai-clone');

    writeLibraryShareSearch(params, { agentName: null });
    expect(params.toString()).toBe('theme=dark');

    writeLibraryShareSearch(params, { agentName: 'again' });
    clearLibraryShareSearch(params);
    expect(params.toString()).toBe('theme=dark');
  });

  it('replaceLibraryShareSearch updates the address bar', () => {
    window.history.replaceState(null, '', '/library?theme=dark');
    replaceLibraryShareSearch({ agentName: 'ask-ai-clone' });
    expect(new URL(window.location.href).searchParams.get('agent_name')).toBe('ask-ai-clone');
    expect(new URL(window.location.href).searchParams.get('theme')).toBe('dark');

    replaceLibraryShareSearch({ agentName: null });
    expect(new URL(window.location.href).searchParams.get('agent_name')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('theme')).toBe('dark');
  });
});
