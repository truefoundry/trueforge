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
  it('passes every page to the install when the stream is missing', async () => {
    const pages: Row[][] = [];
    let refreshed = 0;

    const outcome = await applyEventLogRestore({
      readPages: () => pagesOf([created, paused], [], [running, done]),
      readTailEntryId: () => Promise.resolve(undefined),
      installIfAbsent: async events => {
        for await (const page of events) {
          pages.push([...page]);
        }
        return true;
      },
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(pages).toEqual([[created, paused], [], [running, done]]);
    expect(refreshed).toBe(0);
    expect(outcome).toBe('installed');
  });

  it('leaves an existing stream alone and only refreshes its TTL', async () => {
    let installed = 0;
    let refreshed = 0;

    const outcome = await applyEventLogRestore({
      readPages: () => pagesOf([created, paused, running]),
      readTailEntryId: () => Promise.resolve('2-0'),
      installIfAbsent: () => {
        installed += 1;
        return Promise.resolve(true);
      },
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(installed).toBe(0);
    expect(refreshed).toBe(1);
    expect(outcome).toBe('present');
  });

  it('refreshes the TTL when the install loses the race', async () => {
    let refreshed = 0;

    const outcome = await applyEventLogRestore({
      readPages: () => pagesOf([created]),
      readTailEntryId: () => Promise.resolve(undefined),
      installIfAbsent: () => Promise.resolve(false),
      refreshTtl: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });

    expect(refreshed).toBe(1);
    expect(outcome).toBe('lost_race');
  });
});
