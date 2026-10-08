/**
 * Versioning helpers for sandbox environments: stored manifest shape, diff,
 * and buildNextVersion (no DB writes — store create/update persist the row).
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES,
  StoredSandboxEnvironmentManifestSchema,
  type SandboxEnvironmentManifest,
  type SandboxEnvironmentVersionStatus,
  type StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export type SandboxEnvironmentProviderType = StoredSandboxEnvironmentManifest['type'];

export interface ManifestDiff {
  build_changed: boolean;
  resources_changed: boolean;
}

/** Next version row fields (status/external_ref encode whether a future controller must build). */
export interface NextSandboxEnvironmentVersion {
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionStatus;
  status_reason: null;
  external_ref: string;
}

/** System default env stored jsonb (platform image; no networking/secrets). */
export function defaultSandboxEnvironmentStoredManifest(
  provider_type: SandboxEnvironmentProviderType,
): StoredSandboxEnvironmentManifest {
  return StoredSandboxEnvironmentManifestSchema.parse({
    name: DEFAULT_SANDBOX_ENVIRONMENT_NAME,
    resources: DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES,
    type: provider_type,
    sandbox_provider: provider_type,
  });
}

/** Merge redacted keep-as-is stand-ins with previously stored secret values (sandbox-provider style). */
export function resolveManifestSecrets({
  manifest,
  previous,
}: {
  manifest: SandboxEnvironmentManifest;
  previous?: StoredSandboxEnvironmentManifest;
}): SandboxEnvironmentManifest {
  const secrets = manifest.networking?.secrets;
  if (!secrets) {
    return manifest;
  }
  const previousByEnv = new Map((previous?.networking?.secrets ?? []).map(secret => [secret.env, secret.value]));
  return {
    ...manifest,
    networking: {
      ...manifest.networking,
      secrets: secrets.map(secret => ({
        ...secret,
        value: resolveStoredSecretValue({
          incoming: secret.value,
          existing: previousByEnv.get(secret.env),
        }),
      })),
    },
  };
}

/** Mask secret values for API responses. */
export function redactManifestSecrets(manifest: SandboxEnvironmentManifest): SandboxEnvironmentManifest {
  const secrets = manifest.networking?.secrets;
  if (!secrets) {
    return manifest;
  }
  return {
    ...manifest,
    networking: {
      ...manifest.networking,
      secrets: secrets.map(secret => ({
        ...secret,
        value: toRedactedSecretValue(secret.value),
      })),
    },
  };
}

/** Fill backend-only type/sandbox_provider for jsonb storage. */
export function toStoredManifest({
  manifest,
  provider_type,
}: {
  manifest: SandboxEnvironmentManifest;
  provider_type: SandboxEnvironmentProviderType;
}): StoredSandboxEnvironmentManifest {
  return {
    ...manifest,
    type: provider_type,
    sandbox_provider: provider_type,
  };
}

export function diffManifest({
  previous,
  next,
}: {
  previous: StoredSandboxEnvironmentManifest | undefined;
  next: SandboxEnvironmentManifest;
}): ManifestDiff {
  return {
    build_changed: previous?.image?.build_script !== next.image?.build_script,
    resources_changed: previous === undefined || !isDeepStrictEqual(previous.resources, next.resources),
  };
}

/** Opaque Daytona snapshot name for an environment version. */
export function newExternalRef(): string {
  return `trueforge-${randomUUID()}`;
}

function withoutDescription(
  manifest: StoredSandboxEnvironmentManifest,
): Omit<StoredSandboxEnvironmentManifest, 'description'> {
  const { description, ...rest } = manifest;
  void description;
  return rest;
}

/** Next version row, or `undefined` when the resolved manifest matches the tip (description ignored). */
export function buildNextVersion({
  existing_version,
  existing_status,
  previous_manifest,
  previous_external_ref,
  manifest,
  provider_type,
  force_new_version,
}: {
  existing_version?: number;
  existing_status?: SandboxEnvironmentVersionStatus;
  previous_manifest?: StoredSandboxEnvironmentManifest;
  previous_external_ref?: string;
  manifest: SandboxEnvironmentManifest;
  provider_type: SandboxEnvironmentProviderType;
  /** API-key rotation still appends a pending version of the same manifest. */
  force_new_version?: boolean;
}): NextSandboxEnvironmentVersion | undefined {
  const resolved = resolveManifestSecrets({
    manifest,
    ...(previous_manifest ? { previous: previous_manifest } : {}),
  });
  const stored = toStoredManifest({ manifest: resolved, provider_type });
  const unchanged =
    previous_manifest !== undefined &&
    isDeepStrictEqual(withoutDescription(previous_manifest), withoutDescription(stored));
  if (unchanged && existing_status !== 'failed' && force_new_version !== true) {
    return undefined;
  }

  const diff = diffManifest({ previous: previous_manifest, next: resolved });
  // Daytona bakes cpu/memory/disk into the snapshot; resource or build changes need a new ref.
  // Env vars / networking apply at create time and can reuse previous_external_ref.
  // A failed snapshot must not be reused or the retry is marked failed immediately.
  const needs_snapshot =
    !previous_external_ref || diff.build_changed || diff.resources_changed || existing_status === 'failed';
  const external_ref = needs_snapshot || previous_external_ref === undefined ? newExternalRef() : previous_external_ref;

  return {
    version: (existing_version ?? 0) + 1,
    manifest: stored,
    status: 'pending',
    status_reason: null,
    external_ref,
  };
}
