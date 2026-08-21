# codebase-onboarding

Drop in a repo and get a "new engineer, start here" guide: what it is, how it is
laid out, how to run and test it, the first files to read, and a few good starter
issues. The questions are researched in parallel and the result comes back as a
single HTML page you can hand to the next new hire.

## What you'll need

- Connectors: `deepwiki` (structure and docs) and `github` (live files, pull requests, issues)
- Auth: a GitHub personal access token (github.com/settings/tokens). deepwiki needs no key.
- Sandbox: yes. The web-artifacts skill renders the guide there.

## Set it up

1. Put a model you have configured into `model.name` in `agent.json`.
2. In Settings, Connectors, add `deepwiki` (no key) and `github` with your token.
3. In Settings, Skills, add `web-artifacts-builder`, then in Settings, Sandbox providers, connect a sandbox (skills run there).
4. Create the agent (steps in the [examples README](../README.md#running-an-example)).

## Try it

> Onboard me to fastapi/fastapi.

> I'm inheriting my-org/legacy-service. Where do I start, and what are three safe first issues?

## How it works

It answers four questions at once, each with its own researcher: what the project
is and where execution starts, how to run and test it, what the core modules do,
and what is being worked on right now (from recent pull requests and open
issues). deepwiki gives the high-level shape and github confirms it against the
real files. The findings become a structured guide, and the web-artifacts skill
turns it into a self-contained HTML page, so you get both a summary in chat and
something you can save and share. If a repo has no tests or no docs, it says so,
which is useful to know on day one.

## Make it your own

- Add a researcher that mines closed issues for recurring foot-guns.
- Include a dependency or architecture diagram in the generated page.
- Run it on every repo a team adopts and keep the pages in your wiki.
