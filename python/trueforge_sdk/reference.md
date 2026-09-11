# Reference

## Internal

<details><summary><code>client.internal.<a href="src/trueforge_sdk/internal/client.py">list_permissions</a>(...) -> ListPermissionsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Return granted actions for each requested agent, schedule, or session id.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, PermissionResourceType

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.list_permissions(
    resource_ids=[
        "resource_ids"
    ],
    resource_type=PermissionResourceType.AGENT,
)

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

**resource_ids:** `typing.List[str]` — Resource ids of `resource_type` to evaluate for the caller.

</dd>
</dl>

<dl>
<dd>

**resource_type:** `PermissionResourceType`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Agents

<details><summary><code>client.agents.<a href="src/trueforge_sdk/agents/client.py">list</a>(...) -> ListAgentsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List configured agents for the tenant, ordered by name. Optional `agent_name` filters by substring.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.agents.list()

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

**limit:** `typing.Optional[int]` — Page size. Defaults to 50, max 100.

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque token from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**agent_name:** `typing.Optional[str]` — Case-insensitive substring match on agent name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="src/trueforge_sdk/agents/client.py">create</a>(...) -> GetAgentResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, AgentSpec, Model

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.agents.create(
    manifest=AgentSpec(
        model=Model(
            name="name",
        ),
    ),
    name="name",
)

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

**manifest:** `AgentSpec`

</dd>
</dl>

<dl>
<dd>

**name:** `ResourceName`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="src/trueforge_sdk/agents/client.py">get</a>(...) -> GetAgentResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.agents.get(
    agent_id="agent_id",
)

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

**agent_id:** `str` — Immutable agent identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="src/trueforge_sdk/agents/client.py">update</a>(...) -> GetAgentResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, AgentSpec, Model

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.agents.update(
    agent_id="agent_id",
    manifest=AgentSpec(
        model=Model(
            name="name",
        ),
    ),
)

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

**agent_id:** `str` — Immutable agent identifier.

</dd>
</dl>

<dl>
<dd>

**manifest:** `AgentSpec`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.agents.<a href="src/trueforge_sdk/agents/client.py">delete</a>(...) -> DeleteAgentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a configured agent by immutable id.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.agents.delete(
    agent_id="agent_id",
)

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

**agent_id:** `str` — Immutable agent identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Auth

<details><summary><code>client.auth.<a href="src/trueforge_sdk/auth/client.py">me</a>() -> GetMeResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the authenticated caller identity (`type`, `tenant_id`, `subject`, `roles`) wrapped as `{ data }`. `type` is `oidc-connected` when browser OIDC is enabled, otherwise `default`. When auth is enabled this requires a valid `id_token` cookie or `Authorization: Bearer` token (401 otherwise). When auth is disabled, returns the standalone default identity.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.auth.me()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Server

<details><summary><code>client.server.<a href="src/trueforge_sdk/server/client.py">get_capabilities</a>() -> GetCapabilitiesResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.server.get_capabilities()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## MCP Servers

<details><summary><code>client.mcp_servers.<a href="src/trueforge_sdk/mcp_servers/client.py">list</a>() -> ListAvailableMcpServersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Configured MCP servers as a slim name/url list for the composer.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.mcp_servers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.mcp_servers.<a href="src/trueforge_sdk/mcp_servers/client.py">get</a>(...) -> GetAvailableMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

A single MCP server as the slim chat projection, with live per-user auth_status.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.mcp_servers.get(
    name="name",
)

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

**name:** `str` — MCP server name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.mcp_servers.<a href="src/trueforge_sdk/mcp_servers/client.py">authorize</a>(...) -> McpAuthStatus</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns current auth status. When OAuth is required, includes an authorization URL. Optional return_to is the post-consent landing path.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.mcp_servers.authorize(
    name="name",
)

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

**name:** `str` — MCP server name.

</dd>
</dl>

<dl>
<dd>

**return_to:** `typing.Optional[str]` — Same-origin path to land in the browser after consent.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.mcp_servers.<a href="src/trueforge_sdk/mcp_servers/client.py">delete_authorization</a>(...) -> GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Disconnects OAuth for the MCP server when applicable and returns the updated server with auth_status. No-op when the server does not use stored OAuth tokens.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.mcp_servers.delete_authorization(
    name="name",
)

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

**name:** `str` — MCP server name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.mcp_servers.<a href="src/trueforge_sdk/mcp_servers/client.py">list_tools</a>(...) -> ListMcpServerToolsResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.mcp_servers.list_tools(
    name="name",
)

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

**name:** `str` — MCP server name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Models

<details><summary><code>client.models.<a href="src/trueforge_sdk/models/client.py">list</a>() -> ListAvailableModelsResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.models.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Schedules

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">list</a>(...) -> ListSchedulesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List schedules for the tenant, newest first.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.list()

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

**limit:** `typing.Optional[int]` — Page size. Defaults to 25

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque token from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**agent_names:** `typing.Optional[str]` — Filter by one or more agent names (comma-separated). When set, at least one name is required.

</dd>
</dl>

<dl>
<dd>

**created_by_me:** `typing.Optional[bool]` — When true, only schedules created by the authenticated subject.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">create</a>(...) -> GetScheduleResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a schedule for an existing agent (by name) and add its first pending run when active.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, ScheduleManifest

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.create(
    agent_name="agent_name",
    manifest=ScheduleManifest(
        cron="cron",
        task="task",
    ),
    name="name",
)

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

**agent_name:** `ResourceName`

</dd>
</dl>

<dl>
<dd>

**manifest:** `ScheduleManifest`

</dd>
</dl>

<dl>
<dd>

**name:** `ResourceName`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">create_run</a>(...) -> CreateScheduleRunResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Start a schedule run immediately using the schedule task. Does not replace or advance the cron pending run.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.create_run(
    schedule_id="schedule_id",
)

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

**schedule_id:** `str` — Immutable schedule identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">get</a>(...) -> GetScheduleResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a schedule by id.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.get(
    schedule_id="schedule_id",
)

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

**schedule_id:** `str` — Immutable schedule identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">update</a>(...) -> GetScheduleResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Replace name and manifest; replaces or drops the pending run when status/cron/timezone change.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, ScheduleManifest

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.update(
    schedule_id="schedule_id",
    manifest=ScheduleManifest(
        cron="cron",
        task="task",
    ),
    name="name",
)

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

**schedule_id:** `str` — Immutable schedule identifier.

</dd>
</dl>

<dl>
<dd>

**manifest:** `ScheduleManifest`

</dd>
</dl>

<dl>
<dd>

**name:** `ResourceName`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">delete</a>(...) -> DeleteScheduleResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a schedule and its runs. Idempotent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.delete(
    schedule_id="schedule_id",
)

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

**schedule_id:** `str` — Immutable schedule identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.schedules.<a href="src/trueforge_sdk/schedules/client.py">list_runs</a>(...) -> ListScheduleRunsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List runs of a schedule, newest `scheduled_for` first. Available to its creator or a manager of its agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.schedules.list_runs(
    schedule_id="schedule_id",
)

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

**schedule_id:** `str` — Immutable schedule identifier.

</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Page size. Defaults to 25

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque token from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Sessions

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">list</a>(...) -> ListSessionsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List the sessions (newest first by default).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.list()

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

**limit:** `typing.Optional[int]` — Page size. Defaults to 25, max 25.

</dd>
</dl>

<dl>
<dd>

**order:** `typing.Optional[ListSessionsOrder]` — Sort sessions by `updated_at`. Defaults to "desc".

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque keyset cursor from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**start_timestamp:** `typing.Optional[datetime.datetime]` — Inclusive lower bound on `created_at` (ISO-8601 / RFC 3339).

</dd>
</dl>

<dl>
<dd>

**end_timestamp:** `typing.Optional[datetime.datetime]` — Inclusive upper bound on `created_at` (ISO-8601 / RFC 3339).

</dd>
</dl>

<dl>
<dd>

**agent_id:** `typing.Optional[str]` — When set, only sessions bound to this agent id are returned.

</dd>
</dl>

<dl>
<dd>

**created_by_me:** `typing.Optional[bool]` — When true, only sessions created by the authenticated subject.

</dd>
</dl>

<dl>
<dd>

**metadata:** `typing.Optional[SessionMetadata]` — Exact metadata pairs as metadata[key]=value. Sessions must contain all pairs.

</dd>
</dl>

<dl>
<dd>

**source_type:** `typing.Optional[SessionSourceType]` — When set, returns only sessions created by this source type.

</dd>
</dl>

<dl>
<dd>

**source_id:** `typing.Optional[str]` — When set, returns only sessions from this specific source. Requires source_type.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">create</a>(...) -> GetSessionResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, SessionAgentNameRef

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.create(
    agent=SessionAgentNameRef(
        name="name",
    ),
)

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

**agent:** `CreateSessionAgent`

</dd>
</dl>

<dl>
<dd>

**metadata:** `typing.Optional[SessionMetadata]`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">get</a>(...) -> GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a session by ID. Only the session creator may fetch it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.get(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">delete</a>(...)</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a session and all related turns, events, and internal state. Only the session creator may delete it. Idempotent if already gone.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.delete(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">update</a>(...) -> GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a session by replacing `agent` with `{ spec: AgentSpec }`. Named (reference) sessions reject agent updates. An empty body is a valid no-op that refreshes `updated_at`. Only the session creator may update it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.update(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**agent:** `typing.Optional[SessionAgentSpecBody]`

</dd>
</dl>

<dl>
<dd>

**metadata:** `typing.Optional[SessionMetadata]`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">cancel</a>(...) -> CancelSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Cancel the running last turn for a session. Only the session creator may cancel.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.cancel(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">list_events</a>(...) -> ListSessionEventsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List session events as `{ turn_id, event }` across the active turn branch (newest first), including persisted events from a running tip. Each turn contributes turn.created, content events (model.message, tool.call, …), and turn.done when terminal; streaming deltas are not included. Use `page_token` to paginate backward toward older events while retaining the original branch anchor. Only the session creator may list events.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.list_events(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Pagination cursor from `pagination.next_page_token`. It retains the branch anchor turn and returns older events toward the session start.

</dd>
</dl>

<dl>
<dd>

**last_turn_id:** `typing.Optional[str]` — Newest turn in the listing window (initial load only; ignored when `page_token` is set). Lists that turn and its ancestors, newest events first. Omit to use the session last turn.

</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Page size. Defaults to 100, max 100.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">list_turns</a>(...) -> ListTurnsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List turns for a session (newest first by default), token-paginated. Only the session creator may list turns.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.list_turns(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Page size. Defaults to 25, max 25.

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque token from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">create_turn_stream</a>(...) -> typing.Iterator[bytes]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a turn within a session and execute it.
Only the session creator may create turns.
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.create_turn_stream(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**stream:** `typing.Literal` — When true (default), stream turn events as SSE. When false, return the running turn immediately.

</dd>
</dl>

<dl>
<dd>

**input:** `typing.Optional[typing.List[TurnInputItem]]` — Turn input items: user messages and/or approval/tool-response resumes. Do not mix user messages with approval or tool-response items.

</dd>
</dl>

<dl>
<dd>

**previous_turn_id:** `typing.Optional[PreviousTurnIdInput]`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">create_turn</a>(...) -> GetTurnResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a turn within a session and execute it.
Only the session creator may create turns.
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.create_turn_stream(
    session_id="session_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**stream:** `typing.Literal` — When true (default), stream turn events as SSE. When false, return the running turn immediately.

</dd>
</dl>

<dl>
<dd>

**input:** `typing.Optional[typing.List[TurnInputItem]]` — Turn input items: user messages and/or approval/tool-response resumes. Do not mix user messages with approval or tool-response items.

</dd>
</dl>

<dl>
<dd>

**previous_turn_id:** `typing.Optional[PreviousTurnIdInput]`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">get_turn</a>(...) -> GetTurnResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch a single turn by ID. Only the session creator may fetch it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.get_turn(
    session_id="session_id",
    turn_id="turn_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**turn_id:** `str` — Turn identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">download_sandbox_file</a>(...) -> typing.Iterator[bytes]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Download a file from the sandbox this turn ran in. Paths come from the assistant's `sandbox_artifacts` block. Only the session creator may download.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.download_sandbox_file(
    session_id="session_id",
    turn_id="turn_id",
    path="x",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**turn_id:** `str` — Turn identifier.

</dd>
</dl>

<dl>
<dd>

**path:** `str` — Absolute or sandbox-working-directory-relative file path, as listed in the assistant's `sandbox_artifacts` block.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">list_turn_events</a>(...) -> ListTurnEventsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Paginated persisted events for a turn (insertion order by default). Only the session creator may list events.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.list_turn_events(
    session_id="session_id",
    turn_id="turn_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**turn_id:** `str` — Turn identifier.

</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Page size. Defaults to 100, max 100.

</dd>
</dl>

<dl>
<dd>

**page_token:** `typing.Optional[str]` — Opaque token from a previous response `next_page_token`.

</dd>
</dl>

<dl>
<dd>

**order:** `typing.Optional[ListTurnEventsOrder]` — Sort events by insertion order. Defaults to "asc".

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.sessions.<a href="src/trueforge_sdk/sessions/client.py">subscribe_to_turn</a>(...) -> typing.Iterator[bytes]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Subscribe to the live SSE stream for a turn. Only the session creator may subscribe. Pass `after_sequence_number` to resume after a disconnect (exclusive — events after this sequence number are replayed).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.sessions.subscribe_to_turn(
    session_id="session_id",
    turn_id="turn_id",
)

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

**session_id:** `str` — Session identifier.

</dd>
</dl>

<dl>
<dd>

**turn_id:** `str` — Turn identifier.

</dd>
</dl>

<dl>
<dd>

**after_sequence_number:** `typing.Optional[int]` — Exclusive resume cursor: replay only events with a sequence number greater than this value. Omit to start from the beginning of the live buffer.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Skills

<details><summary><code>client.skills.<a href="src/trueforge_sdk/skills/client.py">list</a>() -> ListAvailableSkillsResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.skills.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.skills.<a href="src/trueforge_sdk/skills/client.py">list_versions</a>(...) -> ListSkillVersionsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Versions for one skill.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.skills.list_versions(
    name="name",
)

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

**name:** `str` — Skill name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Catalogs McpServers

<details><summary><code>client.catalogs.mcp_servers.<a href="src/trueforge_sdk/catalogs/mcp_servers/client.py">list</a>() -> GetMcpServerCatalogResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.catalogs.mcp_servers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Catalogs ModelProviders

<details><summary><code>client.catalogs.model_providers.<a href="src/trueforge_sdk/catalogs/model_providers/client.py">list</a>() -> GetModelProviderCatalogResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.catalogs.model_providers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Catalogs SandboxProviders

<details><summary><code>client.catalogs.sandbox_providers.<a href="src/trueforge_sdk/catalogs/sandbox_providers/client.py">list</a>() -> GetSandboxProviderCatalogResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.catalogs.sandbox_providers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Catalogs Skills

<details><summary><code>client.catalogs.skills.<a href="src/trueforge_sdk/catalogs/skills/client.py">list</a>() -> GetSkillCatalogResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.catalogs.skills.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Internal Metrics

<details><summary><code>client.internal.metrics.<a href="src/trueforge_sdk/internal/metrics/client.py">list_charts</a>() -> GetSessionMetricsChartResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List available session metric charts.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.metrics.list_charts()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.internal.metrics.<a href="src/trueforge_sdk/internal/metrics/client.py">get_chart_data</a>(...) -> GetSessionMetricsChartDataResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Return one chart for the caller's sessions on a named agent over an inclusive creation-time window. Uses hourly buckets for windows up to 24 hours and daily UTC buckets otherwise.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, SessionMetricsChartName
import datetime

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.metrics.get_chart_data(
    agent_id="agent_id",
    start_timestamp=datetime.datetime.fromisoformat("2024-01-15T09:30:00+00:00"),
    end_timestamp=datetime.datetime.fromisoformat("2024-01-15T09:30:00+00:00"),
    chart_name=SessionMetricsChartName.SESSIONS_OVER_TIME,
)

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

**agent_id:** `str` — Named agent identifier.

</dd>
</dl>

<dl>
<dd>

**start_timestamp:** `datetime.datetime` — Inclusive lower bound on session `created_at`.

</dd>
</dl>

<dl>
<dd>

**end_timestamp:** `datetime.datetime` — Inclusive upper bound on session `created_at`.

</dd>
</dl>

<dl>
<dd>

**chart_name:** `SessionMetricsChartName` — Session metrics chart to return.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.internal.metrics.<a href="src/trueforge_sdk/internal/metrics/client.py">get_meters</a>(...) -> GetSessionMetricsMeterResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Aggregate the caller's session meters for a named agent over an inclusive creation-time window.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge
import datetime

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.metrics.get_meters(
    agent_id="agent_id",
    start_timestamp=datetime.datetime.fromisoformat("2024-01-15T09:30:00+00:00"),
    end_timestamp=datetime.datetime.fromisoformat("2024-01-15T09:30:00+00:00"),
)

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

**agent_id:** `str` — Named agent identifier.

</dd>
</dl>

<dl>
<dd>

**start_timestamp:** `datetime.datetime` — Inclusive lower bound on session `created_at`.

</dd>
</dl>

<dl>
<dd>

**end_timestamp:** `datetime.datetime` — Inclusive upper bound on session `created_at`.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Internal Schedules

<details><summary><code>client.internal.schedules.<a href="src/trueforge_sdk/internal/schedules/client.py">execute_run</a>(...)</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Execute a persisted schedule run using its saved schedule and agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.schedules.execute_run(
    schedule_run_id="schedule_run_id",
)

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

**schedule_run_id:** `str` — Immutable schedule run identifier.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Internal Sessions

<details><summary><code>client.internal.sessions.<a href="src/trueforge_sdk/internal/sessions/client.py">get_or_create_by_external_id</a>(...) -> GetSessionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Idempotent get-or-create: returns the existing session for this `external_id`, or creates one
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, SessionAgentNameRef

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.sessions.get_or_create_by_external_id(
    agent=SessionAgentNameRef(
        name="name",
    ),
    external_id="external_id",
)

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

**agent:** `CreateSessionAgent`

</dd>
</dl>

<dl>
<dd>

**external_id:** `str` — Caller-supplied id unique within the tenant.

</dd>
</dl>

<dl>
<dd>

**source:** `typing.Optional[SessionSourceSchedule]`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Internal Agents

<details><summary><code>client.internal.agents.<a href="src/trueforge_sdk/internal/agents/client.py">get_code_snippets</a>(...) -> GetAgentCodeSnippetsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

TypeScript TrueForge SDK samples (stream and non-stream) for creating a session and turn against this agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.internal.agents.get_code_snippets(
    agent_id="agent_id",
)

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

**agent_id:** `str` — Immutable agent identifier.

</dd>
</dl>

<dl>
<dd>

**base_url:** `typing.Optional[str]` — Public SDK base URL from the browser. When omitted, derived from the request origin and PUBLIC_BASE_URL.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Settings McpServers

<details><summary><code>client.settings.mcp_servers.<a href="src/trueforge_sdk/settings/mcp_servers/client.py">list</a>() -> ListMcpServersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Configured MCP servers with auth_status. Header secrets are redacted.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.mcp_servers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.mcp_servers.<a href="src/trueforge_sdk/settings/mcp_servers/client.py">create</a>(...) -> GetMcpServerResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, McpServerManifest, McpServerType

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.mcp_servers.create(
    manifest=McpServerManifest(
        description="description",
        name="name",
        type=McpServerType.REMOTE,
        url="url",
    ),
)

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

**manifest:** `McpServerManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.mcp_servers.<a href="src/trueforge_sdk/settings/mcp_servers/client.py">create_or_update</a>(...) -> GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create or replace by `name`. Header secrets: real value sets/rotates; redacted keeps existing (400 if none).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge, McpServerManifest, McpServerType

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.mcp_servers.create_or_update(
    manifest=McpServerManifest(
        description="description",
        name="name",
        type=McpServerType.REMOTE,
        url="url",
    ),
)

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

**manifest:** `McpServerManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.mcp_servers.<a href="src/trueforge_sdk/settings/mcp_servers/client.py">get</a>(...) -> GetMcpServerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

A single MCP server by name, with nested live auth_status (settings / admin projection). Header auth values are redacted.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.mcp_servers.get(
    name="name",
)

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

**name:** `str` — MCP server name.

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Settings ModelProviders

<details><summary><code>client.settings.model_providers.<a href="src/trueforge_sdk/settings/model_providers/client.py">list</a>() -> ListModelProvidersResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.model_providers.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.model_providers.<a href="src/trueforge_sdk/settings/model_providers/client.py">create</a>(...) -> GetModelProviderResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, AlibabaModelProvider, ModelProviderAuth, ConfiguredModel, ModelProperties

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.model_providers.create(
    manifest=AlibabaModelProvider(
        auth=ModelProviderAuth(
            api_key="api_key",
        ),
        models=[
            ConfiguredModel(
                model_id="model_id",
                name="name",
                properties=ModelProperties(),
            )
        ],
        type="alibaba",
    ),
)

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

**manifest:** `ModelProviderManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.model_providers.<a href="src/trueforge_sdk/settings/model_providers/client.py">create_or_update</a>(...) -> GetModelProviderResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, AlibabaModelProvider, ModelProviderAuth, ConfiguredModel, ModelProperties

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.model_providers.create_or_update(
    manifest=AlibabaModelProvider(
        auth=ModelProviderAuth(
            api_key="api_key",
        ),
        models=[
            ConfiguredModel(
                model_id="model_id",
                name="name",
                properties=ModelProperties(),
            )
        ],
        type="alibaba",
    ),
)

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

**manifest:** `ModelProviderManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Settings SandboxProviders

<details><summary><code>client.settings.sandbox_providers.<a href="src/trueforge_sdk/settings/sandbox_providers/client.py">get</a>() -> GetSandboxProviderResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.sandbox_providers.get()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.sandbox_providers.<a href="src/trueforge_sdk/settings/sandbox_providers/client.py">create_or_update</a>(...) -> GetSandboxProviderResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, SandboxProviderManifest, DaytonaSandboxProviderAuth

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.sandbox_providers.create_or_update(
    manifest=SandboxProviderManifest(
        auth=DaytonaSandboxProviderAuth(
            api_key="api_key",
        ),
        auto_archive_interval_in_minutes=1,
        auto_delete_interval_in_minutes=1,
        auto_stop_interval_in_minutes=1,
        exec_timeout_ms=1,
        type="daytona",
    ),
)

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

**manifest:** `SandboxProviderManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

## Settings Skills

<details><summary><code>client.settings.skills.<a href="src/trueforge_sdk/settings/skills/client.py">list</a>() -> ListSkillsResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.skills.list()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.skills.<a href="src/trueforge_sdk/settings/skills/client.py">create</a>(...) -> GetSkillResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, GitSkill

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.skills.create(
    manifest=GitSkill(
        description="description",
        name="name",
        ref="ref",
        type="git",
        url="url",
    ),
)

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

**manifest:** `SkillManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>

<details><summary><code>client.settings.skills.<a href="src/trueforge_sdk/settings/skills/client.py">create_or_update</a>(...) -> GetSkillResponse</code></summary>
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

```python
from trueforge_sdk import TrueForge, GitSkill

client = TrueForge(
    token="<token>",
    base_url="https://yourhost.com/path/to/api",
)

client.settings.skills.create_or_update(
    manifest=GitSkill(
        description="description",
        name="name",
        ref="ref",
        type="git",
        url="url",
    ),
)

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

**manifest:** `SkillManifest`

</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.

</dd>
</dl>
</dd>
</dl>

</dd>
</dl>
</details>
