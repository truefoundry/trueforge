import type { AgentExecutionTrace, AgentLocalToolTrace, AgentRemoteMcpToolTrace, AgentTracing } from './AgentTracing';

class NoopAgentExecutionTrace implements AgentExecutionTrace {
  runInContext<T>(operation: () => T): T {
    return operation();
  }

  startSubAgent(): AgentExecutionTrace {
    return this;
  }

  setOutput(): void {
    /* no-op */
  }

  setMetrics(): void {
    /* no-op */
  }

  setError(): void {
    /* no-op */
  }

  setSuccess(): void {
    /* no-op */
  }

  end(): void {
    /* no-op */
  }
}

class NoopAgentLocalToolTrace implements AgentLocalToolTrace {
  setOutput(): void {
    /* no-op */
  }

  setSandboxId(): void {
    /* no-op */
  }
}

class NoopAgentRemoteMcpToolTrace implements AgentRemoteMcpToolTrace {
  setOutput(): void {
    /* no-op */
  }

  setNumberOfTools(): void {
    /* no-op */
  }
}

const NOOP_EXECUTION_TRACE = new NoopAgentExecutionTrace();
const NOOP_LOCAL_TOOL_TRACE = new NoopAgentLocalToolTrace();
const NOOP_REMOTE_MCP_TOOL_TRACE = new NoopAgentRemoteMcpToolTrace();

export const NOOP_AGENT_TRACING: AgentTracing = {
  async withInitSpan<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  },

  startRootSpan(): AgentExecutionTrace {
    return NOOP_EXECUTION_TRACE;
  },

  async withLocalToolSpan<T>(
    _input: {
      displayName: string;
      toolName: string;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentLocalToolTrace) => Promise<T>,
  ): Promise<T> {
    void _input;
    return operation(NOOP_LOCAL_TOOL_TRACE);
  },

  async withRemoteMcpToolSpan<T>(
    _input: {
      method: string;
      serverName: string;
      serverId: string;
      serverUrl: string;
      toolName?: string | undefined;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentRemoteMcpToolTrace) => Promise<T>,
  ): Promise<T> {
    void _input;
    return operation(NOOP_REMOTE_MCP_TOOL_TRACE);
  },
};
