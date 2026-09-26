/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Handlers return properly shaped dummy data; no DB persistence yet.
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
    domain_allow_list: 'api.github.com,api.openai.com',
    network_block_all: false,
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
      build_ref: 'trueforge-build-example',
      metadata: { secrets_map: [] },
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
  const raw = await c.req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(c, parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

/** Dummy CRUD for sandbox environments. */
export function createSandboxEnvironmentsRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  router.get('/', c => {
    return c.json({
      data: [dummyEnvironment()],
      pagination: { limit: PAGE_LIMIT },
    });
  });

  router.get('/:sandbox_environment_id', c => {
    return c.json({ data: dummyEnvironment() });
  });

  router.post('/', async c => {
    const body = await validateJsonBody(c, CreateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    return c.json({ data: dummyEnvironment(body.data.manifest) }, 201);
  });

  router.put('/:sandbox_environment_id', async c => {
    const body = await validateJsonBody(c, UpdateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    return c.json({ data: dummyEnvironment(body.data.manifest) });
  });

  router.delete('/:sandbox_environment_id', c => {
    return c.json({});
  });

  return router;
}
