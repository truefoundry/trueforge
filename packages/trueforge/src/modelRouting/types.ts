export const MODEL_ROUTING_MODES = ['off', 'on'] as const;

export type ModelRoutingMode = (typeof MODEL_ROUTING_MODES)[number];
