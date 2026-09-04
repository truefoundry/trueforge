# ci-fixer

Give it a pull request with a failing CI check. It reads the logs, works out why
the check is failing, reproduces the problem in a sandbox, and proposes the
smallest patch that fixes it. Nothing gets pushed until you approve it.

## What you'll need

- Connector: `github`
- Auth: a GitHub personal access token. Create one at github.com/settings/tokens; `repo` scope covers reads plus pushing a fix once you approve it.
- Sandbox: yes. The agent uses it to reproduce the failure and check the patch.

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `github` and paste your token.
3. In Settings, Skills, add `gh-fix-ci`, then in Settings, Sandbox providers, connect a sandbox (the skill runs there).
4. Create the agent (the steps are in the [examples README](../README.md#running-an-example)).

## Try it

> The lint check on PR #212 in my-org/api is red. Can you figure out why and fix it?

> https://github.com/my-org/web/pull/389 has a failing test. Diagnose it and show me a patch.

## How it works

It leans on the `gh-fix-ci` skill, which knows the shape of this job. First it
finds the failing checks and pulls the logs, then it separates a genuine code
failure from a flaky test or an infra timeout. It reproduces the failure in the
sandbox, states a specific root cause, and drafts the smallest diff that
addresses it. You see the diagnosis and the exact change before anything
happens. Committing, pushing, or commenting on the PR all pause for your
approval, so the agent can prepare a fix but never lands one on its own.

## Make it your own

- Have it post the diagnosis as a PR comment for the author to act on, instead of pushing a fix.
- Add a rule that flaky failures get a re-run request rather than a code change.
- Gate merges by running it automatically on every PR that goes red.
