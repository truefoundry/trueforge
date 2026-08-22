import {
  AgentSpecSchema,
  EventType,
  MAIN_THREAD_ID,
  type SessionEventItem,
} from '@truefoundry/trueforge-core/agent-session';
import type { ILLM } from '@truefoundry/trueforge-core/core';
import { InsufficientChatSignalError } from '../../../src/runtime/chatInstructionTranscript';
import {
  draftInstructionsFromChat,
  loadInstructionTranscriptEvents,
  resolveSessionAgentSpec,
} from '../../../src/runtime/generateSessionInstructions';

function llmThatReturns(text: string): ILLM {
  return {
    create: jest.fn(),
    createNonStream: jest.fn().mockResolvedValue({
      output: { role: 'assistant', content: text },
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      finish_reason: 'stop',
    }),
  };
}

function richTranscript(): SessionEventItem[] {
  return [
    {
      turn_id: 't1',
      event: {
        type: EventType.MODEL_MESSAGE,
        id: 'e2',
        thread_id: MAIN_THREAD_ID,
        created_at: '2026-08-01T00:00:01.000Z',
        content: 'I will write the notes in that format.',
      },
    },
    {
      turn_id: 't1',
      event: {
        type: EventType.TURN_CREATED,
        id: 'e1',
        turn_id: 't1',
        previous_turn_id: null,
        input: [
          {
            type: EventType.USER_MESSAGE,
            content:
              'You are a release notes writer. Group changes by feature then bugfix. Never mention internal ticket ids.',
          },
        ],
        state: { status: 'running' },
        created_at: '2026-08-01T00:00:00.000Z',
        thread_id: null,
      },
    },
  ];
}

describe('draftInstructionsFromChat', () => {
  it('returns a suggestion without applying it', async () => {
    const result = await draftInstructionsFromChat({
      events: richTranscript(),
      currentInstructions: 'Be helpful.',
      llm: llmThatReturns('Write release notes grouped by feature then bugfix. Never mention ticket ids.'),
    });
    expect(result.current_instructions).toBe('Be helpful.');
    expect(result.instructions).toContain('release notes');
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]?.role).toBe('user');
  });

  it('does not call the model when the chat is too thin', async () => {
    const llm = llmThatReturns('should not run');
    const createNonStream = jest.spyOn(llm, 'createNonStream');
    await expect(
      draftInstructionsFromChat({
        events: [],
        currentInstructions: undefined,
        llm,
      }),
    ).rejects.toBeInstanceOf(InsufficientChatSignalError);
    expect(createNonStream).not.toHaveBeenCalled();
  });
});

describe('resolveSessionAgentSpec', () => {
  const inlineSpec = AgentSpecSchema.parse({
    model: { name: 'anthropic/claude-sonnet-4-6' },
    instructions: 'inline',
  });

  it('returns an inline spec without a registry lookup', async () => {
    const getAgentById = jest.fn();
    const spec = await resolveSessionAgentSpec({
      agent: { type: 'inline', spec: inlineSpec },
      getAgentById,
    });
    expect(spec?.instructions).toBe('inline');
    expect(getAgentById).not.toHaveBeenCalled();
  });

  it('resolves a named session from the agent store', async () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'anthropic/claude-sonnet-4-6' },
      instructions: 'from-registry',
    });
    const resolved = await resolveSessionAgentSpec({
      agent: { type: 'reference', id: 'agt_1', name: 'writer' },
      getAgentById: async id => (id === 'agt_1' ? { manifest: spec } : undefined),
    });
    expect(resolved).toEqual(spec);
  });
});

describe('loadInstructionTranscriptEvents', () => {
  it('pages session events until the cursor is exhausted', async () => {
    const listEvents = jest
      .fn()
      .mockResolvedValueOnce({
        data: richTranscript().slice(0, 1),
        pagination: { next_page_token: 'p2' },
      })
      .mockResolvedValueOnce({
        data: richTranscript().slice(1),
        pagination: {},
      });
    const events = await loadInstructionTranscriptEvents({ listEvents });
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
  });
});
