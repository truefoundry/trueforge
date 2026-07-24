import { context, propagation } from '@opentelemetry/api';
import dedent from 'dedent';
import type { Logger } from 'winston';
import { z } from 'zod';
import { InstructionBuilder } from '../InstructionBuilder';
import { estimateTokensForString } from '../llm/usage';
import type { MappedMCPTool } from '../mcp/convertMCPServers';
import { type CallToolResponse, type IToolSet, toolResultResponse } from '../mcp/IMCPServer';
import { defineTool, LocalToolMCP } from '../mcp/LocalToolMCP';
import {
  DEFERRED_TOOLS_SERVER_ID,
  GET_TOOL_INFO_NAME,
  GET_TOOL_OUTPUT_SCHEMA_NAME,
  LIST_TOOLS_NAME,
} from '../runtime/DeferredTool';
import type { AgentTracing } from '../tracing/AgentTracing';
import { extractErrorLogFields } from '../util/errorLogFields';
import { SANDBOX_FILE_UPLOADS_DIR, SANDBOX_NATS_WS_PORT } from './constants';
import { type SandboxProvider, ensureExecSuccess } from './provider/Provider';
import { validateNoPathTraversal, validateSandboxOwnedByTenant } from './SandboxErrors';
import { SandboxNatsBridge } from './SandboxNatsBridge';
import { sandboxScripts } from './sandboxScripts.gen';

export interface SandboxInfo {
  sandbox_id: string;
}

/** Write or clear the git credential-store file at an absolute path (no global git config mutation). */
function buildSyncGitCredentialsCommand(credentialsContent: string | null, credentialsPath: string): string {
  if (credentialsContent === null) {
    return `rm -f ${credentialsPath}`;
  }
  // Base64 avoids interpolating credentials directly into the shell command.
  const b64 = Buffer.from(credentialsContent, 'utf-8').toString('base64');
  return (
    `mkdir -p "$(dirname ${credentialsPath})" && ` +
    `echo '${b64}' | base64 -d > ${credentialsPath} && ` +
    `chmod 600 ${credentialsPath}`
  );
}

/**
 * Process-scoped credential.helper via GIT_CONFIG_* (avoids shared ~/.gitconfig).
 * Required for TFY sandbox where many logical sandboxes share one pod/HOME.
 */
function buildGitCredentialHelperEnv(credentialsPath: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: `store --file ${credentialsPath}`,
  };
}

export interface MountedSkill {
  fqn: string;
  name: string;
  description: string;
  skillMdContent: string | null;
}

export interface SandboxStoredFile {
  filePath: string;
  sandboxCreated?: SandboxInfo | undefined;
}

export interface SandboxOptions {
  provider: SandboxProvider;
  existingSandboxId?: string | undefined;
  mountedSkills?: readonly MountedSkill[] | undefined;
  fileDownloadEnabled?: boolean | undefined;
  /** Pre-resolved credential-store file content (null = clear / no git auth). */
  resolvedGitCredentialsContent?: string | null | undefined;
  /**
   * Blocks destructive tools in code mode so they go through the approval flow
   * instead. Must be `true` — approvals are always enabled (the kill switch is gone).
   */
  blockDestructiveToolsInCodeMode: true;
  execExtraEnv?: Readonly<Record<string, string>> | undefined;
  skillInitEnv?: Readonly<Record<string, string>> | undefined;
  tracing: AgentTracing;
  logger: Logger;
}

export const SANDBOX_EXEC_TOOL_NAME = 'exec';
const SANDBOX_MCP_REMINDER_TAG = 'sandbox-mcp-code-mode';
const SANDBOX_FILE_OUTPUT_TAG = 'sandbox-file-output';
export const SANDBOX_SCHEMA_INFER_TAG = 'sandbox-schema-infer';
const SANDBOX_FILE_UPLOADS_TAG = 'sandbox-file-uploads';

// Stable directory inside the sandbox where the MCP client library is uploaded.
// MCP client upload dir. Two lookup channels:
//   - Python imports → PYTHONPATH points here (set by injectMCPClientEnv).
//   - Shell `mcp-client` → symlinked into MCP_CLIENT_BIN_SYMLINK (on default PATH);
//     basename drops `.py` so the agent doesn't reflexively prefix with `python`.
const MCP_CLIENT_DIR = '/opt/tfy/mcp-client';
const MCP_CLIENT_PATH = `${MCP_CLIENT_DIR}/mcp_client.py`;
const MCP_CLIENT_BIN_SYMLINK = '/usr/local/bin/mcp-client';
const SKILL_DOWNLOADER_PATH = '/opt/tfy/skill_downloader.py';
const SKILLS_DIR = '/opt/tfy/skills';

function getSkillPath(skillName: string): string {
  return `${SKILLS_DIR}/${skillName}`;
}

const SKILLS_PREAMBLE = [
  '1. The skill is present in the `path` directory.',
  '2. SKILL.md file within the directory is the primary file, there can be other files as well.',
  '3. Use `description` to judge whether the Agent needs to use a skill.',
  '4. To use a skill:',
  '4.a. If the `SKILL.md content` is inlined, the Agent must not read `path/SKILL.md`.',
  '4.b. Otherwise the Agent must read `path/SKILL.md` first.',
  '5. The Agent must avoid listing the `path` unless there are references in `SKILL.md` and there is reason to do so given the current conversation.',
].join('\n');

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
  if (carrier['traceparent']) env['TFY_TRACEPARENT'] = carrier['traceparent'];
  if (carrier['tracestate']) env['TFY_TRACESTATE'] = carrier['tracestate'];
  return env;
}

/**
 * Injects environment variables required for mcp_client.py into sandbox_exec arguments.
 *
 * `natsBridgeSubjectPrefix` MUST be the prefix the gateway-side bridge subscribed to; the
 * sandbox script publishes to `<prefix>.mcp` (operation in the payload's `op` field) and only
 * this bridge receives them. See SandboxNatsBridge.
 */
function injectMCPClientEnv(params: {
  env?: Record<string, string> | undefined;
  mcpServers: Record<string, SandboxMcpServerConfig>;
  execExtraEnv?: Readonly<Record<string, string>> | undefined;
  natsBridgeSubjectPrefix?: string | undefined;
}): Record<string, string> {
  return {
    ...(params.execExtraEnv ?? {}),
    ...(params.env ?? {}),
    PYTHONPATH: MCP_CLIENT_DIR,
    ...(Object.keys(params.mcpServers).length > 0 && {
      TFY_MCP_SERVERS: Buffer.from(JSON.stringify(params.mcpServers)).toString('base64'),
    }),
    ...(params.natsBridgeSubjectPrefix && {
      TFY_NATS_URL: `ws://localhost:${String(SANDBOX_NATS_WS_PORT)}`,
      TFY_NATS_SUBJECT_PREFIX: params.natsBridgeSubjectPrefix,
      // W3C trace context captured per-exec so each NATS request carries the originating
      // Sandbox: exec span as parent. Without this, MCP spans dispatched via the bridge
      // inherit whatever ALS context the NATS callback runs under (stale, shared across execs).
      ...injectTraceContextEnv(),
    }),
    // Approvals are always enabled: destructive tools cannot run in code mode.
    TFY_ENABLE_AGENT_APPROVALS: 'true',
  };
}

function buildSkillInitEnv(
  skillInitEnv: Readonly<Record<string, string>> | undefined,
  skillVersionFqnsCsv?: string,
): Record<string, string> {
  return {
    AGENT_SKILL_VERSION_FQNS: skillVersionFqnsCsv ?? '',
    ...(skillInitEnv ?? {}),
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
  env: z.record(z.string()).optional().describe('Additional environment variables to set.'),
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
  static readonly FILE_UPLOADS_DIR = SANDBOX_FILE_UPLOADS_DIR;

  private readonly provider: SandboxProvider;
  private readonly existingSandboxId?: string | undefined;
  private readonly tenantName: string;
  private existingSandboxInfo: SandboxInfo | undefined;
  // Cached promise to prevent concurrent sub-agents from creating duplicate sandboxes.
  private sandboxCreationPromise?: Promise<SandboxInfo> | undefined;
  private sandboxInitPromise?: Promise<void> | undefined;
  private codeExecToolSets: readonly IToolSet[] = [];
  private readonly fileDownloadEnabled: boolean;
  private readonly execExtraEnv?: Readonly<Record<string, string>> | undefined;
  private readonly skillInitEnv?: Readonly<Record<string, string>> | undefined;
  private readonly mountedSkills: readonly MountedSkill[];
  private readonly mcpClientScriptBase64: string;
  private readonly skillDownloaderScriptBase64: string;
  private readonly logger: Logger;
  // Pre-resolved credential-store file content (null = clear / no git auth).
  private readonly resolvedGitCredentialsContent: string | null;
  private natsBridgePromise?: Promise<SandboxNatsBridge | undefined> | undefined;

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
    this.tenantName = options.execExtraEnv?.['TFY_TENANT_NAME'] ?? '';
    this.mountedSkills = options.mountedSkills ?? [];
    this.fileDownloadEnabled = options.fileDownloadEnabled ?? false;
    this.execExtraEnv = options.execExtraEnv;
    this.skillInitEnv = options.skillInitEnv;
    // Scripts are internal to Sandbox: the upload paths, env contract, and prompt
    // text are all hardcoded here, so injecting different content was never a
    // real extension point. Consumers don't see or provide them.
    this.mcpClientScriptBase64 = Buffer.from(sandboxScripts.mcpClient, 'utf-8').toString('base64');
    this.skillDownloaderScriptBase64 = Buffer.from(sandboxScripts.skillDownloader, 'utf-8').toString('base64');
    this.logger = options.logger.child({ module: 'Sandbox' });
    this.resolvedGitCredentialsContent = options.resolvedGitCredentialsContent ?? null;

    if (this.existingSandboxId) {
      validateSandboxOwnedByTenant(this.existingSandboxId, this.tenantName);
      this.existingSandboxInfo = { sandbox_id: this.existingSandboxId };
    }
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
    this.codeExecToolSets = servers;
  }

  estimateSkillsTokens(): number {
    if (!this.mountedSkills.length) return 0;
    let fullContent = `<skills>\n${SKILLS_PREAMBLE}\n\n`;
    for (const skill of this.mountedSkills) {
      const skillPath = getSkillPath(skill.name);
      const body = skill.skillMdContent
        ? `path: ${skillPath}\nSKILL.md content:\n${skill.skillMdContent}`
        : `path: ${skillPath}\nname: ${skill.name}\ndescription: ${skill.description}`;
      fullContent += `<skill>\n${body}\n</skill>\n\n`;
    }
    fullContent += '</skills>';
    return Math.round(estimateTokensForString(fullContent));
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
      `User-uploaded files are placed in ${Sandbox.FILE_UPLOADS_DIR}/. The Agent must not modify files in this directory. Always create a copy at a different location and work on the copy.`,
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
    if (!this.mountedSkills.length) return;

    const skills = builder.beginSection('skills');

    skills.addContent(SKILLS_PREAMBLE);

    for (const skill of this.mountedSkills) {
      const skillPath = getSkillPath(skill.name);
      const content = skill.skillMdContent
        ? `path: ${skillPath}\nSKILL.md content:\n${skill.skillMdContent}`
        : `path: ${skillPath}\nname: ${skill.name}\ndescription: ${skill.description}`;
      skills.addSection('skill', content);
    }
  }

  private buildMCPSection(builder: InstructionBuilder): void {
    const toolSetNames = this.codeExecToolSets.map(m => m.name).join(',');
    if (!toolSetNames) return;

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

  private async ensureSandboxCreated(): Promise<{
    sandboxInfo: SandboxInfo;
    sandboxCreated: SandboxInfo | undefined;
  }> {
    if (this.existingSandboxInfo) {
      return { sandboxInfo: this.existingSandboxInfo, sandboxCreated: undefined };
    }
    // Provider returns camelCase `{ sandboxId }`; rename to the snake_case
    // `SandboxInfo` shape used everywhere downstream (Redis JSON, wire event,
    // in-memory state).
    this.sandboxCreationPromise ??= this.provider
      .createSandbox()
      .then(({ sandboxId }) => {
        validateSandboxOwnedByTenant(sandboxId, this.tenantName);
        return { sandbox_id: sandboxId };
      })
      .catch((e: unknown) => {
        this.sandboxCreationPromise = undefined;
        throw e;
      });

    const sandboxInfo = await this.sandboxCreationPromise;
    // Concurrent callers may both await the same creation promise; only the first
    // should report sandboxCreated. Read via a local to avoid control-flow narrowing
    // that treats existingSandboxInfo as always undefined after the early return above.
    const prior = this.existingSandboxInfo as SandboxInfo | undefined;
    const isNew = prior === undefined;
    this.existingSandboxInfo = sandboxInfo;
    return { sandboxInfo, sandboxCreated: isNew ? sandboxInfo : undefined };
  }

  private async handleExec(input: SandboxExecInput): Promise<CallToolResponse> {
    const { sandboxInfo, sandboxCreated } = await this.ensureSandboxCreated();
    const sandboxCreatedFlag = Boolean(sandboxCreated);
    try {
      await this.ensureSandboxInitialized();
    } catch (e) {
      this.logger.error('Sandbox initialization failed', extractErrorLogFields(e));
      const message = e instanceof Error ? e.message : 'Sandbox initialization failed';
      return toolResultResponse({
        text: `Sandbox initialization failed: ${message}`,
        isError: true,
        overrides: { sandboxCreated: sandboxCreatedFlag, sandboxInfo },
      });
    }
    const bridge = await this.ensureNatsBridgeConnected(sandboxInfo.sandbox_id);
    const mcpClientEnv = injectMCPClientEnv({
      env: input.env,
      mcpServers: this.buildMcpServersEnvelope(),
      execExtraEnv: this.execExtraEnv,
      natsBridgeSubjectPrefix: bridge?.subjectPrefix,
    });
    const gitAuthEnv =
      this.resolvedGitCredentialsContent !== null
        ? buildGitCredentialHelperEnv(this.provider.getGitCredentialsPath(sandboxInfo.sandbox_id))
        : {};
    const env = { ...mcpClientEnv, ...gitAuthEnv };

    const result = await this.provider.exec({
      sandboxId: sandboxInfo.sandbox_id,
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
  }

  async getToolResultDumpDir(): Promise<{ dir: string; sandboxCreated: SandboxInfo | undefined }> {
    const { sandboxCreated } = await this.ensureSandboxCreated();
    const dir = this.provider.getToolResultDumpDir(this.requiredSandboxInfo.sandbox_id).replace(/\/+$/, '');
    return { dir, sandboxCreated };
  }

  async uploadFile(params: {
    targetDir: string;
    fileName: string;
    content: Buffer;
  }): Promise<{ filePath: string; sandboxCreated: SandboxInfo | undefined }> {
    const { sandboxCreated } = await this.ensureSandboxCreated();
    await this.ensureSandboxInitialized();
    const { sandbox_id: sandboxId } = this.requiredSandboxInfo;
    const fileName = params.fileName.replace(/^\/+/, '');
    const targetDir = params.targetDir.replace(/\/+$/, '');
    const filePath = `${targetDir}/${fileName}`;
    await this.provider.uploadFile({ sandboxId, remotePath: filePath, content: params.content });
    return { filePath, sandboxCreated };
  }

  async uploadUserFile(input: { fileName: string; content: Buffer; mime: string }): Promise<SandboxStoredFile> {
    validateNoPathTraversal(input.fileName);
    const result = await this.uploadFile({
      targetDir: Sandbox.FILE_UPLOADS_DIR,
      fileName: input.fileName,
      content: input.content,
    });
    return {
      filePath: result.filePath,
      ...(result.sandboxCreated && { sandboxCreated: result.sandboxCreated }),
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
    const sandboxId = this.requiredSandboxInfo.sandbox_id;
    const credentialsPath = this.provider.getGitCredentialsPath(sandboxId);
    const result = await this.provider.exec({
      sandboxId,
      command: buildSyncGitCredentialsCommand(this.resolvedGitCredentialsContent, credentialsPath),
    });
    ensureExecSuccess(result);
  }

  private async initSandboxEnvironment(): Promise<void> {
    const skillVersionFqnsCsv = this.mountedSkills.length ? this.mountedSkills.map(s => s.fqn).join(',') : undefined;
    const toolResultDumpDir = this.provider.getToolResultDumpDir(this.requiredSandboxInfo.sandbox_id);

    this.logger.info('Uploading MCP client script and preparing skills directory in sandbox');

    const initSteps = [
      `mkdir -p ${MCP_CLIENT_DIR} ${Sandbox.FILE_UPLOADS_DIR} ${toolResultDumpDir}`,
      `rm -f ${MCP_CLIENT_PATH}`,
      `echo '${this.mcpClientScriptBase64}' | base64 -d > ${MCP_CLIENT_PATH}`,
      // Make executable + symlink onto PATH so `mcp-client` runs by name.
      `chmod 0555 ${MCP_CLIENT_PATH}`,
      `ln -sf ${MCP_CLIENT_PATH} ${MCP_CLIENT_BIN_SYMLINK}`,
      `rm -f ${SKILL_DOWNLOADER_PATH}`,
      `echo '${this.skillDownloaderScriptBase64}' | base64 -d > ${SKILL_DOWNLOADER_PATH}`,
      `chmod a-w ${SKILL_DOWNLOADER_PATH}`,
      `mkdir -p ${SKILLS_DIR}`,
      `python3 ${SKILL_DOWNLOADER_PATH}`,
    ];
    const script = initSteps.join(' && ');
    const result = await this.provider.exec({
      sandboxId: this.requiredSandboxInfo.sandbox_id,
      command: script,
      env: buildSkillInitEnv(this.skillInitEnv, skillVersionFqnsCsv),
    });
    ensureExecSuccess(result);
    const fqnCount = this.mountedSkills.length;
    this.logger.info(
      `Sandbox initialized: MCP client at ${MCP_CLIENT_PATH} (symlinked to ${MCP_CLIENT_BIN_SYMLINK}); ` +
        `skill downloader at ${SKILL_DOWNLOADER_PATH}; skills dir ${SKILLS_DIR}` +
        `; ran skill downloader with ${String(fqnCount)} FQN(s) input`,
    );
    await this.writeGitCredentials();
  }

  /**
   * Lazily connect the sandbox→gateway NATS bridge. Single-flight and idempotent.
   * Skipped when there are no MCP servers exposed to code mode (nothing to bridge). Connect
   * failures resolve to `undefined` (no NATS env for that exec); mcp_client then errors at call
   * time — there is no HTTPS fallback.
   */
  private async ensureNatsBridgeConnected(sandboxId: string): Promise<SandboxNatsBridge | undefined> {
    // No MCP servers means the bridge has nothing to dispatch to. Avoid the connect cost.
    if (this.codeExecToolSets.length === 0) return undefined;
    this.natsBridgePromise ??= this.connectNatsBridge(sandboxId).catch((e: unknown) => {
      // Connect-level errors (network, timeout, broker not up) are not sticky: a later exec
      // may succeed (e.g. after sandbox warmup). Wipe the cached promise so retries happen.
      this.logger.error('Sandbox NATS bridge connect failed', {
        ...extractErrorLogFields(e),
        sandboxId,
      });
      this.natsBridgePromise = undefined;
      return undefined;
    });
    return this.natsBridgePromise;
  }

  private async connectNatsBridge(sandboxId: string): Promise<SandboxNatsBridge> {
    const wsUrl = await this.provider.getNatsBridgeUrl(sandboxId);
    const toolSets = new Map<string, IToolSet>();
    for (const server of this.codeExecToolSets) {
      toolSets.set(server.name, server);
    }
    const bridge = await SandboxNatsBridge.connect({ url: wsUrl, toolSets, logger: this.logger });
    this.logger.info('Sandbox NATS bridge connected', {
      sandboxId,
      toolSetCount: toolSets.size,
    });
    this.attachBridgeInvalidationOnClose(bridge, sandboxId);
    return bridge;
  }

  private attachBridgeInvalidationOnClose(bridge: SandboxNatsBridge, sandboxId: string): void {
    const cachedPromise = this.natsBridgePromise;
    // fire and forget
    void bridge.whenClosed().then(() => {
      if (this.natsBridgePromise === cachedPromise) {
        this.natsBridgePromise = undefined;
        this.logger.info('Sandbox NATS bridge closed; cache invalidated, next exec will reconnect', { sandboxId });
      }
    });
  }

  // Tears down per-Sandbox resources. Awaits the in-flight connect (if any) and explicitly
  // closes the bridge — dropping the field alone would leak the WS socket and live
  // subscriptions, and orphan a bridge that finishes connecting after close() returned.
  async close(): Promise<void> {
    const pendingPromise = this.natsBridgePromise;
    this.natsBridgePromise = undefined;
    if (!pendingPromise) return;
    let bridge: SandboxNatsBridge | undefined;
    try {
      bridge = await pendingPromise;
    } catch {
      // Connect-error path already logged inside ensureNatsBridgeConnected's .catch.
    }
    if (!bridge) return;
    try {
      await bridge.close();
    } catch (e) {
      this.logger.warn('Error closing sandbox NATS bridge', extractErrorLogFields(e));
    }
  }
}
