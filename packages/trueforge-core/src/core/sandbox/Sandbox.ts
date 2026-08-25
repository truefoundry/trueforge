import { context, propagation } from '@opentelemetry/api';
import dedent from 'dedent';
import type { Logger } from 'winston';
import { z } from 'zod';
import { InstructionBuilder } from '../InstructionBuilder';
import { estimateTokensForString } from '../llm/usage';
import type { MappedMCPTool } from '../mcp/convertMCPServers';
import { toolResultResponse, type CallToolResponse, type IToolSet } from '../mcp/IMCPServer';
import { defineTool, LocalToolMCP } from '../mcp/LocalToolMCP';
import {
  DEFERRED_TOOLS_SERVER_ID,
  GET_TOOL_INFO_NAME,
  GET_TOOL_OUTPUT_SCHEMA_NAME,
  LIST_TOOLS_NAME,
} from '../runtime/DeferredTool';
import type { AgentTracing } from '../tracing/AgentTracing';
import { extractErrorLogFields } from '../util/errorLogFields';
import { CodeModeDispatcher } from './codeMode/CodeModeDispatcher';
import { type CodeModeClientInstall, type CodeModeTransport } from './codeMode/CodeModeTransport';
import { ensureExecSuccess, shellEscape, type SandboxProvider } from './provider/Provider';
import { SandboxNotAvailableError, validateNoPathTraversal } from './SandboxErrors';
import { formatSandboxId, rawSandboxId } from './sandboxRef';
// Import submodules, not the ./skills barrel, to avoid a cycle (the mounters import from Sandbox).
import { dirname, join, relative } from 'node:path';
import type { ISkillMounter } from './skills/ISkillMounter';

/** Layout derived from install remotePath (always `…/mcp_client.py`). */
function mcpClientLayout(remotePath: string): { pythonPath: string; binDir: string; binLink: string } {
  const pythonPath = dirname(remotePath);
  const binDir = join(pythonPath, 'bin');
  return { pythonPath, binDir, binLink: join(binDir, 'mcp-client') };
}

export interface SandboxInfo {
  sandbox_id: string;
}

// Downloader/setup scripts can run longer than a normal exec.
export const SKILL_DOWNLOAD_TIMEOUT_SECONDS = 180;

// Keeps the sandbox-side NATS wait longer than the host's own MCP deadline, so the host
// surfaces the real MCP error instead of the bridge client giving up first.
const NATS_REQUEST_TIMEOUT_BUFFER_SECONDS = 30;

// Write a script (base64-encoded, never interpolated raw) to a path and run it. Skill mounters reuse it.
export function buildWriteAndRunScriptCommand(params: { scriptPath: string; scriptContent: string }): string {
  const b64 = Buffer.from(params.scriptContent, 'utf-8').toString('base64');
  const scriptPath = shellEscape(params.scriptPath);
  return [
    `mkdir -p "$(dirname ${scriptPath})"`,
    `rm -f ${scriptPath}`,
    `echo ${shellEscape(b64)} | base64 -d > ${scriptPath}`,
    `chmod a-w ${scriptPath}`,
    `python3 ${scriptPath}`,
  ].join(' && ');
}

/** Write or clear the git credential-store file at an absolute path (no global git config mutation). */
function buildSyncGitCredentialsCommand(credentialsContent: string | null, credentialsPath: string): string {
  const path = shellEscape(credentialsPath);
  if (credentialsContent === null) {
    return `rm -f ${path}`;
  }
  // Base64 avoids interpolating credentials directly into the shell command.
  const b64 = Buffer.from(credentialsContent, 'utf-8').toString('base64');
  return `mkdir -p "$(dirname ${path})" && ` + `echo '${b64}' | base64 -d > ${path} && ` + `chmod 600 ${path}`;
}

/**
 * Process-scoped credential.helper via GIT_CONFIG_* (avoids shared ~/.gitconfig).
 * Path is whatever the provider returns; providers with a shared FS (TFY) make
 * `store --file` absolute in their own `exec`.
 */
function buildGitCredentialHelperEnv(credentialsPath: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: `store --file ${credentialsPath}`,
  };
}

export interface SandboxStoredFile {
  filePath: string;
  sandboxCreated?: SandboxInfo | undefined;
}

export interface SandboxOptions {
  provider: SandboxProvider;
  existingSandboxId?: string | undefined;
  skillMounter?: ISkillMounter | undefined;
  fileDownloadEnabled?: boolean | undefined;
  /** Pre-resolved credential-store file content (null = clear / no git auth). */
  resolvedGitCredentialsContent?: string | null | undefined;
  /**
   * Blocks destructive tools in code mode so they go through the approval flow
   * instead. Must be `true` — approvals are always enabled (the kill switch is gone).
   */
  blockDestructiveToolsInCodeMode: true;
  /** Used to derive the Code Mode NATS wait as request + connect. */
  mcpRequestTimeoutMs: number;
  mcpConnectTimeoutMs: number;
  tracing: AgentTracing;
  logger: Logger;
}

export const SANDBOX_EXEC_TOOL_NAME = 'exec';
const SANDBOX_MCP_REMINDER_TAG = 'sandbox-mcp-code-mode';
const SANDBOX_FILE_OUTPUT_TAG = 'sandbox-file-output';
export const SANDBOX_SCHEMA_INFER_TAG = 'sandbox-schema-infer';
const SANDBOX_FILE_UPLOADS_TAG = 'sandbox-file-uploads';

// Per-server config sent to mcp_client.py via TFY_MCP_SERVERS.
interface SandboxMcpServerConfig {
  allowed_tools: string[];
}

// Snapshots the active W3C trace context (`traceparent` + optional `tracestate`) into env
// vars consumed by mcp_client.py. Read with TFY_TRACEPARENT / TFY_TRACESTATE on the sandbox
// side and attached as NATS message headers; the bridge extracts them on each message so the
// resulting MCP spans nest under the originating Sandbox: exec span.
function injectTraceContextEnv(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const env: Record<string, string> = {};
  if (carrier['traceparent']) {
    env['TFY_TRACEPARENT'] = carrier['traceparent'];
  }
  if (carrier['tracestate']) {
    env['TFY_TRACESTATE'] = carrier['tracestate'];
  }
  return env;
}

/**
 * Injects environment variables required for mcp_client.py into sandbox_exec arguments.
 * Transport-specific vars (NATS URL/prefix/timeout) come from `codeModeEnv` via transport.start().
 * PYTHONPATH comes from transport.getClientInstall remotePath. PATH is provider-owned:
 * Sandbox never writes PATH (Daytona uses the image PATH; TFY/local set it in exec).
 */
function injectMCPClientEnv(params: {
  env?: Record<string, string> | undefined;
  mcpServers: Record<string, SandboxMcpServerConfig>;
  codeModeEnv?: Record<string, string> | undefined;
  mcpClientInstall?: CodeModeClientInstall | undefined;
}): Record<string, string> {
  const codeModeEnv = params.codeModeEnv ?? {};
  const hasCodeModeTransport = Object.keys(codeModeEnv).length > 0;
  const install = params.mcpClientInstall;
  const layout = install === undefined ? undefined : mcpClientLayout(install.remotePath);
  return {
    ...(params.env ?? {}),
    ...(layout !== undefined && {
      PYTHONPATH: layout.pythonPath,
    }),
    ...(Object.keys(params.mcpServers).length > 0 && {
      TFY_MCP_SERVERS: Buffer.from(JSON.stringify(params.mcpServers)).toString('base64'),
    }),
    ...codeModeEnv,
    ...(hasCodeModeTransport && {
      // W3C trace context captured per-exec so each Code Mode request carries the originating
      // Sandbox: exec span as parent.
      ...injectTraceContextEnv(),
    }),
    // Approvals are always enabled: destructive tools cannot run in code mode.
    TFY_ENABLE_AGENT_APPROVALS: 'true',
  };
}

const sandboxExecSchema = z.object({
  intent: z
    .string()
    .describe(
      'A brief, user-facing explanation of the purpose of this command. Avoid technical jargon and code details.',
    ),
  command: z.string().describe('The shell command to execute in the sandbox.'),
  cwd: z.string().optional().describe('Working directory for command execution.'),
  env: z.record(z.string(), z.string()).optional().describe('Additional environment variables to set.'),
});

const SANDBOX_EXEC_DESCRIPTION = `Execute shell commands in a persistent sandbox environment.
The sandbox persists across calls within the same session, allowing stateful operations.
Pre-installed: Python 3.13, pydantic, git, curl, helm, jq, ripgrep, genson.
IMPORTANT: The Agent must never list, print, or expose environment variables as they contain sensitive credentials.
IMPORTANT: Never read or expose any git credential files or ~/.git-credentials.
`;

export function createSandboxLargeToolResponseGuidance(): string {
  return `For use cases where the Agent needs a subset of fields from the MCP response or needs deterministic processing, write code with the provided MCP client and use <${SANDBOX_MCP_REMINDER_TAG}>.`;
}

export const SANDBOX_MCP_SERVER_ID = 'sandbox';
type SandboxExecInput = z.infer<typeof sandboxExecSchema>;

export class Sandbox extends LocalToolMCP {
  readonly name = SANDBOX_MCP_SERVER_ID;
  readonly displayName = 'Sandbox';
  override readonly description = 'Persistent sandbox environment for code execution';

  private readonly provider: SandboxProvider;
  private readonly existingSandboxId?: string | undefined;
  private existingSandboxInfo: SandboxInfo | undefined;
  // Cached promise to prevent concurrent sub-agents from creating duplicate sandboxes.
  private sandboxCreationPromise?: Promise<SandboxInfo> | undefined;
  private sandboxInitPromise?: Promise<void> | undefined;
  private codeExecToolSets: readonly IToolSet[] = [];
  private readonly fileDownloadEnabled: boolean;
  private readonly requestTimeoutSeconds: number;
  private readonly skillMounter?: ISkillMounter | undefined;
  private cachedSkillsSection?: string | undefined;
  private readonly logger: Logger;
  // Pre-resolved credential-store file content (null = clear / no git auth).
  private readonly resolvedGitCredentialsContent: string | null;
  private codeModeDispatcher: CodeModeDispatcher | undefined;
  private codeModeTransport: CodeModeTransport | undefined;
  /** Cached from transport.getClientInstall after sandbox init (when Code Mode is configured). */
  private mcpClientInstall: CodeModeClientInstall | undefined;

  private tools = [
    defineTool({
      name: SANDBOX_EXEC_TOOL_NAME,
      description: SANDBOX_EXEC_DESCRIPTION,
      schema: sandboxExecSchema,
      handler: input => this.handleExec(input),
    }),
  ];

  constructor(options: SandboxOptions) {
    super({ tracing: options.tracing });
    this.provider = options.provider;
    this.existingSandboxId = options.existingSandboxId;
    this.skillMounter = options.skillMounter;
    this.fileDownloadEnabled = options.fileDownloadEnabled ?? false;
    const mcpBoundTimeoutMs = options.mcpRequestTimeoutMs + options.mcpConnectTimeoutMs;
    this.requestTimeoutSeconds = Math.ceil(mcpBoundTimeoutMs / 1000) + NATS_REQUEST_TIMEOUT_BUFFER_SECONDS;
    this.logger = options.logger.child({ module: 'Sandbox' });
    this.resolvedGitCredentialsContent = options.resolvedGitCredentialsContent ?? null;

    if (this.existingSandboxId) {
      this.existingSandboxInfo = { sandbox_id: this.existingSandboxId };
    }
  }

  /** Provider-facing id (unwraps `v1:type:raw`; legacy ids pass through). */
  private providerSandboxId(sessionId: string): string {
    return rawSandboxId(sessionId);
  }

  /** Raw id for prompt layout paths before create (empty when this turn has no existing sandbox). */
  private promptSandboxId(): string {
    return this.existingSandboxId === undefined ? '' : rawSandboxId(this.existingSandboxId);
  }

  private buildMcpServersEnvelope(): Record<string, SandboxMcpServerConfig> {
    const out: Record<string, SandboxMcpServerConfig> = {};
    for (const server of this.codeExecToolSets) {
      const allowedTools = server.getAllowedToolNamesForSandbox?.() ?? [];
      out[server.name] = { allowed_tools: allowedTools };
    }
    return out;
  }

  protected getTools() {
    return this.tools;
  }

  configureCodeMode(servers: readonly IToolSet[]): void {
    if (!servers.length) {
      return;
    }
    if (this.codeModeDispatcher !== undefined || this.codeModeTransport !== undefined) {
      throw new Error('Code Mode is already configured for this Sandbox');
    }
    this.codeExecToolSets = servers;
    this.codeModeDispatcher = new CodeModeDispatcher({ toolSets: servers, logger: this.logger });
    this.codeModeTransport = this.provider.createCodeModeTransport();
  }

  estimateSkillsTokens(): number {
    return Math.round(estimateTokensForString(this.renderSkillsSection()));
  }

  // Single source for the <skills> section, so the prompt and the token estimate can't drift.
  private renderSkillsSection(): string {
    if (this.cachedSkillsSection === undefined) {
      const skills = new InstructionBuilder('skills');
      this.skillMounter?.instruction(skills, { skillsDir: this.provider.getSkillsDir(this.promptSandboxId()) });
      this.cachedSkillsSection = skills.build();
    }
    return this.cachedSkillsSection;
  }

  buildInstruction(builder: InstructionBuilder): void {
    const providerInstructions = this.provider.getAdditionalInstructions();

    const sandboxInstructions = builder.beginSection('sandbox');
    sandboxInstructions.addContent('The Agent has access to a persistent sandbox environment for executing code.');
    sandboxInstructions.addContent('The Agent must NOT read or modify any git credential files.');

    this.buildSchemaSection(sandboxInstructions);
    this.buildSkillsSection(sandboxInstructions);
    this.buildMCPSection(sandboxInstructions);
    this.buildFileUploadsSection(sandboxInstructions);

    if (this.fileDownloadEnabled) {
      this.buildFileOutputSection(sandboxInstructions);
    }

    if (providerInstructions) {
      sandboxInstructions.addContent(providerInstructions);
    }
  }

  private buildFileUploadsSection(builder: InstructionBuilder): void {
    builder.addSection(
      SANDBOX_FILE_UPLOADS_TAG,
      `User-uploaded files are placed in ${this.provider.getFileUploadsDir(this.promptSandboxId())}/. The Agent must not modify files in this directory. Always create a copy at a different location and work on the copy.`,
    );
  }

  private buildSchemaSection(builder: InstructionBuilder): void {
    builder.addSection(
      SANDBOX_SCHEMA_INFER_TAG,
      dedent`
      To infer the schema of a file, the Agent MUST execute:
      head -c 200 file_path && echo "==" && genson file_path
      This serves two purpose:
      1. The first 200 characters of the file is printed. Do NOT print more than 200 characters.
      2. genson infers and returns JSON schema if the file is JSON.
      Even if the file is not JSON, (1) helps to take the next step in less number of turns
      `,
    );
  }

  private buildFileOutputSection(builder: InstructionBuilder): void {
    builder.addSection(
      SANDBOX_FILE_OUTPUT_TAG,
      dedent`
        ## File outputs

        The user does not have direct access to the sandbox filesystem. When the Agent wants to output a file to the user, it MUST:
        1. Ensure that the file is present in the sandbox.
        2. Then emit a fenced sandbox_artifacts block referencing the file.

        \`\`\`sandbox_artifacts
        [Human-readable label](/absolute/path/to/file.ext)
        \`\`\`

        For large outputs or content that can be generated through code, prefer writing to a file and emitting the sandbox_artifacts block.

        Rules:
        - Use absolute paths, not ~/ or relative paths.
        - One link per line. Markdown link syntax: [label](path).`,
    );
  }

  private buildSkillsSection(builder: InstructionBuilder): void {
    builder.addContent(this.renderSkillsSection());
  }

  private buildMCPSection(builder: InstructionBuilder): void {
    const toolSetNames = this.codeExecToolSets.map(m => m.name).join(',');
    if (!toolSetNames) {
      return;
    }

    builder.addSection(
      SANDBOX_MCP_REMINDER_TAG,
      dedent`
        The following MCP servers are accessible for Code Mode from ${SANDBOX_EXEC_TOOL_NAME} via the pre-installed mcp_client module: ${toolSetNames}
        Tool and functions are same.
        Tool and MCP tools are same.

        Use \`from mcp_client import call_tool\` in code, or \`mcp-client\` in shell — both work from any directory with no setup.

        For deferred MCP servers, the Agent MUST:
        1. Discover tools via ${LIST_TOOLS_NAME} from ${DEFERRED_TOOLS_SERVER_ID}. Never call ${GET_TOOL_OUTPUT_SCHEMA_NAME}.
        2. Discover inputSchema, outputSchema via ${GET_TOOL_INFO_NAME} for the selected tools.

        For non-deferred MCP servers, the Agent MUST:
        1. Discover outputSchema via ${GET_TOOL_OUTPUT_SCHEMA_NAME} for the selected tools.

        For both deferred and non-deferred if outputSchema is absent,
        the Agent MUST say: "Given the MCP Server does not define an outputSchema let me figure it out first before entering Code Mode."
        mcp-client call-tool {server} {tool} '{"param":"value"}' > file && ${SANDBOX_SCHEMA_INFER_TAG}.
        the Agent MUST execute a single command for above.
        If the Agent does not get the outputSchema, the Agent will encounters scenarios like:
        Agent: "Let me fix the code - it seems the x might be a string rather than an object in some cases:"
        The Agent MUST not face the above scenario.
        
        Only after the Agent has the above details, it can enter Code Mode.
        Agent: Now I know the inputSchema and outputSchema of tool_a, let me enter Code Mode.

           CLI:   mcp-client call-tool {server} {tool_a} '{"param":"value"}'
                  # The output of the above command MUST be passed through tools like jq or head -c
                  # or should be written to a file. Goal is to reduce content that the Agent prints.

           Code:  from mcp_client import call_tool
                  async def main():
                      result = await call_tool("{server}", "{tool_a}", body={"param1": "value1"})
                      # In most cases, it is safe to assume response is a dict.
                      # To know the dict keys, the Agent still needs to figure out the outputSchema.
                      # The Agent MUST write the code to a file first before executing it.

        Code Mode MUST be used in following scenarios:

        1. Reduce structured tool output by executing logic on top of it. Never present raw output.
          Agent: Now I know the inputSchema and outputSchema of tool_a, let me enter Code Mode.

          from mcp_client import call_tool
          from collections import Counter
          result = await call_tool("{server}", "{tool_a}", body={"param1": "value1"})
          print(Counter(r["a"] for r in result["b"] if r["c"])) # Here we need outputSchema to know a, b and c exists.

        2. Piping result of one tool call to another tool request. Never present raw output.
          Agent: Now I know the inputSchema and outputSchema of tool1, let me enter Code Mode.

          from mcp_client import call_tool
          result1 = await call_tool("{server}", "{tool1}", body={"param1": "value1"})
          result2 = await call_tool("{server}", "{tool2}", body={"param2": result1["value1"]}) # Here we need outputSchema to know value1 exists.
          print(result2) # Note in this case, we do not need outputSchema of result2 as we are not using any fields.

        The Agent MUST NOT use Code Mode just to print the full raw response of a tool. The Agent MUST call the tool directly in this case, there are other mechanisms in place to ensure
        large tool call outputs are not loaded in context.
        
        The Agent must not use Code Mode in the following patterns:
        from mcp_client import call_tool
        import json
        result = await call_tool("{server}", "{tool}", body={"param1": "value1"})
        print(result) # Never do this. Call tool without Code Mode.
        print(json.dumps(result, ...)) # Never do this. Call tool without Code Mode.
        print(result["a"][:100]) # Never do this. Call tool without Code Mode.

        mcp-client call-tool {server} {tool} '{"param":"value"}' > data && cat data # Never do this. Call tool without Code Mode.
        `,
    );
  }

  private get requiredSandboxInfo(): SandboxInfo {
    if (!this.existingSandboxInfo) {
      throw new Error('Sandbox info not available');
    }
    return this.existingSandboxInfo;
  }

  private clearExistingSandbox(): void {
    this.existingSandboxInfo = undefined;
    this.sandboxCreationPromise = undefined;
    this.sandboxInitPromise = undefined;
    this.mcpClientInstall = undefined;
  }

  private async ensureSandboxCreated(): Promise<{
    sandboxInfo: SandboxInfo;
    sandboxCreated: SandboxInfo | undefined;
  }> {
    if (this.existingSandboxInfo) {
      return { sandboxInfo: this.existingSandboxInfo, sandboxCreated: undefined };
    }
    // Provider returns a raw id; persist the fancy `v1:type:raw` session id.
    this.sandboxCreationPromise ??= this.provider
      .createSandbox()
      .then(({ sandboxId }) => ({
        sandbox_id: formatSandboxId({ providerType: this.provider.type, rawId: sandboxId }),
      }))
      .catch((e: unknown) => {
        this.sandboxCreationPromise = undefined;
        throw e;
      });

    const sandboxInfo = await this.sandboxCreationPromise;
    // Concurrent callers may both await the same creation promise; only the first
    // should report sandboxCreated. Read through a method so TS does not keep the
    // pre-await "undefined" narrowing on the field.
    const raced = this.peekExistingSandboxInfo();
    if (raced !== undefined) {
      return { sandboxInfo: raced, sandboxCreated: undefined };
    }
    this.existingSandboxInfo = sandboxInfo;
    return { sandboxInfo, sandboxCreated: sandboxInfo };
  }

  private peekExistingSandboxInfo(): SandboxInfo | undefined {
    return this.existingSandboxInfo;
  }

  /** Same-type missing remote/local root: drop the stale id and create a new fancy id. */
  private async recreateAfterUnavailable(): Promise<{
    sandboxInfo: SandboxInfo;
    sandboxCreated: SandboxInfo;
  }> {
    this.clearExistingSandbox();
    const created = await this.ensureSandboxCreated();
    if (created.sandboxCreated === undefined) {
      throw new Error('Sandbox recreate did not create a new sandbox');
    }
    return { sandboxInfo: created.sandboxInfo, sandboxCreated: created.sandboxCreated };
  }

  /**
   * Create or reattach, then init. A missing same-type sandbox throws
   * `SandboxNotAvailableError` from the provider; reattach then recreates.
   */
  private async ensureReadySandbox(): Promise<{
    sandboxInfo: SandboxInfo;
    sandboxCreated: SandboxInfo | undefined;
  }> {
    const first = await this.ensureSandboxCreated();
    try {
      await this.ensureSandboxInitialized();
      return first;
    } catch (error) {
      if (!(error instanceof SandboxNotAvailableError) || first.sandboxCreated !== undefined) {
        throw error;
      }
      const recreated = await this.recreateAfterUnavailable();
      await this.ensureSandboxInitialized();
      return recreated;
    }
  }

  private async handleExec(input: SandboxExecInput): Promise<CallToolResponse> {
    let sandboxInfo: SandboxInfo;
    let sandboxCreated: SandboxInfo | undefined;
    try {
      ({ sandboxInfo, sandboxCreated } = await this.ensureReadySandbox());
    } catch (e) {
      this.logger.error('Sandbox initialization failed', extractErrorLogFields(e));
      const message = e instanceof Error ? e.message : 'Sandbox initialization failed';
      const fallback = this.existingSandboxInfo;
      return toolResultResponse({
        text: `Sandbox initialization failed: ${message}`,
        isError: true,
        overrides: {
          sandboxCreated: Boolean(fallback),
          ...(fallback !== undefined ? { sandboxInfo: fallback } : {}),
        },
      });
    }
    const sandboxCreatedFlag = Boolean(sandboxCreated);
    const rawId = this.providerSandboxId(sandboxInfo.sandbox_id);
    const codeModeEnv = await this.ensureCodeModeStarted(rawId);
    const mcpClientEnv = injectMCPClientEnv({
      env: input.env,
      mcpServers: this.buildMcpServersEnvelope(),
      codeModeEnv,
      mcpClientInstall: this.mcpClientInstall,
    });
    const gitAuthEnv =
      this.resolvedGitCredentialsContent !== null
        ? buildGitCredentialHelperEnv(this.provider.getGitCredentialsPath(rawId))
        : {};
    const env = { ...mcpClientEnv, ...gitAuthEnv };

    try {
      const result = await this.provider.exec({
        sandboxId: rawId,
        command: input.command,
        cwd: input.cwd,
        env,
      });

      return {
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: !result.success,
        },
        wasInitialized: undefined,
        sandboxCreated: sandboxCreatedFlag,
        sandboxInfo,
      };
    } catch (error) {
      if (!(error instanceof SandboxNotAvailableError) || sandboxCreated !== undefined) {
        throw error;
      }
      const recreated = await this.recreateAfterUnavailable();
      await this.ensureSandboxInitialized();
      const recreatedRawId = this.providerSandboxId(recreated.sandboxInfo.sandbox_id);
      const retryCodeModeEnv = await this.ensureCodeModeStarted(recreatedRawId);
      const retryEnv = {
        ...injectMCPClientEnv({
          env: input.env,
          mcpServers: this.buildMcpServersEnvelope(),
          codeModeEnv: retryCodeModeEnv,
          mcpClientInstall: this.mcpClientInstall,
        }),
        ...(this.resolvedGitCredentialsContent !== null
          ? buildGitCredentialHelperEnv(this.provider.getGitCredentialsPath(recreatedRawId))
          : {}),
      };
      const retryResult = await this.provider.exec({
        sandboxId: recreatedRawId,
        command: input.command,
        cwd: input.cwd,
        env: retryEnv,
      });
      return {
        result: {
          content: [{ type: 'text', text: JSON.stringify(retryResult) }],
          isError: !retryResult.success,
        },
        wasInitialized: undefined,
        sandboxCreated: true,
        sandboxInfo: recreated.sandboxInfo,
      };
    }
  }

  async getToolResultDumpDir(): Promise<{ dir: string; sandboxCreated: SandboxInfo | undefined }> {
    const { sandboxCreated, sandboxInfo } = await this.ensureSandboxCreated();
    const dir = this.provider.getToolResultDumpDir(this.providerSandboxId(sandboxInfo.sandbox_id)).replace(/\/+$/, '');
    return { dir, sandboxCreated };
  }

  async uploadFile(params: {
    targetDir: string;
    fileName: string;
    content: Buffer;
  }): Promise<{ filePath: string; sandboxCreated: SandboxInfo | undefined }> {
    const { sandboxCreated, sandboxInfo } = await this.ensureReadySandbox();
    const fileName = params.fileName.replace(/^\/+/, '');
    const targetDir = params.targetDir.replace(/\/+$/, '');
    const filePath = `${targetDir}/${fileName}`;
    await this.provider.uploadFile({
      sandboxId: this.providerSandboxId(sandboxInfo.sandbox_id),
      remotePath: filePath,
      content: params.content,
    });
    return { filePath, sandboxCreated };
  }

  async uploadUserFile(input: { fileName: string; content: Buffer; mime: string }): Promise<SandboxStoredFile> {
    validateNoPathTraversal(input.fileName);
    const { sandboxCreated, sandboxInfo } = await this.ensureReadySandbox();
    const result = await this.uploadFile({
      targetDir: this.provider.getFileUploadsDir(this.providerSandboxId(sandboxInfo.sandbox_id)),
      fileName: input.fileName,
      content: input.content,
    });
    const created = sandboxCreated ?? result.sandboxCreated;
    return {
      filePath: result.filePath,
      ...(created && { sandboxCreated: created }),
    };
  }

  async writeArtifact(input: {
    fileName: string;
    content: Buffer;
    sourceTool?: MappedMCPTool | undefined;
  }): Promise<SandboxStoredFile> {
    validateNoPathTraversal(input.fileName);
    const { dir, sandboxCreated: dumpDirCreated } = await this.getToolResultDumpDir();
    const result = await this.uploadFile({
      targetDir: dir,
      fileName: input.fileName,
      content: input.content,
    });
    const sandboxCreated = dumpDirCreated ?? result.sandboxCreated;
    return {
      filePath: result.filePath,
      ...(sandboxCreated && { sandboxCreated }),
    };
  }

  /**
   * Upload the MCP client Python script to the sandbox on the first tool call.
   * The sandbox filesystem is persistent within a session, so this only needs to run once.
   */
  private async ensureSandboxInitialized(): Promise<void> {
    this.sandboxInitPromise ??= this.initSandboxEnvironment().catch((e: unknown) => {
      this.sandboxInitPromise = undefined;
      throw e;
    });
    await this.sandboxInitPromise;
  }

  private async writeGitCredentials(): Promise<void> {
    const sandboxId = this.providerSandboxId(this.requiredSandboxInfo.sandbox_id);
    const credentialsPath = this.provider.getGitCredentialsPath(sandboxId);
    const result = await this.provider.exec({
      sandboxId,
      command: buildSyncGitCredentialsCommand(this.resolvedGitCredentialsContent, credentialsPath),
    });
    ensureExecSuccess(result);
  }

  private async initSandboxEnvironment(): Promise<void> {
    const sandboxId = this.providerSandboxId(this.requiredSandboxInfo.sandbox_id);
    const fileUploadsDir = this.provider.getFileUploadsDir(sandboxId);
    const skillsDir = this.provider.getSkillsDir(sandboxId);
    const toolResultDumpDir = this.provider.getToolResultDumpDir(sandboxId);

    this.logger.info('Uploading MCP client script and preparing skills directory in sandbox');

    this.mcpClientInstall = this.codeModeTransport?.getClientInstall({ sandboxId });
    const install = this.mcpClientInstall;

    const dirs = [shellEscape(fileUploadsDir), shellEscape(toolResultDumpDir), shellEscape(skillsDir)];
    if (install !== undefined) {
      const { pythonPath, binDir } = mcpClientLayout(install.remotePath);
      dirs.push(shellEscape(pythonPath));
      // Layout bin is only for providers that put that dir on PATH (no image-PATH symlink).
      if (install.pathBinSymlink === undefined) {
        dirs.push(shellEscape(binDir));
      }
    }
    ensureExecSuccess(await this.provider.exec({ sandboxId, command: `mkdir -p ${dirs.join(' ')}` }));

    const initSteps: string[] = [];
    if (install !== undefined) {
      await this.provider.uploadFile({
        sandboxId,
        remotePath: install.remotePath,
        content: Buffer.from(install.content, 'utf-8'),
      });
      initSteps.push(`chmod 0555 ${shellEscape(install.remotePath)}`);
      if (install.pathBinSymlink !== undefined) {
        initSteps.push(`ln -sf ${shellEscape(install.remotePath)} ${shellEscape(install.pathBinSymlink)}`);
      } else {
        // Link target is relative to binDir (`mcp-client/mcp_client.py` from `mcp-client/bin`
        // would resolve to `mcp-client/bin/mcp-client/mcp_client.py`).
        const { binDir, binLink } = mcpClientLayout(install.remotePath);
        initSteps.push(`ln -sf ${shellEscape(relative(binDir, install.remotePath))} ${shellEscape(binLink)}`);
      }
    }

    // Fold skill installation into this single init exec. The mounter returns a declarative
    // command + env + timeout; runs even when empty so its downloader can prune a reused sandbox.
    const skillInit = this.skillMounter?.getSandboxInit({
      skillsDir,
      gitDownloaderPath: this.provider.getGitDownloaderPath(sandboxId),
    });
    if (skillInit) {
      initSteps.push(skillInit.command);
    }

    if (initSteps.length > 0) {
      ensureExecSuccess(
        await this.provider.exec({
          sandboxId,
          command: initSteps.join(' && '),
          env: skillInit?.env,
          timeoutSeconds: skillInit?.timeoutSeconds,
        }),
      );
    }

    this.logger.info(
      install === undefined
        ? `Sandbox initialized: skills dir ${skillsDir}`
        : `Sandbox initialized: MCP client at ${install.remotePath}; skills dir ${skillsDir}`,
    );

    await this.writeGitCredentials();
  }

  /**
   * Lazily start Code Mode transport. Single-flight and idempotent inside the transport.
   * Skipped when code mode was never configured. Connect failures resolve to `undefined`
   * (no Code Mode env for that exec); mcp_client then errors at call time — no HTTPS fallback.
   */
  private async ensureCodeModeStarted(sandboxId: string): Promise<Record<string, string> | undefined> {
    const dispatcher = this.codeModeDispatcher;
    const transport = this.codeModeTransport;
    if (dispatcher === undefined || transport === undefined) {
      return undefined;
    }
    try {
      const { env } = await transport.start({
        codeModeDispatcher: dispatcher,
        sandboxId,
        requestTimeoutSeconds: this.requestTimeoutSeconds,
      });
      return env;
    } catch (e) {
      // Connect-level errors are not sticky: transport clears its session so a later exec may retry.
      this.logger.error('Code Mode transport start failed', {
        ...extractErrorLogFields(e),
        sandboxId,
      });
      return undefined;
    }
  }

  // Tears down per-Sandbox Code Mode resources. Dispatcher close first (in-flight requests get
  // source: transport), then transport.stop() — always safe whether start succeeded, failed, or never ran.
  async close(): Promise<void> {
    this.codeModeDispatcher?.close();
    this.codeModeDispatcher = undefined;
    const transport = this.codeModeTransport;
    this.codeModeTransport = undefined;
    if (transport === undefined) {
      return;
    }
    try {
      await transport.stop();
    } catch (e) {
      this.logger.warn('Error stopping Code Mode transport', extractErrorLogFields(e));
    }
  }
}
