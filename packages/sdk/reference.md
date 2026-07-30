# Reference
## Server
<details><summary><code>client.server.<a href="/src/api/resources/server/client/Client.ts">getCapabilities</a>() -> TrueHarness.GetCapabilitiesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Report optional runtime capabilities available in this server deployment.
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

## McpServers
<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">list</a>() -> TrueHarness.ListMcpServersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

MCP servers declared in mcp.yaml. Auth headers are configured via env vars and never returned.
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

<details><summary><code>client.mcpServers.<a href="/src/api/resources/mcpServers/client/Client.ts">listTools</a>(name) -> TrueHarness.ListMcpToolsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

All tools exposed by the given MCP server (non-paginated), as returned by the MCP `tools/list` call. No agent-spec tool selectors are applied — this is the raw server catalog.
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

**name:** `string` — MCP server name from mcp.yaml.
    
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
<details><summary><code>client.models.<a href="/src/api/resources/models/client/Client.ts">list</a>() -> TrueHarness.ListModelsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Models declared in models.yaml, reachable through the OpenAI-compatible API at the file's base_url.
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
<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">list</a>({ ...params }) -> core.Page&lt;TrueHarness.Session, TrueHarness.ListSessionsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List sessions (newest first by default), token-paginated. Pass `page_token` to fetch the next page, keeping the other query params constant.
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

**request:** `TrueHarness.ListSessionsRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">create</a>({ ...params }) -> TrueHarness.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a session holding an inline agent spec. Turns are executed against this spec.
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
    agentSpec: {
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

**request:** `TrueHarness.CreateSessionRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">get</a>(sessionId) -> TrueHarness.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a session by ID.
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
await client.sessions.get("sessionId");

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

**sessionId:** `string` — Session identifier.
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">update</a>(sessionId, { ...params }) -> TrueHarness.GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a session's inline agent spec. An empty body is a valid no-op that refreshes `updated_at`.
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
await client.sessions.update("sessionId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.UpdateSessionRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">cancel</a>(sessionId, { ...params }) -> TrueHarness.CancelSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Cancel the running last turn for a session.
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
await client.sessions.cancel("sessionId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.CancelSessionRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listEvents</a>(sessionId, { ...params }) -> core.Page&lt;TrueHarness.SessionEventItem, TrueHarness.ListSessionEventsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List session events as `{ turn_id, event }` across the active turn branch (newest first), including persisted events from a running tip. Each turn contributes turn.created, content events (model.message, tool.call, …), and turn.done when terminal; streaming deltas are not included. Use `page_token` to paginate backward toward older events while retaining the original branch anchor.
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
await client.sessions.listEvents("sessionId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.ListEventsSessionsRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listTurns</a>(sessionId, { ...params }) -> core.Page&lt;TrueHarness.Turn, TrueHarness.ListTurnsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List turns for a session (newest first by default), token-paginated.
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
await client.sessions.listTurns("sessionId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.ListTurnsSessionsRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">createTurn</a>(sessionId, { ...params }) -> core.Stream&lt;TrueHarness.TurnStreamingEvent&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a turn within a session and stream its execution as Server-Sent Events.
Use `previous_turn_id` to chain to the session's last turn (defaults to `auto`).
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
const response = await client.sessions.createTurn("sessionId");
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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.CreateTurnRequest` 
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">getTurn</a>(sessionId, turnId) -> TrueHarness.GetTurnResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a single turn by ID.
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
await client.sessions.getTurn("sessionId", "turnId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turnId:** `string` — Turn identifier.
    
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

<details><summary><code>client.sessions.<a href="/src/api/resources/sessions/client/Client.ts">listTurnEvents</a>(sessionId, turnId, { ...params }) -> core.Page&lt;TrueHarness.SessionEvent, TrueHarness.ListTurnEventsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Paginated persisted events for a turn (insertion order by default).
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
await client.sessions.listTurnEvents("sessionId", "turnId");

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

**sessionId:** `string` — Session identifier.
    
</dd>
</dl>

<dl>
<dd>

**turnId:** `string` — Turn identifier.
    
</dd>
</dl>

<dl>
<dd>

**request:** `TrueHarness.ListTurnEventsSessionsRequest` 
    
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
<details><summary><code>client.skills.<a href="/src/api/resources/skills/client/Client.ts">list</a>() -> TrueHarness.ListSkillsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Agent skills declared in skills.yaml.
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

