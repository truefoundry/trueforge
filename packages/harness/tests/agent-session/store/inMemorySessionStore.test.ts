import { InMemorySessionStore } from '../../../src/agent-session/store/InMemorySessionStore';
import { runStoreContractSuite } from './storeContractSuite';

describe('InMemorySessionStore (ISessionStore contract)', () => {
  runStoreContractSuite(() => new InMemorySessionStore());
});
