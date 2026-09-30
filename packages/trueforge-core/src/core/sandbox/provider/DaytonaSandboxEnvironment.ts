import type { Snapshot } from '@daytona/sdk';
import { Daytona, DaytonaError } from '@daytona/sdk';
import type { Logger } from 'winston';
import { SANDBOX_IMAGE_URI } from '../sandboxImage';
import type { SandboxBuild, SandboxEnvironment } from './Provider';

const SANDBOX_NOT_FOUND_STATUS = 404;
/** Another replica already registered this build name; its create is the one that counts. */
const SNAPSHOT_CONFLICT_STATUS = 409;

const BUILD_STATE_ACTIVE = 'active';
const BUILD_STATE_ERROR = 'error';
const BUILD_STATE_BUILD_FAILED = 'build_failed';

/** getBuildStatus reason when this environment has never been registered with Daytona. */
export const DAYTONA_SNAPSHOT_NOT_STARTED_REASON = 'Sandbox image build not started.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Credentials + client the environment needs to register/poll its snapshot. */
export interface DaytonaProviderContext {
  client: Daytona;
  apiKey: string;
  apiUrl: string;
  logger: Logger;
}

export interface DaytonaSandboxEnvironmentOptions {
  /** Daytona snapshot name to build or clone from (persisted env-version external_ref). */
  snapshot_ref: string;
  /**
   * Base container image the snapshot is built from. Defaults to the release sandbox image.
   */
  image_uri?: string | undefined;
  resources: {
    cpu: number;
    memory: number;
    disk: number;
  };
  image?:
    | {
        type: 'build';
        build_script?: string | undefined;
      }
    | undefined;
  environment_variables?: Record<string, string> | undefined;
  /**
   * Daytona networking modes are mutually exclusive
   * (`network_block_all` vs `domain_allow_list`).
   */
  networking?:
    | {
        network_block_all?: boolean | undefined;
        domain_allow_list?: string | undefined;
        secrets?:
          | {
              env: string;
              value: string;
              hosts: string[];
            }[]
          | undefined;
      }
    | undefined;
}

/**
 * Daytona create/build environment — peer class to DaytonaSandboxProvider.
 * Owns snapshot registration/progress; provider supplies credentials via DaytonaProviderContext.
 */
export class DaytonaSandboxEnvironment implements SandboxEnvironment {
  readonly type = 'daytona';
  readonly snapshot_ref: string;
  readonly image_uri: string;
  readonly resources: DaytonaSandboxEnvironmentOptions['resources'];
  readonly image: DaytonaSandboxEnvironmentOptions['image'];
  readonly environment_variables: DaytonaSandboxEnvironmentOptions['environment_variables'];
  readonly networking: DaytonaSandboxEnvironmentOptions['networking'];

  constructor(options: DaytonaSandboxEnvironmentOptions) {
    this.snapshot_ref = options.snapshot_ref;
    this.image_uri = options.image_uri ?? SANDBOX_IMAGE_URI;
    this.resources = options.resources;
    this.image = options.image;
    this.environment_variables = options.environment_variables;
    this.networking = options.networking;
  }

  /** Params applied on fresh Daytona create (not restore). */
  runtimeCreateParams(): {
    envVars?: Record<string, string>;
    networkBlockAll?: boolean;
    domainAllowList?: string;
  } {
    const networking = this.networking;
    return {
      ...(this.environment_variables ? { envVars: this.environment_variables } : {}),
      ...(networking?.network_block_all ? { networkBlockAll: networking.network_block_all } : {}),
      ...(networking?.domain_allow_list ? { domainAllowList: networking.domain_allow_list } : {}),
    };
  }

  private toBuild({ state, errorReason }: { state: string; errorReason: string | null }): SandboxBuild {
    const metadata = { build_ref: this.snapshot_ref, image_uri: this.image_uri };
    switch (state) {
      case BUILD_STATE_ACTIVE:
        return { status: 'ready', reason: null, metadata };
      case BUILD_STATE_ERROR:
      case BUILD_STATE_BUILD_FAILED:
        return { status: 'failed', reason: errorReason ?? `Sandbox image build failed (${state}).`, metadata };
      default:
        return { status: 'pending', reason: `Sandbox image build in progress (${state}).`, metadata };
    }
  }

  /** Resolves undefined when no snapshot carries that name; auth/other failures throw. */
  private async getSnapshot(ctx: DaytonaProviderContext): Promise<Snapshot | undefined> {
    try {
      return await ctx.client.snapshot.get(this.snapshot_ref);
    } catch (error) {
      if (error instanceof DaytonaError && error.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Dockerfile that layers `build_script` onto the release base image.
   * JSON-array RUN keeps the script bytes intact (newlines, quotes) without shell-escaping hell.
   */
  private dockerfileFromBuildScript(buildScript: string): string {
    return `FROM ${this.image_uri}\nRUN ["bash", "-lc", ${JSON.stringify(buildScript)}]`;
  }

  /** Body for POST /snapshots — imageName XOR buildInfo (Daytona mutual exclusion). */
  private createSnapshotBody(): {
    name: string;
    cpu: number;
    memory: number;
    disk: number;
    imageName?: string;
    buildInfo?: { dockerfileContent: string };
  } {
    const body: {
      name: string;
      cpu: number;
      memory: number;
      disk: number;
      imageName?: string;
      buildInfo?: { dockerfileContent: string };
    } = {
      name: this.snapshot_ref,
      cpu: this.resources.cpu,
      memory: this.resources.memory,
      disk: this.resources.disk,
    };
    const buildScript = this.image?.type === 'build' ? this.image.build_script : undefined;
    if (buildScript !== undefined && buildScript.length > 0) {
      body.buildInfo = { dockerfileContent: this.dockerfileFromBuildScript(buildScript) };
    } else {
      body.imageName = this.image_uri;
    }
    return body;
  }

  /**
   * Registers the snapshot and returns its initial state without waiting for the build.
   *
   * The SDK's `snapshot.create` issues this same POST and then polls until the snapshot is active
   * or failed (minutes on a cold image pull). Progress only needs the registration result, so
   * credential errors surface on the request while build progress stays observable via get.
   */
  private async registerSnapshot(ctx: DaytonaProviderContext): Promise<{ state: string; errorReason: string | null }> {
    let response: Response;
    try {
      response = await fetch(`${ctx.apiUrl}/snapshots`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.createSnapshotBody()),
      });
    } catch (error) {
      throw new Error('Daytona snapshot registration request failed.', { cause: error });
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        isRecord(body) && typeof body['message'] === 'string'
          ? body['message']
          : `Daytona snapshot registration failed (${String(response.status)})`;
      throw new DaytonaError(message, response.status);
    }
    if (!isRecord(body) || typeof body['state'] !== 'string') {
      throw new DaytonaError("Failed to register snapshot. Daytona didn't return a snapshot state.");
    }
    return {
      state: body['state'],
      errorReason: typeof body['errorReason'] === 'string' ? body['errorReason'] : null,
    };
  }

  /**
   * Registers this environment's snapshot. Does not wait for the build to finish.
   * Callers that are polling should use getBuildStatus; only call build when not started.
   */
  async build(ctx: DaytonaProviderContext): Promise<SandboxBuild> {
    try {
      const registered = await this.registerSnapshot(ctx);
      return this.toBuild({ state: registered.state, errorReason: registered.errorReason });
    } catch (error) {
      // A losing concurrent create is not a build failure: read whatever the winner registered.
      if (error instanceof DaytonaError && error.statusCode === SNAPSHOT_CONFLICT_STATUS) {
        ctx.logger.info(`Daytona snapshot already created concurrently: name=${this.snapshot_ref}`);
        return this.getBuildStatus(ctx);
      }
      throw error;
    }
  }

  /** Current build status for this environment. Read-only: never kicks off a build. */
  async getBuildStatus(ctx: DaytonaProviderContext): Promise<SandboxBuild> {
    const snapshot = await this.getSnapshot(ctx);
    if (!snapshot) {
      return {
        status: 'pending',
        reason: DAYTONA_SNAPSHOT_NOT_STARTED_REASON,
        metadata: { build_ref: this.snapshot_ref, image_uri: this.image_uri },
      };
    }
    return this.toBuild({ state: snapshot.state, errorReason: snapshot.errorReason });
  }
}

export function isDaytonaSandboxEnvironment(environment: SandboxEnvironment): environment is DaytonaSandboxEnvironment {
  return environment instanceof DaytonaSandboxEnvironment;
}
