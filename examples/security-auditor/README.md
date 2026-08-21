# security-auditor

Point it at a public GitHub repo. It reads the code, looks for security problems
across a few parallel passes, verifies each finding before reporting it to
reduce false positives, and offers to file GitHub issues for the serious ones
once you approve.

## What you'll need

- Connectors: `github` (code, issues) and `exa` (looking up known vulnerabilities)
- Auth: a GitHub personal access token. Create one at github.com/settings/tokens; `repo` scope covers reading code and filing issues. exa needs no key.
- Sandbox: yes. It uses the sandbox to grep the repo for patterns like committed secrets.

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `github` with your token and `exa` (no key).
3. In Settings, Sandbox providers, connect a sandbox.
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Audit expressjs/express and show me the highest-severity issues first.

> Look at my-org/my-service on the main branch. Focus on secrets and injection, and draft issues for anything critical.

## How it works

It maps the repo first, then runs three checks at the same time, one for
committed secrets, one for injection and unsafe input handling, and one for
vulnerable dependencies, where it uses exa to confirm known CVEs. Each check runs
on its own, so a large repo does not fill one context with everything at once.
Before anything is reported, it re-reads the code behind each finding and drops
the placeholders and test fixtures that look like problems but are not. You get a
report ranked by severity and a dashboard of the counts. Filing issues is a
write, so it shows you the exact titles and bodies and waits for your approval.

## Make it your own

- Add a fourth check for license headers, dependency pinning, or secrets-scanning config.
- Have it open a draft pull request with the fixes instead of filing issues.
- Run it against a single pull request's diff as a pre-merge gate rather than the whole repo.
