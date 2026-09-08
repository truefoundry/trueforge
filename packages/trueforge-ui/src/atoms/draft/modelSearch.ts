import type { ModelSelection } from '../../server/types.js';

export function normalizeModelSearchText(value: string): string {
  return value.toLowerCase().replace(/[-_\s]/g, '');
}

export function providerMatchesQuery({ providerName, needle }: { providerName: string; needle: string }): boolean {
  return normalizeModelSearchText(providerName).includes(needle);
}

export function modelMatchesQuery({ model, needle }: { model: ModelSelection; needle: string }): boolean {
  return (
    normalizeModelSearchText(model.name).includes(needle) ||
    normalizeModelSearchText(model.id).includes(needle) ||
    providerMatchesQuery({ providerName: model.provider.name, needle })
  );
}
