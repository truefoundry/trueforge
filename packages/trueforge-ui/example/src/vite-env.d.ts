/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TFY_API_KEY: string;
  readonly VITE_TFY_CONTROL_PLANE_URL: string;
  /** Optional — when omitted, TrueForgeUI resolves gateway from the control plane. */
  readonly VITE_TFY_GATEWAY_URL?: string;
  readonly VITE_TFY_AGENT_NAME: string;
  readonly VITE_TFY_AGENT_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
