# Reference
## Agents
<details><summary><code>client.agents.<a href="/src/api/resources/agents/client/Client.ts">list</a>() -> TrueForge.ListAgentsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All configured agents for the tenant.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.agents.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="/src/api/resources/agents/client/Client.ts">create</a>({ ...params }) -> TrueForge.GetAgentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates an agent and allocates an immutable id. Fails if `name` is already taken. Name cannot be changed later.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.agents.create({
    manifest: {
        model: {
            name: "name"
        }
    },
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.CreateAgentRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="/src/api/resources/agents/client/Client.ts">get</a>(agent_id) -> TrueForge.GetAgentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a configured agent by immutable id.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.agents.get("agent_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — Immutable agent identifier.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="/src/api/resources/agents/client/Client.ts">update</a>(agent_id, { ...params }) -> TrueForge.GetAgentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Replaces the manifest for an existing agent keyed by immutable `agent_id`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.agents.update("agent_id", {
    manifest: {
        model: {
            name: "name"
        }
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — Immutable agent identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.UpdateAgentRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="/src/api/resources/agents/client/Client.ts">delete</a>(agent_id) -> TrueForge.DeleteAgentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a configured agent by immutable id. Idempotent if already gone.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.agents.delete("agent_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — Immutable agent identifier.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Auth
<details><summary><code>client.auth.<a href="/src/api/resources/auth/client/Client.ts">me</a>() -> TrueForge.GetMeResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the authenticated caller identity. When auth is enabled this requires a valid `id_token` cookie or `Authorization: Bearer` ID token (401 otherwise). When auth is disabled, returns the default identity.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.auth.me();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `AuthClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Server
<details><summary><code>client.server.<a href="/src/api/resources/server/client/Client.ts">getCapabilities</a>() -> TrueForge.GetCapabilitiesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Report optional runtime capabilities available for this tenant.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.server.getCapabilities();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ServerClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## MCP Servers
<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">list</a>() -> TrueForge.ListAvailableMcpServersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

MCP servers as a slim name/url list for the composer. No auth or auth_status.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.mcpServers.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">authorize</a>(name, { ...params }) -> TrueForge.McpAuthStatus</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

For servers without auth returns not_required, and for header credentials returns authenticated (no browser flow). For auth.type dcr, returns authenticated when a usable (or refreshable) token exists; otherwise runs DCR if needed and returns auth_required with an authorization URL. Optional return_to is where the OAuth callback then redirects the browser; without it the callback returns JSON.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.mcpServers.authorize("name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**name:** `string` — MCP server name.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.AuthorizeMcpServersRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">deleteAuthorization</a>(name) -> TrueForge.GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

For auth.type dcr, deletes the stored OAuth token and returns the server with auth_status auth_required, keeping the dynamically registered OAuth client so the next authorize can reuse it. No-op for header or no-auth servers (returns the server unchanged).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.mcpServers.deleteAuthorization("name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**name:** `string` — MCP server name.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">listTools</a>(name) -> TrueForge.ListMcpServerToolsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All tools exposed by the given MCP server (non-paginated), as returned by the MCP `tools/list` call.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.mcpServers.listTools("name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**name:** `string` — MCP server name.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Models
<details><summary><code>client.models.<a href="/src/api/resources/models/client/Client.ts">list</a>() -> TrueForge.ListAvailableModelsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Configured models as a slim FQN list for the composer.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.models.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ModelsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Sessions
<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">list</a>({ ...params }) -> core.Page&lt;TrueForge.Session, TrueForge.ListSessionsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List the caller's sessions (newest first by default), token-paginated. Results are scoped to the authenticated identity via the session store's `created_by` filter (not a client query param). Optional `agent_id` filters to sessions bound to that named agent. Pass `page_token` to fetch the next page, keeping the other query params constant.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.ListSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">create</a>({ ...params }) -> TrueForge.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a session with `agent` as either `{ name }` (named registry binding) or `{ spec: AgentSpec }` (inline). Named sessions snapshot the agent name at create and resolve the live agent on each turn. Responses use `{ type: "reference", name, id }` or `{ type: "inline", spec }`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.create({
    agent: {
        name: "name"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.CreateSessionRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">get</a>(session_id) -> TrueForge.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a session by ID. Only the session creator (`created_by`) may fetch it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.get("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">delete</a>(session_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a session and all related turns, events, and internal state. Only the session creator (`created_by`) may delete it. Idempotent if already gone.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.delete("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">update</a>(session_id, { ...params }) -> TrueForge.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a session by replacing `agent` with `{ spec: AgentSpec }`. Named (reference) sessions reject agent updates. An empty body is a valid no-op that refreshes `updated_at`. Only the session creator (`created_by`) may update it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.update("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.UpdateSessionRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">cancel</a>(session_id, { ...params }) -> TrueForge.CancelSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Cancel the running last turn for a session. Only the session creator (`created_by`) may cancel.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.cancel("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.CancelSessionRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listEvents</a>(session_id, { ...params }) -> core.Page&lt;TrueForge.SessionEventItem, TrueForge.ListSessionEventsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List session events as `{ turn_id, event }` across the active turn branch (newest first), including persisted events from a running tip. Each turn contributes turn.created, content events (model.message, tool.call, …), and turn.done when terminal; streaming deltas are not included. Use `page_token` to paginate backward toward older events while retaining the original branch anchor. Only the session creator (`created_by`) may list events.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.listEvents("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.ListEventsSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listTurns</a>(session_id, { ...params }) -> core.Page&lt;TrueForge.Turn, TrueForge.ListTurnsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List turns for a session (newest first by default), token-paginated. Only the session creator (`created_by`) may list turns.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.listTurns("session_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.ListTurnsSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">createTurnStream</a>(session_id, { ...params }) -> core.Stream&lt;TrueForge.TurnStreamingEvent&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a turn within a session and execute it.
Only the session creator (`created_by`) may create turns.
When `stream` is true (default), respond with a Server-Sent Events stream of turn events.
When `stream` is false, return the turn immediately with `state.status: "running"` while execution continues in the background; use get turn or subscribe to observe completion.
Use `previous_turn_id` to chain to the session's last turn (defaults to `auto`); use `none` for a new root.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
const response = await client.sessions.createTurnStream("session_id", {});
for await (const item of response) {
    console.log(item);
}

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.CreateTurnSessionsStreamRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">createTurn</a>(session_id, { ...params }) -> TrueForge.GetTurnResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a turn within a session and execute it.
Only the session creator (`created_by`) may create turns.
When `stream` is true (default), respond with a Server-Sent Events stream of turn events.
When `stream` is false, return the turn immediately with `state.status: "running"` while execution continues in the background; use get turn or subscribe to observe completion.
Use `previous_turn_id` to chain to the session's last turn (defaults to `auto`); use `none` for a new root.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.createTurn("session_id", {});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.CreateTurnSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">getTurn</a>(session_id, turn_id) -> TrueForge.GetTurnResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a single turn by ID. Only the session creator (`created_by`) may fetch it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.getTurn("session_id", "turn_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turn_id:** `string` — Turn identifier.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">downloadSandboxFile</a>(session_id, turn_id, { ...params }) -> core.BinaryResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Download a file from the sandbox this turn ran in. Paths come from the assistant's `sandbox_artifacts` block. Only the session creator (`created_by`) may download.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.downloadSandboxFile("session_id", "turn_id", {
    path: "x"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turn_id:** `string` — Turn identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.DownloadSandboxFileSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listTurnEvents</a>(session_id, turn_id, { ...params }) -> core.Page&lt;TrueForge.SessionEvent, TrueForge.ListTurnEventsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Paginated persisted events for a turn (insertion order by default). Only the session creator (`created_by`) may list events.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sessions.listTurnEvents("session_id", "turn_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turn_id:** `string` — Turn identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.ListTurnEventsSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">subscribeToTurn</a>(session_id, turn_id, { ...params }) -> core.Stream&lt;TrueForge.TurnStreamingEvent&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Subscribe to the live SSE stream for a turn. Only the session creator (`created_by`) may subscribe. Pass `after_sequence_number` to resume after a disconnect (exclusive — events after this sequence number are replayed).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
const response = await client.sessions.subscribeToTurn("session_id", "turn_id");
for await (const item of response) {
    console.log(item);
}

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**session_id:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turn_id:** `string` — Turn identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueForge.SubscribeToTurnSessionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SessionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Skills
<details><summary><code>client.skills.<a href="/src/api/resources/skills/client/Client.ts">list</a>() -> TrueForge.ListAvailableSkillsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Configured skills as a slim name/description list for the composer.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.skills.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SkillsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Catalogs McpServers
<details><summary><code>client.catalogs.mcpServers.<a href="/src/api/resources/catalogs/resources/mcpServers/client/Client.ts">list</a>() -> TrueForge.GetMcpServerCatalogResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Shipped MCP server presets (discovery-only). Copy into PUT /settings/mcp-servers to configure.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.catalogs.mcpServers.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Catalogs ModelProviders
<details><summary><code>client.catalogs.modelProviders.<a href="/src/api/resources/catalogs/resources/modelProviders/client/Client.ts">list</a>() -> TrueForge.GetModelProviderCatalogResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Shipped model-provider presets (discovery-only). Copy into PUT /settings/model-providers to configure. Includes a `custom` sentinel with `supported_reasoning_efforts`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.catalogs.modelProviders.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ModelProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Catalogs SandboxProviders
<details><summary><code>client.catalogs.sandboxProviders.<a href="/src/api/resources/catalogs/resources/sandboxProviders/client/Client.ts">list</a>() -> TrueForge.GetSandboxProviderCatalogResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Shipped sandbox-provider presets (discovery-only). Copy into PUT /settings/sandbox-providers to configure.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.catalogs.sandboxProviders.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SandboxProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Catalogs Skills
<details><summary><code>client.catalogs.skills.<a href="/src/api/resources/catalogs/resources/skills/client/Client.ts">list</a>() -> TrueForge.GetSkillCatalogResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Shipped skill presets (discovery-only). Copy into PUT /settings/skills to configure.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.catalogs.skills.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SkillsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Settings McpServers
<details><summary><code>client.settings.mcpServers.<a href="/src/api/resources/settings/resources/mcpServers/client/Client.ts">list</a>() -> TrueForge.ListMcpServersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All MCP servers with nested auth_status (settings / admin projection). Header auth values are redacted.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.mcpServers.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.mcpServers.<a href="/src/api/resources/settings/resources/mcpServers/client/Client.ts">create</a>({ ...params }) -> TrueForge.GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates an MCP server by `name`. Fails if `name` is already taken. Runs DCR registration when `auth.type` is `dcr`. Header secrets: real value required; redacted with no stored value returns 400.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.mcpServers.create({
    manifest: {
        description: "description",
        name: "name",
        type: "remote",
        url: "url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.CreateMcpServerRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.mcpServers.<a href="/src/api/resources/settings/resources/mcpServers/client/Client.ts">createOrUpdate</a>({ ...params }) -> TrueForge.GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create or replace by `name`. Does not start DCR or change oauth client columns. Header secrets: real value sets/rotates; redacted keeps existing (400 if none).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.mcpServers.createOrUpdate({
    manifest: {
        description: "description",
        name: "name",
        type: "remote",
        url: "url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.UpdateMcpServerRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.mcpServers.<a href="/src/api/resources/settings/resources/mcpServers/client/Client.ts">get</a>(name) -> TrueForge.GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

A single MCP server by name, with nested auth_status (settings / admin projection). Header auth values are redacted.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.mcpServers.get("name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**name:** `string` — MCP server name.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Settings ModelProviders
<details><summary><code>client.settings.modelProviders.<a href="/src/api/resources/settings/resources/modelProviders/client/Client.ts">list</a>() -> TrueForge.ListModelProvidersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All configured providers with nested manifests.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.modelProviders.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ModelProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.modelProviders.<a href="/src/api/resources/settings/resources/modelProviders/client/Client.ts">create</a>({ ...params }) -> TrueForge.GetModelProviderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a provider (models included). Fails if `name` is already taken. Well-known types use `type` as `name` (one each); `custom` is named by the caller. `auth.api_key`: real value required; redacted with no stored secret returns 400.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.modelProviders.create({
    manifest: {
        auth: {
            apiKey: "api_key"
        },
        models: [{
                modelId: "model_id",
                name: "name",
                properties: {}
            }],
        type: "alibaba"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.CreateModelProviderRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ModelProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.modelProviders.<a href="/src/api/resources/settings/resources/modelProviders/client/Client.ts">createOrUpdate</a>({ ...params }) -> TrueForge.GetModelProviderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create or replace a provider (models included). Well-known types use `type` as `name` (one each); `custom` is named by the caller. `auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.modelProviders.createOrUpdate({
    manifest: {
        auth: {
            apiKey: "api_key"
        },
        models: [{
                modelId: "model_id",
                name: "name",
                properties: {}
            }],
        type: "alibaba"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.UpdateModelProviderRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ModelProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Settings SandboxProviders
<details><summary><code>client.settings.sandboxProviders.<a href="/src/api/resources/settings/resources/sandboxProviders/client/Client.ts">get</a>() -> TrueForge.GetSandboxProviderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

The single configured sandbox provider for this tenant. `auth.api_key` is redacted.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.sandboxProviders.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SandboxProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.sandboxProviders.<a href="/src/api/resources/settings/resources/sandboxProviders/client/Client.ts">createOrUpdate</a>({ ...params }) -> TrueForge.GetSandboxProviderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Upserts the single sandbox provider for this tenant: creates it or replaces its entire configuration. `auth.api_key`: real value sets/rotates; redacted keeps existing (400 if none).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.sandboxProviders.createOrUpdate({
    manifest: {
        auth: {
            apiKey: "api_key"
        },
        autoArchiveIntervalInMinutes: 1,
        autoDeleteIntervalInMinutes: 1,
        autoStopIntervalInMinutes: 1,
        execTimeoutMs: 1,
        type: "daytona"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.UpdateSandboxProviderRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SandboxProvidersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Settings Skills
<details><summary><code>client.settings.skills.<a href="/src/api/resources/settings/resources/skills/client/Client.ts">list</a>() -> TrueForge.ListSkillsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All configured skills with nested manifests (settings / admin projection).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.skills.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SkillsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.skills.<a href="/src/api/resources/settings/resources/skills/client/Client.ts">create</a>({ ...params }) -> TrueForge.GetSkillResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a skill keyed by `name`. Fails if `name` is already taken.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.skills.create({
    manifest: {
        description: "description",
        name: "name",
        ref: "ref",
        type: "git",
        url: "url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.CreateSkillRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SkillsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.settings.skills.<a href="/src/api/resources/settings/resources/skills/client/Client.ts">createOrUpdate</a>({ ...params }) -> TrueForge.GetSkillResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Full upsert keyed by `name`: creates the skill or replaces its entire manifest.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.settings.skills.createOrUpdate({
    manifest: {
        description: "description",
        name: "name",
        ref: "ref",
        type: "git",
        url: "url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `TrueForge.settings.UpdateSkillRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SkillsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

