import { EVENT_TYPE, type ThreadSwitchModelEvent } from './server/index.js';

export function isThreadSwitchModelEvent(value: unknown): value is ThreadSwitchModelEvent {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  if (!('type' in value) || value.type !== EVENT_TYPE.THREAD_SWITCH_MODEL) {
    return false;
  }
  if (!('model' in value) || value.model == null || typeof value.model !== 'object') {
    return false;
  }
  return 'name' in value.model && typeof value.model.name === 'string';
}
