import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import {
  checkSessionPolicyForAgent,
  type SessionPolicy,
  UNRESTRICTED_SESSION_POLICY,
} from '../../../src/auth/sessionPolicy';

const baseSpec = AgentSpecSchema.parse({ model: { name: 'openai/gpt-4o' } });

const specWithSkills = AgentSpecSchema.parse({
  model: { name: 'openai/gpt-4o' },
  skills: [{ name: 'code-interpreter' }, { name: 'web-search' }],
});

const specWithMcpServers = AgentSpecSchema.parse({
  model: { name: 'openai/gpt-4o' },
  mcp_servers: [{ name: 'github' }, { name: 'slack' }],
});

describe('checkSessionPolicyForAgent', () => {
  describe('unrestricted policy', () => {
    it('allows a named agent ref', () => {
      const result = checkSessionPolicyForAgent(UNRESTRICTED_SESSION_POLICY, { name: 'my-agent' });
      expect(result.allowed).toBe(true);
    });

    it('allows an inline spec with a model', () => {
      const result = checkSessionPolicyForAgent(UNRESTRICTED_SESSION_POLICY, { spec: baseSpec });
      expect(result.allowed).toBe(true);
    });

    it('allows an inline spec with skills', () => {
      const result = checkSessionPolicyForAgent(UNRESTRICTED_SESSION_POLICY, { spec: specWithSkills });
      expect(result.allowed).toBe(true);
    });

    it('allows an inline spec with mcp_servers', () => {
      const result = checkSessionPolicyForAgent(UNRESTRICTED_SESSION_POLICY, { spec: specWithMcpServers });
      expect(result.allowed).toBe(true);
    });
  });

  describe('allow_inline_agent_specs: false', () => {
    const policy: SessionPolicy = {
      ...UNRESTRICTED_SESSION_POLICY,
      allow_inline_agent_specs: false,
    };

    it('rejects any inline spec', () => {
      const result = checkSessionPolicyForAgent(policy, { spec: baseSpec });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/inline agent/i);
      }
    });

    it('still allows a named agent ref', () => {
      const result = checkSessionPolicyForAgent(policy, { name: 'my-agent' });
      expect(result.allowed).toBe(true);
    });
  });

  describe('allowed_agent_names', () => {
    it('allows a name that is in the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_agent_names: ['permitted-agent', 'other-agent'],
      };
      expect(checkSessionPolicyForAgent(policy, { name: 'permitted-agent' }).allowed).toBe(true);
    });

    it('rejects a name that is not in the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_agent_names: ['permitted-agent'],
      };
      const result = checkSessionPolicyForAgent(policy, { name: 'forbidden-agent' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/forbidden-agent/);
      }
    });

    it('rejects every name when the allow-list is empty', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_agent_names: [],
      };
      expect(checkSessionPolicyForAgent(policy, { name: 'any-agent' }).allowed).toBe(false);
    });

    it('does not apply to inline specs (inline gate is separate)', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_agent_names: [],
      };
      expect(checkSessionPolicyForAgent(policy, { spec: baseSpec }).allowed).toBe(true);
    });
  });

  describe('allowed_models', () => {
    it('allows a model inside the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-6'],
      };
      expect(checkSessionPolicyForAgent(policy, { spec: baseSpec }).allowed).toBe(true);
    });

    it('rejects a model outside the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_models: ['anthropic/claude-sonnet-4-6'],
      };
      const result = checkSessionPolicyForAgent(policy, { spec: baseSpec });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/openai\/gpt-4o/);
      }
    });
  });

  describe('allowed_skills', () => {
    it('allows specs whose skills are all in the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_skills: ['code-interpreter', 'web-search', 'extra'],
      };
      expect(checkSessionPolicyForAgent(policy, { spec: specWithSkills }).allowed).toBe(true);
    });

    it('rejects a spec with a skill outside the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_skills: ['code-interpreter'],
      };
      const result = checkSessionPolicyForAgent(policy, { spec: specWithSkills });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/web-search/);
      }
    });

    it('rejects when only the second skill is disallowed (not just first)', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        // code-interpreter is allowed, web-search is not
        allowed_skills: ['code-interpreter'],
      };
      const result = checkSessionPolicyForAgent(policy, { spec: specWithSkills });
      expect(result.allowed).toBe(false);
    });
  });

  describe('allowed_mcp_servers', () => {
    it('allows specs whose mcp_servers are all in the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_mcp_servers: ['github', 'slack', 'jira'],
      };
      expect(checkSessionPolicyForAgent(policy, { spec: specWithMcpServers }).allowed).toBe(true);
    });

    it('rejects a spec with an mcp_server outside the list', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        allowed_mcp_servers: ['github'],
      };
      const result = checkSessionPolicyForAgent(policy, { spec: specWithMcpServers });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/slack/);
      }
    });

    it('rejects when only the second server is disallowed (not just first)', () => {
      const policy: SessionPolicy = {
        ...UNRESTRICTED_SESSION_POLICY,
        // github is allowed, slack is not
        allowed_mcp_servers: ['github'],
      };
      const result = checkSessionPolicyForAgent(policy, { spec: specWithMcpServers });
      expect(result.allowed).toBe(false);
    });
  });
});
