/**
 * Railway Infrastructure as Code for TrueForge hosted mode.
 *
 * One project: app + Postgres + Redis. Plan/apply with:
 *   pnpm install
 *   railway login
 *   railway init --name trueforge   # or: railway link
 *   railway config plan
 *   railway config apply
 *   railway domain                  # public URL for the trueforge service
 *
 * Docs: https://docs.railway.com/infrastructure-as-code
 *
 * Auth is off by default (anyone who can reach the URL is admin). Before
 * sharing a deployment, enable OIDC — see the commented block below and
 * https://trueforge.dev/authentication/overview
 */
import { defineRailway, github, group, postgres, project, redis, service } from 'railway/iac';

export default defineRailway(_ctx => {
  const db = postgres('Postgres');
  const cache = redis('Redis');

  const app = service('trueforge', {
    // Deploys from this repository's default branch. Forks: change owner/repo
    // (and optionally branch) to build your own copy.
    source: github('truefoundry/trueforge'),
    // From-source image (root Dockerfile needs APP_VERSION for the npm-install recipe).
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile.dev',
    },
    healthcheck: '/healthz',
    healthcheckTimeout: 300,
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
      // Above GRACEFUL_TIMEOUT_SECONDS (30) so SIGKILL does not cut off turn drain.
      drainingSeconds: 35,
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      // Expanded by Railway at runtime once a public domain exists on this service.
      PUBLIC_BASE_URL: 'https://${{RAILWAY_PUBLIC_DOMAIN}}',

      // Optional OIDC (login off until these are set). Create matching *shared*
      // variables on the Railway environment, uncomment, then `railway config apply`.
      //
      // OIDC_ISSUER_URL: _ctx.shared.OIDC_ISSUER_URL,
      // OIDC_CLIENT_ID: _ctx.shared.OIDC_CLIENT_ID,
      // OIDC_CLIENT_SECRET: _ctx.shared.OIDC_CLIENT_SECRET,
      // OIDC_USER_REFERENCE_CLAIM: 'email',
      // OIDC_SCOPES: 'openid,profile,email',
      // OIDC_USER_ROLE_CLAIM: 'email',
      // OIDC_ADMIN_ROLE_VALUE: 'you@example.com',
    },
  });

  return project('trueforge', {
    resources: [group('TrueForge', [db, cache, app])],
  });
});
