import { newEventId } from '../../../src/core/events/schema';

describe('newEventId', () => {
  it('is lexically monotonic within the same millisecond', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
      const ids = [newEventId(), newEventId(), newEventId()];

      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(ids.map(id => id.toLowerCase()));
    } finally {
      jest.useRealTimers();
    }
  });
});
