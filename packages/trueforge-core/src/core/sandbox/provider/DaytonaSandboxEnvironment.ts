import { SANDBOX_IMAGE_URI } from '../sandboxImage';

/** getBuildStatus reason when this environment has never been registered with Daytona. */
export const DAYTONA_SNAPSHOT_NOT_STARTED_REASON = 'Sandbox image build not started.';

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
  /** Env var → Daytona org secret name for create. */
  mounted_secrets?: Record<string, string> | undefined;
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

/** Plain Daytona create/build input (snapshot tip + create params). */
export interface DaytonaSandboxEnvironment {
  snapshot_ref: string;
  image_uri: string;
  resources: DaytonaSandboxEnvironmentOptions['resources'];
  image?: DaytonaSandboxEnvironmentOptions['image'];
  environment_variables?: DaytonaSandboxEnvironmentOptions['environment_variables'];
  mounted_secrets?: DaytonaSandboxEnvironmentOptions['mounted_secrets'];
  networking?: DaytonaSandboxEnvironmentOptions['networking'];
}

/** Apply defaults (e.g. release image) onto Daytona env options. */
export function createDaytonaSandboxEnvironment(options: DaytonaSandboxEnvironmentOptions): DaytonaSandboxEnvironment {
  return {
    snapshot_ref: options.snapshot_ref,
    image_uri: options.image_uri ?? SANDBOX_IMAGE_URI,
    resources: options.resources,
    ...(options.image !== undefined ? { image: options.image } : {}),
    ...(options.environment_variables !== undefined ? { environment_variables: options.environment_variables } : {}),
    ...(options.mounted_secrets !== undefined ? { mounted_secrets: options.mounted_secrets } : {}),
    ...(options.networking !== undefined ? { networking: options.networking } : {}),
  };
}
