import type { MemoryProvider } from '../../../src/memory/MemoryProvider';

/** Provider whose methods are jest mocks; retrieval defaults to an empty memory. */
export function fakeMemoryProvider() {
  const provider = {
    name: 'zep' as const,
    ingestExchange: jest
      .fn<ReturnType<MemoryProvider['ingestExchange']>, Parameters<MemoryProvider['ingestExchange']>>()
      .mockResolvedValue({ externalThreadId: 'thread' }),
    getUserSummary: jest
      .fn<ReturnType<MemoryProvider['getUserSummary']>, Parameters<MemoryProvider['getUserSummary']>>()
      .mockResolvedValue(null),
    search: jest.fn<ReturnType<MemoryProvider['search']>, Parameters<MemoryProvider['search']>>().mockResolvedValue([]),
    addMemory: jest
      .fn<ReturnType<MemoryProvider['addMemory']>, Parameters<MemoryProvider['addMemory']>>()
      .mockResolvedValue(undefined),
  } satisfies MemoryProvider;
  return provider;
}
