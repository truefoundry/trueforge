/**
 * Optional peer of @truefoundry/assistant-ui-runtime. The runtime main entry
 * re-exports the gateway adapter; Harness does not use it. Stub so Vite can
 * tree-shake the adapter without resolving truefoundry-gateway-sdk.
 */
function gatewaySdkMissing(): never {
  throw new Error('truefoundry-gateway-sdk is not installed in this app');
}

export const AgentSessionClient = gatewaySdkMissing;
export const PrivateAgentSessionClient = gatewaySdkMissing;
export const TruefoundryGatewayApi = gatewaySdkMissing;

export default TruefoundryGatewayApi;
