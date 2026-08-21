/**
 * Shared E2E helpers: SDK client, resource upserts, turn collection,
 * stream-vs-listTurnEvents reconciliation, and the sequential runner.
 */
import { TrueForge, TrueForgeApi, TrueForgeError, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { randomUUID } from 'node:crypto';

/** Host URL of docker-compose.e2e.yml (API mapped to 8792) */
export const E2E_BASE_URL = 'http://127.0.0.1:8792';

export const MCP_DEEPWIKI = 'deepwiki';
export const MCP_LINEAR = 'linear';
export const NAMED_AGENT = 'e2e-memory';

const WELL_KNOWN_PROVIDER_TYPES = Object.values(TrueForgeApi.CatalogWellKnownModelProviderType);

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key} (set it in packages/trueforge/e2e/.env)`);
  }
  return value.trim();
}

export function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}

export function turnTimeoutMs(): number {
  const raw = optionalEnv('TEST_TIMEOUT_MS');
  const parsed = raw !== undefined ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
}

export function createClient(): TrueForge {
  return new TrueForge({
    baseUrl: E2E_BASE_URL,
    timeoutInSeconds: Math.ceil(turnTimeoutMs() / 1000),
  });
}

export function baseAgentSpec(overrides: Partial<TrueForgeApi.AgentSpec> = {}): TrueForgeApi.AgentSpec {
  return {
    model: { name: requireEnv('MODEL'), params: { temperature: 0 } },
    ...overrides,
  };
}

export async function createInlineSession({
  client,
  spec,
}: {
  client: TrueForge;
  spec: TrueForgeApi.AgentSpec;
}): Promise<TrueForgeApi.Session> {
  const response = await client.sessions.create({ agent: { spec } });
  return response.data;
}

export async function createNamedAgentSession({
  client,
  name,
}: {
  client: TrueForge;
  name: string;
}): Promise<TrueForgeApi.Session> {
  const response = await client.sessions.create({ agent: { name } });
  return response.data;
}

export function userMessage(content: TrueForgeApi.UserMessageContent): TrueForgeApi.UserMessage {
  return { type: 'user.message', content };
}

export function textFileContent({
  name,
  text,
  mime = 'text/plain',
}: {
  name: string;
  text: string;
  mime?: string;
}): TrueForgeApi.FileContent {
  const base64 = Buffer.from(text, 'utf8').toString('base64');
  return { type: 'file', name, data: `data:${mime};base64,${base64}` };
}

export function approveToolCall({
  threadId,
  toolCallId,
}: {
  threadId: string;
  toolCallId: string;
}): TrueForgeApi.UserToolApprovalEvent {
  return { type: 'user.tool_approval', threadId, toolCallId, approval: { status: 'allow' } };
}

export function denyToolCall({
  threadId,
  toolCallId,
  reason,
}: {
  threadId: string;
  toolCallId: string;
  reason?: string;
}): TrueForgeApi.UserToolApprovalEvent {
  return {
    type: 'user.tool_approval',
    threadId,
    toolCallId,
    approval: reason !== undefined ? { status: 'deny', reason } : { status: 'deny' },
  };
}

/** Unguessable token so a pass proves data flowed through the feature, not a model guess. */
export function makeNonce(prefix = 'NONCE'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function httpStatusCode(error: unknown): number | undefined {
  return error instanceof TrueForgeError ? error.statusCode : undefined;
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const base = error.stack ?? error.message;
  return error.cause != null ? `${base}\ncaused by: ${errorMessage(error.cause)}` : base;
}

export type TurnEvent = TrueForgeApi.TurnStreamingEvent;
export type PersistedTurnEvent = TrueForgeApi.SessionEvent;
export type TurnDoneEvent = Extract<TurnEvent, { type: 'turn.done' }>;
export type TurnCreatedEvent = Extract<TurnEvent, { type: 'turn.created' }>;
export type ActionRequiredEvent = TrueForgeApi.ActionRequiredEvent;

export interface CollectedTurn {
  events: TurnEvent[];
  turnId: string | undefined;
  previousTurnId: string | null | undefined;
  threadIds: string[];
  threadId: string | undefined;
  finalText: string;
  consolidatedText: string | undefined;
  accumulatedText: string;
  sandboxIds: string[];
  terminal: TurnDoneEvent | undefined;
}

function messageText(content: TrueForgeApi.ModelMessageEventContent | null | undefined): string {
  if (content === undefined || content === null) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  return content.map(part => (part.type === 'text' ? part.text : '')).join('');
}

/** Fold stream deltas into base `model.message` events. Keep lifecycle events (OSS persists them). */
export function gatherEvents(events: TurnEvent[]): PersistedTurnEvent[] {
  const gathered: PersistedTurnEvent[] = [];
  const indexById = new Map<string, number>();
  for (const event of events) {
    if (isEventDelta(event)) {
      const idx = indexById.get(event.id);
      const base = idx !== undefined ? gathered[idx] : undefined;
      if (base?.type === 'model.message') {
        mergeEventDelta(base, event);
      }
      continue;
    }
    if (event.type === 'model.message') {
      indexById.set(event.id, gathered.length);
      gathered.push(structuredClone(event));
    } else {
      gathered.push(event);
    }
  }
  return gathered;
}

export function requiredActions(turn: CollectedTurn): ActionRequiredEvent[] {
  const state = turn.terminal?.state;
  return state?.status === 'done' ? state.requiredActions : [];
}

function isActionType<T extends ActionRequiredEvent['type']>(
  action: ActionRequiredEvent,
  type: T,
): action is Extract<ActionRequiredEvent, { type: T }> {
  return action.type === type;
}

export function requireAction<T extends ActionRequiredEvent['type']>({
  turn,
  type,
  label,
}: {
  turn: CollectedTurn;
  type: T;
  label?: string;
}): Extract<ActionRequiredEvent, { type: T }> {
  const actions = requiredActions(turn);
  const found = actions.find(action => isActionType(action, type));
  if (found === undefined) {
    const at = label !== undefined ? `[${label}] ` : '';
    throw new Error(`${at}expected a ${type} required action, got: ${actions.map(a => a.type).join(', ') || '(none)'}`);
  }
  return found;
}

export function summarizeTurn(events: TurnEvent[]): CollectedTurn {
  const deltasById = new Map<string, string>();
  const threadIds = new Set<string>();
  const sandboxIds: string[] = [];
  let created: TurnCreatedEvent | undefined;
  let terminal: TurnDoneEvent | undefined;

  for (const event of events) {
    if ('threadId' in event && event.threadId) {
      threadIds.add(event.threadId);
    }
    switch (event.type) {
      case 'turn.created':
        created = event;
        break;
      case 'turn.done':
        terminal = event;
        break;
      case 'sandbox.created':
        sandboxIds.push(event.sandboxId);
        break;
      case 'model.message.delta':
        deltasById.set(event.id, (deltasById.get(event.id) ?? '') + (event.content ?? ''));
        break;
    }
  }

  const output = terminal?.state.status === 'done' ? terminal.state.output : undefined;
  const consolidatedText = output !== undefined && output !== null ? messageText(output.content) : undefined;
  const accumulatedText =
    output?.id !== undefined ? (deltasById.get(output.id) ?? '') : [...deltasById.values()].join('');

  return {
    events,
    turnId: created?.turnId,
    previousTurnId: created?.previousTurnId,
    threadIds: [...threadIds],
    threadId: [...threadIds][0],
    finalText: consolidatedText ?? accumulatedText,
    consolidatedText,
    accumulatedText,
    sandboxIds,
    terminal,
  };
}

export async function collectTurn({
  client,
  sessionId,
  input,
  previousTurnId,
}: {
  client: TrueForge;
  sessionId: string;
  input?: TrueForgeApi.TurnInputItem[];
  previousTurnId?: TrueForgeApi.PreviousTurnIdInput;
}): Promise<CollectedTurn> {
  const request: TrueForgeApi.CreateTurnSessionsStreamRequest = {};
  if (input !== undefined) {
    request.input = input;
  }
  if (previousTurnId !== undefined) {
    request.previousTurnId = previousTurnId;
  }
  const stream = await client.sessions.createTurnStream(sessionId, request);
  const events: TurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  const turn = summarizeTurn(events);
  await assertGatheredEventsMatchListEvents({ client, sessionId, turn });
  return turn;
}

const IGNORED_EVENT_FIELDS = new Set(['createdAt']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (IGNORED_EVENT_FIELDS.has(key)) {
        continue;
      }
      const v = value[key];
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

async function assertGatheredEventsMatchListEvents({
  client,
  sessionId,
  turn,
}: {
  client: TrueForge;
  sessionId: string;
  turn: CollectedTurn;
}): Promise<void> {
  if (turn.turnId === undefined) {
    throw new InvariantError('cannot reconcile listTurnEvents: turn.created is missing a turn id');
  }
  const listed: PersistedTurnEvent[] = [];
  const page = await client.sessions.listTurnEvents(sessionId, turn.turnId, { order: 'asc' });
  for await (const event of page) {
    listed.push(event);
  }

  const gathered = gatherEvents(turn.events);
  const remaining = new Map<string, PersistedTurnEvent[]>();
  for (const event of gathered) {
    const key = JSON.stringify(canonicalize(event));
    const bucket = remaining.get(key);
    if (bucket !== undefined) {
      bucket.push(event);
    } else {
      remaining.set(key, [event]);
    }
  }

  const missing: PersistedTurnEvent[] = [];
  for (const event of listed) {
    const bucket = remaining.get(JSON.stringify(canonicalize(event)));
    if (bucket !== undefined && bucket.length > 0) {
      bucket.pop();
    } else {
      missing.push(event);
    }
  }

  const streamOnly = [...remaining.values()].flat();
  if (missing.length > 0 || streamOnly.length > 0) {
    throw new InvariantError(
      `gathered stream events do not reconcile with listTurnEvents (createdAt ignored).\n` +
        `gathered=${String(gathered.length)} (${gathered.map(e => e.type).join(', ')})\n` +
        `listed=${String(listed.length)} (${listed.map(e => e.type).join(', ')})\n` +
        `persisted but never streamed:\n${missing.map(e => JSON.stringify(canonicalize(e))).join('\n') || '(none)'}\n` +
        `streamed but never persisted:\n${streamOnly.map(e => JSON.stringify(canonicalize(e))).join('\n') || '(none)'}`,
    );
  }
}

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvariantError(message);
  }
}

type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type ExpectedRequiredAction = DeepPartial<ActionRequiredEvent>;

export interface TurnInvariantOptions {
  label?: string;
  previousTurnId?: string | null;
  expectSandbox?: boolean;
  expectRequiredAction?: ExpectedRequiredAction;
  allowMultipleThreads?: boolean;
}

function partialMatch({ actual, expected }: { actual: unknown; expected: unknown }): boolean {
  if (actual === expected) {
    return true;
  }
  if (typeof expected !== 'object' || expected === null) {
    return false;
  }
  if (typeof actual !== 'object' || actual === null) {
    return false;
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((item, i) => partialMatch({ actual: actual[i], expected: item }));
  }
  if (!isPlainObject(actual) || !isPlainObject(expected)) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) => partialMatch({ actual: actual[key], expected: value }));
}

export function assertTurnInvariants(turn: CollectedTurn, opts: TurnInvariantOptions = {}): void {
  const at = opts.label !== undefined ? `[${opts.label}] ` : '';
  const { events } = turn;

  invariant(events.length > 0, `${at}turn produced no events`);
  invariant(
    events[0]?.type === 'turn.created',
    `${at}first event must be turn.created, got ${String(events[0]?.type)}`,
  );
  invariant(
    events[events.length - 1]?.type === 'turn.done',
    `${at}last event must be turn.done, got ${String(events[events.length - 1]?.type)}`,
  );
  invariant(turn.turnId, `${at}turn.created is missing a turn_id`);
  invariant(turn.terminal !== undefined, `${at}stream ended without a turn.done event`);

  if (opts.allowMultipleThreads !== true) {
    invariant(turn.threadIds.length <= 1, `${at}events span multiple thread_ids: ${turn.threadIds.join(', ')}`);
  }

  const createdIndex = new Map<string, number>();
  events.forEach((event, i) => {
    if (event.type === 'thread.created') {
      createdIndex.set(event.threadId, i);
    }
  });
  events.forEach((event, i) => {
    if (event.type === 'thread.done') {
      const opened = createdIndex.get(event.threadId);
      invariant(
        opened === undefined || opened < i,
        `${at}thread ${event.threadId} emitted thread.done before its thread.created within the turn`,
      );
    }
  });

  const state = turn.terminal.state;
  if (state.status === 'error') {
    throw new InvariantError(`${at}turn ended in error: ${state.message}`);
  }
  if (state.status === 'cancelled') {
    throw new InvariantError(`${at}turn was cancelled: ${state.reason}`);
  }

  if (opts.previousTurnId !== undefined) {
    invariant(
      turn.previousTurnId === opts.previousTurnId,
      `${at}expected previous_turn_id ${String(opts.previousTurnId)}, got ${String(turn.previousTurnId)}`,
    );
  }

  if (opts.expectSandbox === true) {
    invariant(turn.sandboxIds.length > 0, `${at}expected a sandbox.created event, none observed`);
  }

  if (turn.consolidatedText !== undefined && turn.accumulatedText.length > 0) {
    invariant(
      turn.consolidatedText === turn.accumulatedText,
      `${at}final assistant text does not match accumulated streamed deltas.\nfinal:       ${JSON.stringify(turn.consolidatedText)}\naccumulated: ${JSON.stringify(turn.accumulatedText)}`,
    );
  }

  const pending = requiredActions(turn);
  const want = opts.expectRequiredAction;
  if (want !== undefined) {
    invariant(
      pending.some(action => partialMatch({ actual: action, expected: want })),
      `${at}expected a pending required action matching ${JSON.stringify(want)}, got: ${pending.map(a => a.type).join(', ') || '(none)'}`,
    );
  } else {
    invariant(
      pending.length === 0,
      `${at}turn ended with ${String(pending.length)} unresolved required_action(s): ${pending.map(a => a.type).join(', ')}`,
    );
  }
}

export type TrackTurnOptions = Omit<TurnInvariantOptions, 'previousTurnId'>;

export class SessionTracker {
  readonly sessionId: string;
  private lastTurnId: string | null = null;
  private sandboxId: string | undefined;
  private readonly openThreadIds = new Set<string>();
  private readonly closedThreadIds = new Set<string>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(turn: CollectedTurn, opts: TrackTurnOptions = {}): string {
    assertTurnInvariants(turn, { ...opts, previousTurnId: this.lastTurnId });

    const at = opts.label !== undefined ? `[${opts.label}] ` : '';
    for (const sandboxId of turn.sandboxIds) {
      if (this.sandboxId === undefined) {
        this.sandboxId = sandboxId;
      } else {
        invariant(
          sandboxId === this.sandboxId,
          `${at}sandbox id changed across turns: expected ${this.sandboxId}, saw ${sandboxId} (persistence broken)`,
        );
      }
    }

    for (const event of turn.events) {
      if (event.type === 'thread.created') {
        invariant(
          !this.openThreadIds.has(event.threadId) && !this.closedThreadIds.has(event.threadId),
          `${at}thread ${event.threadId} was created more than once`,
        );
        this.openThreadIds.add(event.threadId);
      } else if (event.type === 'thread.done') {
        invariant(
          this.openThreadIds.has(event.threadId),
          `${at}thread.done for ${event.threadId} without a preceding open thread.created`,
        );
        if (event.state.status === 'error') {
          throw new InvariantError(`${at}thread ${event.threadId} ended in error: ${event.state.error}`);
        }
        this.openThreadIds.delete(event.threadId);
        this.closedThreadIds.add(event.threadId);
      }
    }

    invariant(turn.turnId, `${at}turn is missing a turn id after invariants`);
    this.lastTurnId = turn.turnId;
    return turn.turnId;
  }

  assertAllThreadsClosed(label?: string): void {
    const at = label !== undefined ? `[${label}] ` : '';
    const open = [...this.openThreadIds];
    invariant(open.length === 0, `${at}threads created but never completed (no thread.done): ${open.join(', ')}`);
  }
}

export interface TestCase {
  name: string;
  run: () => Promise<void>;
}

interface TestResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: unknown;
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export async function runTests({ tests, filter }: { tests: TestCase[]; filter?: string | undefined }): Promise<number> {
  const selected = filter !== undefined ? tests.filter(t => t.name.includes(filter)) : tests;

  if (selected.length === 0) {
    console.error(
      filter !== undefined
        ? `${RED}No tests match filter "${filter}"${RESET} — check for a typo or stale name (nothing was run).`
        : `${RED}No tests registered${RESET} (nothing was run).`,
    );
    return 1;
  }

  console.log(`Running ${String(selected.length)} E2E test(s)...\n`);

  const results: TestResult[] = [];
  for (const test of selected) {
    const start = Date.now();
    try {
      await test.run();
      const ms = Date.now() - start;
      results.push({ name: test.name, ok: true, ms });
      console.log(`${GREEN}PASS${RESET} ${test.name} ${DIM}(${String(ms)}ms)${RESET}`);
    } catch (error) {
      const ms = Date.now() - start;
      results.push({ name: test.name, ok: false, ms, error });
      console.log(`${RED}FAIL${RESET} ${test.name} ${DIM}(${String(ms)}ms)${RESET}`);
      console.log(`${DIM}${errorMessage(error)}${RESET}\n`);
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${'-'.repeat(48)}`);
  console.log(`${String(passed)} passed, ${String(failed)} failed, ${String(results.length)} total`);
  if (failed > 0) {
    console.log(
      `${RED}Failed:${RESET} ${results
        .filter(r => !r.ok)
        .map(r => r.name)
        .join(', ')}`,
    );
  }

  return failed > 0 ? 1 : 0;
}

function parseModelFqn(name: string): { providerType: string; modelName: string } {
  const slash = name.indexOf('/');
  if (slash <= 0 || slash === name.length - 1 || name.includes('/', slash + 1)) {
    throw new Error(`MODEL must be a fully qualified "provider/model", got: ${name}`);
  }
  return { providerType: name.slice(0, slash), modelName: name.slice(slash + 1) };
}

function isWellKnownProviderType(value: string): value is TrueForgeApi.CatalogWellKnownModelProviderType {
  return WELL_KNOWN_PROVIDER_TYPES.some(type => type === value);
}

function wellKnownProviderManifest({
  type,
  apiKey,
  modelName,
}: {
  type: TrueForgeApi.CatalogWellKnownModelProviderType;
  apiKey: string;
  modelName: string;
}): TrueForgeApi.ModelProviderManifest {
  const auth = { apiKey };
  const models = [{ modelId: modelName, name: modelName, properties: {} }];
  switch (type) {
    case 'openai':
      return { type: 'openai', auth, models };
    case 'anthropic':
      return { type: 'anthropic', auth, models };
    case 'google-gemini':
      return { type: 'google-gemini', auth, models };
    case 'fireworks':
      return { type: 'fireworks', auth, models };
    case 'zai':
      return { type: 'zai', auth, models };
    case 'moonshot':
      return { type: 'moonshot', auth, models };
    case 'alibaba':
      return { type: 'alibaba', auth, models };
    case 'together':
      return { type: 'together', auth, models };
  }
}

async function upsertNamedAgent({ client, spec }: { client: TrueForge; spec: TrueForgeApi.AgentSpec }): Promise<void> {
  const listed = await client.agents.list();
  const existing = listed.data.find(agent => agent.name === NAMED_AGENT);
  if (existing !== undefined) {
    await client.agents.update(existing.id, { manifest: spec });
    return;
  }
  try {
    await client.agents.create({ name: NAMED_AGENT, manifest: spec });
  } catch (error) {
    if (!(error instanceof TrueForgeApi.ConflictError)) {
      throw error;
    }
    const retry = await client.agents.list();
    const created = retry.data.find(agent => agent.name === NAMED_AGENT);
    if (created === undefined) {
      throw error;
    }
    await client.agents.update(created.id, { manifest: spec });
  }
}

/** Idempotent settings + named agent used by later cases. */
export async function upsertE2eResources(client: TrueForge): Promise<void> {
  const fqn = requireEnv('MODEL');
  const { providerType, modelName } = parseModelFqn(fqn);
  if (!isWellKnownProviderType(providerType)) {
    throw new Error(
      `MODEL provider "${providerType}" is not a well-known type (${WELL_KNOWN_PROVIDER_TYPES.join(', ')})`,
    );
  }

  await client.settings.modelProviders.createOrUpdate({
    manifest: wellKnownProviderManifest({
      type: providerType,
      apiKey: requireEnv('MODEL_API_KEY'),
      modelName,
    }),
  });

  await client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: 'remote',
      name: MCP_DEEPWIKI,
      url: 'https://mcp.deepwiki.com/mcp',
      description: 'Read documentation and ask questions about any public GitHub repository.',
    },
  });
  await client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: 'remote',
      name: MCP_LINEAR,
      url: 'https://mcp.linear.app/mcp',
      description: 'Search, read, and create Linear issues.',
      auth: { type: 'dcr' },
    },
  });

  await client.settings.sandboxProviders.createOrUpdate({
    manifest: {
      type: 'daytona',
      auth: { apiKey: requireEnv('DAYTONA_API_KEY') },
      execTimeoutMs: 60_000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 43_200,
    },
  });

  await upsertNamedAgent({
    client,
    spec: baseAgentSpec({
      instructions: 'You are a terse assistant. Follow instructions exactly and keep replies short.',
    }),
  });
}
