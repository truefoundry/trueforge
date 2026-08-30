# Railway configuration

TrueForge hosted topology (app + Postgres + Redis) lives in [`.railway/railway.ts`](./railway.ts).

```bash
pnpm install
railway login
railway init --name trueforge   # or: railway link to an existing project
railway config plan
railway config apply
railway domain                  # public URL for the trueforge service
```

`RAILWAY_DOCKERFILE_PATH=Dockerfile.dev` selects the from-source image (`STANDALONE=false` and `HOST=0.0.0.0` are baked into that file). Auth is **off** by default — anyone who can reach the URL is admin. Before sharing a deployment, enable [OIDC login](https://trueforge.dev/authentication/overview) (optional shared-variable block is commented in `railway.ts`).

See [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code). Do not add a root `railway.toml` / `railway.json` — those conflict with this file.
