import {
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_REMINDER_TAG,
  WEB_SEARCH_TOOL_NAME,
  buildWebSearchInstruction,
} from '../../../../src/core/capabilities/builtins/WebSearch';
import { InstructionBuilder } from '../../../../src/core/InstructionBuilder';

describe('buildWebSearchInstruction', () => {
  it('adds when-to-search guidance referencing both tools', () => {
    const builder = new InstructionBuilder('capabilities');
    buildWebSearchInstruction(builder);
    const text = builder.build();
    expect(text).toContain(WEB_SEARCH_REMINDER_TAG);
    expect(text).toContain(WEB_SEARCH_TOOL_NAME);
    expect(text).toContain(WEB_FETCH_TOOL_NAME);
    expect(text).toContain('may have changed recently');
    expect(text).toContain('Start with');
  });
});
