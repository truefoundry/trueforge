/**
 * assistant-ui `data` part name for a model response the provider cut short. Emitted when a
 * model message finishes as `incomplete`, so the reader knows the answer above it may be partial
 * even though the turn itself succeeded.
 */
export const INCOMPLETE_RESPONSE_DATA_NAME = 'model.incomplete_response';
