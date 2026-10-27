import configuration from '../../config';

export function getTrueForgePostgresSchema(): string {
  if (configuration.STANDALONE) {
    throw new Error('unreachable');
  }
  return configuration.POSTGRES_SCHEMA;
}
