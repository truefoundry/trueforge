export const typescriptStreamTemplate = `// npm install @truefoundry/trueforge-sdk
import { TrueForge, TrueForgeApi, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
  baseUrl: {{baseUrl}},
  timeoutInSeconds: 600,
});

const { data: session } = await client.sessions.create({
  agent: { name: {{agentName}} },
});

const events = new Map<string, TrueForgeApi.TurnStreamingEvent>();
let turnId: string | undefined;
let lastSequenceNumber = 0;

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: "user.message", content: "Hello!" }],
});

for await (const { data: event, id } of stream.withMetadata()) {
  if (id != null) lastSequenceNumber = Number(id);
  if (event.type === "turn.created") turnId = event.turnId;
  if (isEventDelta(event)) {
    const base = events.get(event.id);
    if (base) mergeEventDelta(base, event);
  } else {
    events.set(event.id, event);
  }
  if (event.type === "turn.done") console.log("status:", event.state.status);
}
`;

export const typescriptNonStreamTemplate = `// npm install @truefoundry/trueforge-sdk
import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
  baseUrl: {{baseUrl}},
  timeoutInSeconds: 600,
});

const { data: session } = await client.sessions.create({
  agent: { name: {{agentName}} },
});

const { data: turn } = await client.sessions.createTurn(session.id, {
  input: [{ type: "user.message", content: "Hello!" }],
});

console.log(turn.id, turn.state);

// Turn may still be running. Call getTurn to read a later state.
const { data: latest } = await client.sessions.getTurn(session.id, turn.id);
console.log(latest.state);
`;
