import { InternalEventType } from '../../../src/core/runtime/AgentThread.types';

describe('passthrough event identity (public harness)', () => {
  it('includes PASSTHROUGH in public InternalEventType', () => {
    expect(InternalEventType.PASSTHROUGH).toBe('agent.passthrough');
  });

  it('keeps plan.overwrite as a passthrough event type, not a wire InternalEventType constant', () => {
    expect(Object.values(InternalEventType)).not.toContain('internal.agent.plan.overwrite');
  });
});
