/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Handlers return properly shaped dummy data; no DB persistence yet.
 * OpenAPI / Fern registration intentionally deferred.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { PAGE_LIMIT } from '../schemas/common';
import {
  CreateSandboxEnvironmentRequestSchema,
  UpdateSandboxEnvironmentRequestSchema,
  type SandboxEnvironment,
  type SandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { zodErrorResponse } from '../zodErrorResponse';

const DUMMY_CREATED_AT = '2026-09-26T00:00:00.000Z';

const DUMMY_BASE_MANIFEST: SandboxEnvironmentManifest = {
  name: 'xyz',
  description: 'my-env',
  image: {
    type: 'build',
    build_script: 'set -ex\npip install httpx\n',
  },
  resources: { cpu: 1, memory: 1, disk: 3 },
  environment_variables: { FOO: 'bar' },
  networking: {
    network_block_all: false,
    domain_allow_list: 'api.github.com,api.openai.com',
    secrets: [{ env: 'GITHUB_TOKEN', value: '*****', hosts: ['api.github.com'] }],
  },
};

function dummyEnvironment(manifest: SandboxEnvironmentManifest = DUMMY_BASE_MANIFEST): SandboxEnvironment {
  return {
    id: '01HZXAMPLE0000000000000000',
    name: manifest.name,
    description: manifest.description ?? '',
    active_version: 1,
    lifecycle_stage: 'active',
    manifest,
    version: {
      version: 1,
      status: 'active',
      status_reason: null,
      external_ref: 'trueforge-build-example',
    },
    created_by_subject: {
      subject_id: 'dummy-user',
      subject_type: 'user',
      subject_display_name: 'Dummy User',
    },
    created_at: DUMMY_CREATED_AT,
    updated_at: DUMMY_CREATED_AT,
  };
}

async function validateJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const raw: unknown = await c.req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(c, parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

/** Dummy CRUD for sandbox environments (no OpenAPI registration yet). */
export function createSandboxEnvironmentsRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  router.get('/', c => {
    return c.json({
      data: [dummyEnvironment()],
      pagination: { limit: PAGE_LIMIT },
    });
  });

  router.get('/:name', c => {
    return c.json({ data: dummyEnvironment() });
  });

  router.post('/', async c => {
    const body = await validateJsonBody(c, CreateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    return c.json({ data: dummyEnvironment(body.data.manifest) }, 201);
  });

  router.put('/:name', async c => {
    const body = await validateJsonBody(c, UpdateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    return c.json({ data: dummyEnvironment(body.data.manifest) });
  });

  router.delete('/:name', c => {
    return c.json({});
  });

  return router;
}
