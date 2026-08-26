# TrueForge desktop (local development)

This Electron shell runs the built standalone TrueForge server and opens its bundled UI in a desktop window. The local
topology matches `npx @truefoundry/trueforge`: one Node process serves the API and frontend and persists data in SQLite.

From the repository root:

```bash
pnpm desktop
```

The command builds the workspace first, starts TrueForge on `127.0.0.1:8790`, waits for `/healthz`, and opens Electron.
Closing the window stops the server process started by Electron.

Set `PORT` before running the command to use another port. If a healthy TrueForge server is already listening there,
the desktop shell reuses it and leaves it running when the window closes.

The `pnpm desktop` workflow is for local development and does not package the app.

## Build an unsigned DMG

On macOS, run:

```bash
pnpm desktop:pack
```

This builds TrueForge and stages a production-only harness plus the current Node executable, then `desktop/pack.mjs`
builds the app bundle in `desktop/release/mac-<arch>/`, copies the staged runtime into it, and writes an unsigned DMG to
`desktop/release/`. The DMG targets the architecture of the Mac that runs the command.

`pnpm desktop:pack:dmg` repeats everything after staging, which is the loop to use when only packaging changes.

Two packaging details are deliberate. The staged harness is copied into `Contents/Resources` by the script rather than
by electron-builder's `extraResources`, which drops `node_modules` and leaves the harness unable to resolve its
dependencies at runtime. The DMG is created with `hdiutil` rather than electron-builder's DMG target, because macOS
fails that target's image conversion intermittently with `hdiutil: convert failed - Resource temporarily unavailable`;
the script retries the call instead of failing the build.

Because the app is unsigned, macOS may block its first launch. Right-click the installed app and choose **Open** to
confirm that you trust it.
