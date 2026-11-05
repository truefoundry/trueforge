import { applyEventLogRestore } from '../../../src/runtime/event-subscription/restore';

interface Row {
  id: string;
  type: string;
}

const created: Row = { id: 'evt-1', type: 'turn.created' };
const paused: Row = { id: 'evt-2', type: 'turn.update' };
const running: Row = { id: 'evt-3', type: 'turn.update' };
const done: Row = { id: 'evt-4', type: 'turn.done' };

async function* pagesOf(...pages: Row[][]): AsyncGenerator<Row[]> {
  await Promise.resolve();
  for (const page of pages) {
    yield page;
  }
}

describe('applyEventLogRestore', () => {
  it('appends every page of the log to an empty stream, chaining the expected tail', async () => {
    const batches: { tailEntryId: string | undefined; events: Row[] }[] = [];
    const writtenTailIds = ['2-0', '4-0'];
    let refreshed = 0;

    await applyEventLogRestore({
      readPages: () => pagesOf([created, paused], [], [running, done]),
      readTailEntryId: () => Promise.resolve(undefined),
      appendAfterTail: batch => {
        batches.push(batch);
        const tailEntryId = writtenTailIds.shift();
        return Promise.resolve(tailEntryId === undefined ? { status: 'stale' } : { status: 'ok', tailEntryId });
      },
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(batches).toEqual([
      { tailEntryId: undefined, events: [created, paused] },
      { tailEntryId: '2-0', events: [running, done] },
    ]);
    expect(refreshed).toBe(0);
  });

  it('leaves an existing stream alone and only refreshes its TTL', async () => {
    let appended = 0;
    let refreshed = 0;

    await applyEventLogRestore({
      readPages: () => pagesOf([created, paused, running]),
      readTailEntryId: () => Promise.resolve('2-0'),
      appendAfterTail: () => {
        appended += 1;
        return Promise.resolve({ status: 'stale' });
      },
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(appended).toBe(0);
    expect(refreshed).toBe(1);
  });

  it('stops when a concurrent writer moves the tail and refreshes the TTL', async () => {
    const batches: { tailEntryId: string | undefined; events: Row[] }[] = [];
    let refreshed = 0;

    await applyEventLogRestore({
      readPages: () => pagesOf([created], [paused]),
      readTailEntryId: () => Promise.resolve(undefined),
      appendAfterTail: batch => {
        batches.push(batch);
        return Promise.resolve({ status: 'stale' });
      },
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(batches).toEqual([{ tailEntryId: undefined, events: [created] }]);
    expect(refreshed).toBe(1);
  });
});
