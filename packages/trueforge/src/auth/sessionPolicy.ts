import type { CreateSessionAgent } from '../schemas/session';
import { isSessionAgentNameRef } from '../schemas/session';
import type { RequestContext } from './identity';

/**
 * Server-enforced constraints on what a caller may request when creating a
 * session. `undefined` on an allow-list means "unrestricted" for that
 * dimension — distinct from an empty array, which permits nothing.
 */
export interface SessionPolicy {
  /** Whether the caller may submit an inline (ad hoc) agent spec at all. */
  allow_inline_agent_specs: boolean;
  /** Named agents the caller may bind a session to. `undefined` = any. */
  allowed_agent_names: readonly string[] | undefined;
  /** Models an inline spec may request. `undefined` = any configured model. */
  allowed_models: readonly string[] | undefined;
  /** Skills an inline spec may request. `undefined` = any configured skill. */
  allowed_skills: readonly string[] | undefined;
  /** MCP servers an inline spec may request. `undefined` = any configured server. */
  allowed_mcp_servers: readonly string[] | undefined;
}

/** No constraints beyond what already exists today (any agent, any resource). */
export const UNRESTRICTED_SESSION_POLICY: SessionPolicy = {
  allow_inline_agent_specs: true,
  allowed_agent_names: undefined,
  allowed_models: undefined,
  allowed_skills: undefined,
  allowed_mcp_servers: undefined,
};

/**
 * Resolves the {@link SessionPolicy} that applies to a caller's session
 * creation requests. Mirrors Authorizer: implementations may key off
 * `context.subject`, `context.roles`, or tenant config to scope unattended
 * / API-driven identities. Not consulted for reads of existing sessions —
 * ownership there is still `created_by`.
 */
export interface SessionPolicyProvider {
  resolveSessionPolicy(input: { context: RequestContext }): Promise<SessionPolicy>;
}

/** Default: every caller gets UNRESTRICTED_SESSION_POLICY — current behavior, unchanged. */
export class UnrestrictedSessionPolicyProvider implements SessionPolicyProvider {
  resolveSessionPolicy(): Promise<SessionPolicy> {
    return Promise.resolve(UNRESTRICTED_SESSION_POLICY);
  }
}

export type SessionPolicyDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Checks a requested session agent against a resolved policy. Called at
 * session-creation time, before any store lookups — the server enforces
 * this itself and never trusts restrictions the caller claims to already
 * be honoring.
 */
export function checkSessionPolicyForAgent(policy: SessionPolicy, agent: CreateSessionAgent): SessionPolicyDecision {
  if (isSessionAgentNameRef(agent)) {
    if (policy.allowed_agent_names !== undefined && !policy.allowed_agent_names.includes(agent.name)) {
      return { allowed: false, reason: `Agent "${agent.name}" is not permitted by session policy` };
    }
    return { allowed: true };
  }

  if (!policy.allow_inline_agent_specs) {
    return { allowed: false, reason: 'Inline agent specifications are not permitted by session policy' };
  }

  const { spec } = agent;
  if (policy.allowed_models !== undefined && !policy.allowed_models.includes(spec.model.name)) {
    return { allowed: false, reason: `Model "${spec.model.name}" is not permitted by session policy` };
  }

  if (policy.allowed_skills !== undefined) {
    const allowedSkills = policy.allowed_skills;
    const disallowed = (spec.skills ?? []).find(skill => !allowedSkills.includes(skill.name));
    if (disallowed !== undefined) {
      return { allowed: false, reason: `Skill "${disallowed.name}" is not permitted by session policy` };
    }
  }

  if (policy.allowed_mcp_servers !== undefined) {
    const allowedServers = policy.allowed_mcp_servers;
    const disallowed = (spec.mcp_servers ?? []).find(server => !allowedServers.includes(server.name));
    if (disallowed !== undefined) {
      return { allowed: false, reason: `MCP server "${disallowed.name}" is not permitted by session policy` };
    }
  }

  return { allowed: true };
}
