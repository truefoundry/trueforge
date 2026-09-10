---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-ui": patch
---

TrueFoundry skills catalog: proxy GET /skills and /skills/versions from ServiceFoundry; settings skill writes return 424. SkillManifest is a type-discriminated oneOf of GitSkill | TrueFoundryRegistrySkill (`type: truefoundry`; name is FQN, display_name is short). AvailableSkill exposes optional metadata (display_name, repository_name, version). AgentSpec skill refs allow opaque FQN names, optional preload (registry), and max 50. UI draft skill mounts map catalog `id` to AgentSpec `name`.
