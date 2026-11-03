import { applyEventLogRepair, eventLogPages, type StreamTail } from '../../../src/runtime/event-subscription/repair';

interface Row {
  id: string;
  type: string;
}

function tailOf(row: Row, entryId: string): StreamTail {
  return { entryId, eventId: row.id, payload: JSON.stringify(row) };
}

describe('applyEventLogRepair', () => {
  it('recomputes the suffix when a concurrent writer moves the tail', async () => {
    const created: Row = { id: 'evt-1', type: 'turn.created' };
    const paused: Row = { id: 'evt-2', type: 'turn.update' };
    const running: Row = { id: 'evt-3', type: 'turn.update' };
    const entries = [created, paused, running].map(event => ({ id: event.id, event }));
    // The first read sees only `created`; by the append the producer has written through `running`.
    const tails = [tailOf(created, '1-0'), tailOf(running, '3-0')];
    const batches: { tailEntryId: string | undefined; events: Row[] }[] = [];

    await applyEventLogRepair({
      readPages: eventLogPages(entries),
      readTail: () => Promise.resolve(tails.shift()),
      appendAfterTail: batch => {
        batches.push(batch);
        return Promise.resolve({ status: 'stale' });
      },
      refreshTtl: () => Promise.resolve(),
      refreshTtlOnUntouchedStream: false,
    });

    expect(batches).toEqual([{ tailEntryId: '1-0', events: [paused, running] }]);
  });

  it('gives up when the tail keeps moving', async () => {
    const created: Row = { id: 'evt-1', type: 'turn.created' };
    const paused: Row = { id: 'evt-2', type: 'turn.update' };
    await expect(
      applyEventLogRepair({
        readPages: eventLogPages([created, paused].map(event => ({ id: event.id, event }))),
        readTail: () => Promise.resolve(tailOf(created, '1-0')),
        appendAfterTail: () => Promise.resolve({ status: 'stale' }),
        refreshTtl: () => Promise.resolve(),
        refreshTtlOnUntouchedStream: false,
      }),
    ).rejects.toThrow('Stream repair gave up');
  });

  it('appends later pages after the entry id the previous page wrote', async () => {
    const created: Row = { id: 'evt-1', type: 'turn.created' };
    const paused: Row = { id: 'evt-2', type: 'turn.update' };
    const running: Row = { id: 'evt-3', type: 'turn.update' };
    const done: Row = { id: 'evt-4', type: 'turn.done' };
    const batches: { tailEntryId: string | undefined; events: Row[] }[] = [];
    const writtenTailIds = ['8-0', '9-0'];

    await applyEventLogRepair({
      readPages: () =>
        (async function* () {
          yield [{ id: created.id, event: created }];
          yield [
            { id: paused.id, event: paused },
            { id: running.id, event: running },
          ];
          yield [{ id: done.id, event: done }];
        })(),
      readTail: () => Promise.resolve(tailOf(paused, '2-0')),
      appendAfterTail: batch => {
        batches.push(batch);
        const tailEntryId = writtenTailIds.shift();
        if (tailEntryId === undefined) {
          return Promise.resolve({ status: 'stale' });
        }
        return Promise.resolve({ status: 'ok', tailEntryId });
      },
      refreshTtl: () => Promise.resolve(),
      refreshTtlOnUntouchedStream: false,
    });

    expect(batches).toEqual([
      { tailEntryId: '2-0', events: [running] },
      { tailEntryId: '8-0', events: [done] },
    ]);
  });
});
