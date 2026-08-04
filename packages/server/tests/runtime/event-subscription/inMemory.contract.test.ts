import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription';
import { runEventSubscriptionContractSuite, type TestEvent } from './contractSuite';

describe('InMemoryEventSubscription (EventSubscription contract)', () => {
  runEventSubscriptionContractSuite(() => new EventSubscriptionRegistry<TestEvent>(undefined));
});
