import type { AgentThreadMetrics } from '../runtime/metrics';

export interface AgentExecutionTrace {
  runInContext<T>(operation: () => T): T;
  startSubAgent(name: string, input: string): AgentExecutionTrace;
  setOutput(output: string): void;
  setMetrics(metrics: AgentThreadMetrics): void;
  setError(error: unknown): void;
  setSuccess(): void;
  end(): void;
}

export interface AgentLocalToolTrace {
  setOutput(output: string): void;
  setSandboxId(sandboxId: string): void;
}

export interface AgentRemoteMcpToolTrace {
  setOutput(output: string): void;
  setNumberOfTools(count: number): void;
}

export interface AgentTracing {
  withInitSpan<T>(operation: () => Promise<T>): Promise<T>;

  startRootSpan(input: string): AgentExecutionTrace;

  withLocalToolSpan<T>(
    input: {
      displayName: string;
      toolName: string;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentLocalToolTrace) => Promise<T>,
  ): Promise<T>;

  // Span for a remote (url-based) MCP operation. `serverUrl` must already be redacted (no secrets).
  withRemoteMcpToolSpan<T>(
    input: {
      // MCP method: 'initialize' | 'tools/list' | 'tools/call'.
      method: string;
      serverName: string;
      serverId: string;
      serverUrl: string;
      toolName?: string | undefined;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentRemoteMcpToolTrace) => Promise<T>,
  ): Promise<T>;
}
