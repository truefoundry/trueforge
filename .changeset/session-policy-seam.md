---
'@truefoundry/trueforge': minor
---

Add a SessionPolicy seam enforced at session creation, so operators can
later restrict which agents, models, skills, and MCP servers an
API-driven caller may request. Defaults to unrestricted — no behavior
change until a restrictive SessionPolicyProvider is wired in.
