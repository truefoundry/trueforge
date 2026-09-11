export const typescriptStreamTemplate = `// npm install @truefoundry/trueforge-sdk
import { TrueForge, TrueForgeApi, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
  baseUrl: {{baseUrl}},{{tokenLine}}
});

const { data: session } = await client.sessions.create({
  agent: { name: {{agentName}} },
});

const events = new Map<string, TrueForgeApi.TurnStreamingEvent>();

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: "user.message", content: "Hello!" }],
});

for await (const { data: event } of stream.withMetadata()) {
  console.log(event);
  if (isEventDelta(event)) {
    const base = events.get(event.id);
    if (base) mergeEventDelta(base, event);
  } else {
    events.set(event.id, event);
  }
}
`;

export const typescriptNonStreamTemplate = `// npm install @truefoundry/trueforge-sdk
import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
  baseUrl: {{baseUrl}},{{tokenLine}}
});

const { data: session } = await client.sessions.create({
  agent: { name: {{agentName}} },
});

const { data: turn } = await client.sessions.createTurn(session.id, {
  input: [{ type: "user.message", content: "Hello!" }],
});

console.log(turn.id, turn.state);

// Call getTurn to read check turn state.
const { data: latest } = await client.sessions.getTurn(session.id, turn.id);
console.log(latest.state);
`;
