---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-ui": patch
---

TrueFoundry skills catalog: proxy GET /skills and /skills/versions from ServiceFoundry; settings skill writes return 424. SkillManifest is MCP-like (flat object, type $ref SkillType git|registry). AgentSpec skill names are opaque (FQN-safe). UI draft skill mounts map catalog `id` to AgentSpec `name`.
