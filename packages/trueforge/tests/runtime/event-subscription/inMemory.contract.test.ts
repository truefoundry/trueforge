import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription';
import { InMemoryEventStreamStore } from '../../../src/runtime/event-subscription/inMemory';
import { runEventSubscriptionContractSuite, type TestEvent } from './contractSuite';

describe('InMemoryEventSubscription (EventSubscription contract)', () => {
  runEventSubscriptionContractSuite(() => {
    const store = new InMemoryEventStreamStore<TestEvent>();
    return {
      registry: new EventSubscriptionRegistry(undefined, store),
      evictStream: streamId => {
        store.evictStream(streamId);
        return Promise.resolve();
      },
    };
  });
});
