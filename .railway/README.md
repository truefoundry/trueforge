# Railway configuration

TrueForge hosted topology (app + Postgres + Redis) lives in [`.railway/railway.ts`](./railway.ts).

```bash
pnpm install
railway login
railway init --name trueforge   # or: railway link to an existing project
railway config plan
railway config apply
# Set shared TRUEFORGE_API_KEY once (Project Settings → Shared Variables), e.g.
#   openssl rand -hex 32
#   railway variable set TRUEFORGE_API_KEY --stdin --skip-deploys
# then re-apply or redeploy so trueforge + trueforge-controller pick it up.
railway domain                  # public URL for the trueforge service
```

- **Image:** `RAILWAY_DOCKERFILE_PATH=Dockerfile.dev` selects the from-source build.
- **API key:** Set `TRUEFORGE_API_KEY` yourself as a Railway shared variable. IaC only wires `${{shared.TRUEFORGE_API_KEY}}` onto `trueforge` and `trueforge-controller`.
- **Auth:** Off by default — anyone who can reach the URL is admin. Before sharing a deployment, enable [OIDC login](https://trueforge.dev/authentication/overview) (optional shared-variable block is commented in `railway.ts`).

See [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code). Do not add a root `railway.toml` / `railway.json` — those conflict with this file.
