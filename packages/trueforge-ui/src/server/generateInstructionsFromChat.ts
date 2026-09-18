import type { AgentUIServer } from './types.js';

export type GeneratedChatInstructionSource = {
  turnId: string;
  role: 'user' | 'assistant';
  excerpt: string;
};

export type GeneratedChatInstructions = {
  instructions: string;
  currentInstructions: string | null;
  sources: GeneratedChatInstructionSource[];
};

export type GenerateInstructionsFromChat = (request: { sessionId: string }) => Promise<GeneratedChatInstructions>;

export type AgentUIServerWithInstructionDraft = AgentUIServer & {
  generateInstructionsFromChat: GenerateInstructionsFromChat;
};

export function hasGenerateInstructionsFromChat(
  server: AgentUIServer | null,
): server is AgentUIServerWithInstructionDraft {
  return server != null && typeof Reflect.get(server, 'generateInstructionsFromChat') === 'function';
}
