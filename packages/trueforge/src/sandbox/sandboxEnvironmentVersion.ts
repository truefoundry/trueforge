/**
 * Versioning helpers for sandbox environments: stored manifest shape, diff,
 * and buildNextVersion (no DB writes — store create/update persist the row).
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  DEFAULT_SANDBOX_ENVIRONMENT_RESOURCES,
  SandboxEnvironmentVersionInternalMetadataSchema,
  StoredSandboxEnvironmentManifestSchema,
  type SandboxEnvironmentManifest,
  type SandboxEnvironmentVersionInternalMetadata,
  type SandboxEnvironmentVersionStatus,
  type StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { isRedactedSecretValue, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export type SandboxEnvironmentProviderType = StoredSandboxEnvironmentManifest['type'];

export interface ManifestDiff {
  build_changed: boolean;
  resources_changed: boolean;
  /** Request includes at least one non-redacted secret value (new material to sync). */
  secrets_changed: boolean;
}

/** Next version row fields (status/external_ref encode whether a future controller must build). */
export interface NextSandboxEnvironmentVersion {
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionStatus;
  status_reason: null;
  external_ref: string;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
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
    secrets_changed: (next.networking?.secrets ?? []).some(secret => !isRedactedSecretValue(secret.value)),
  };
}

/** Opaque Daytona snapshot name for an environment version. */
export function newExternalRef(): string {
  return `trueforge-${randomUUID()}`;
}

/** Build the next version row fields (no insert). Secrets / Daytona sync intentionally skipped. */
export function buildNextVersion({
  version,
  previous_manifest,
  previous_external_ref,
  manifest,
  provider_type,
}: {
  version: number;
  previous_manifest?: StoredSandboxEnvironmentManifest;
  previous_external_ref?: string;
  manifest: SandboxEnvironmentManifest;
  provider_type: SandboxEnvironmentProviderType;
}): NextSandboxEnvironmentVersion {
  const diff = diffManifest({ previous: previous_manifest, next: manifest });
  // Daytona bakes cpu/memory/disk into the snapshot; resource or build changes need a new ref.
  // Env vars / networking apply at create time and can reuse previous_external_ref.
  const needs_snapshot = !previous_external_ref || diff.build_changed || diff.resources_changed;

  const resolved = resolveManifestSecrets({
    manifest,
    ...(previous_manifest ? { previous: previous_manifest } : {}),
  });

  // Always `pending` until a future controller activates (or fails) the version.
  return {
    version,
    manifest: toStoredManifest({ manifest: resolved, provider_type }),
    status: 'pending',
    status_reason: null,
    external_ref: needs_snapshot ? newExternalRef() : previous_external_ref,
    internal_metadata: SandboxEnvironmentVersionInternalMetadataSchema.parse({}),
  };
}
