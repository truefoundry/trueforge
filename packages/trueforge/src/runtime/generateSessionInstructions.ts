/**
 * Drafts system instructions from a session transcript. Does not write them
 * back — the caller returns a suggestion the user can edit and apply.
 */
import type {
  AgentSpec,
  SessionAgent,
  SessionEventItem,
  TokenPagination,
} from '@truefoundry/trueforge-core/agent-session';
import type { ILLM } from '@truefoundry/trueforge-core/core';
import type { GeneratedSessionInstructions } from '../schemas/session';
import {
  assertTranscriptHasInstructionSignal,
  buildInstructionGenerationPrompt,
  extractChatTranscript,
  parseGeneratedInstructions,
  sourcesFromTranscript,
} from './chatInstructionTranscript';

function textFromLlmContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }
    if (Reflect.get(part, 'type') !== 'text') {
      continue;
    }
    const text: unknown = Reflect.get(part, 'text');
    if (typeof text === 'string') {
      parts.push(text);
    }
  }
  return parts.join('\n');
}

export async function loadInstructionTranscriptEvents(session: {
  listEvents: (input: {
    limit: number;
    page_token?: string | undefined;
  }) => Promise<{ data: SessionEventItem[]; pagination: TokenPagination }>;
}): Promise<SessionEventItem[]> {
  const events: SessionEventItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page += 1) {
    const result = await session.listEvents({
      limit: 100,
      ...(pageToken === undefined ? {} : { page_token: pageToken }),
    });
    events.push(...result.data);
    const next = result.pagination.next_page_token;
    if (next === undefined || next.length === 0) {
      break;
    }
    pageToken = next;
  }
  return events;
}

export async function resolveSessionAgentSpec(input: {
  agent: SessionAgent;
  getAgentById: (id: string) => Promise<{ manifest: AgentSpec } | undefined>;
}): Promise<AgentSpec | undefined> {
  if (input.agent.type === 'inline') {
    return input.agent.spec;
  }
  const record = await input.getAgentById(input.agent.id);
  return record?.manifest;
}

export async function draftInstructionsFromChat(input: {
  events: readonly SessionEventItem[];
  currentInstructions: string | undefined;
  llm: ILLM;
}): Promise<GeneratedSessionInstructions> {
  const lines = extractChatTranscript(input.events);
  assertTranscriptHasInstructionSignal(lines);
  const prompt = buildInstructionGenerationPrompt({
    currentInstructions: input.currentInstructions,
    lines,
  });
  const completion = await input.llm.createNonStream({
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  });
  const instructions = parseGeneratedInstructions(textFromLlmContent(completion.output.content));
  const current = input.currentInstructions?.trim();
  return {
    instructions,
    current_instructions: current === undefined || current.length === 0 ? null : current,
    sources: sourcesFromTranscript(lines),
  };
}
