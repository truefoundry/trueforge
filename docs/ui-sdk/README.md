# TrueForge UI SDK — documentation

Mintlify site for `@truefoundry/trueforge-ui`.

## Local development

```bash
npm i -g mint
mint dev
```

Opens at http://localhost:3000. Run `mint broken-links` before publishing.

## Structure

```
docs.json          navigation, theme, branding
index.mdx          landing page
get-started/       installation, quickstart
concepts/          architecture, agent modes, server contract
guides/            layouts, theming, slots, custom server, MCP OAuth, troubleshooting
reference/         TrueForgeUI, theme, containers, atoms, hooks, server
images/            logos and screenshots
snippets/          reusable MDX fragments
```

See `CLAUDE.md` for authoring conventions and which SDK files are authoritative.
