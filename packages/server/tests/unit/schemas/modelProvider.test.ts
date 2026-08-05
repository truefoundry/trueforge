import { VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/utils-core/core';
import { ModelProviderManifestObjectSchema, PROVIDER_DEFAULT_BASE_URLS } from '../../../src/schemas/modelProvider';

const models = [{ model_id: 'a-model', name: 'a-model', properties: {} }];

function parses(body: Record<string, unknown>): boolean {
  return ModelProviderManifestObjectSchema.safeParse({ auth: { api_key: 'k' }, models, ...body }).success;
}

describe('ModelProviderManifestObjectSchema', () => {
  // The `satisfies` on the two type lists rejects a name with no adapter, but not an adapter left
  // out of both lists. That omission is what once left most of the catalog unconfigurable.
  it('can configure every adapter the harness can build', () => {
    const rejected = VERCEL_AI_PROVIDER_NAMES.filter(type => !parses({ type, base_url: 'https://example.com/v1' }));
    expect(rejected).toEqual([]);
  });

  // Omitting base_url is only safe when something downstream supplies one, otherwise
  // buildLanguageModel throws at turn time instead of the API rejecting the config.
  it('only allows omitting base_url where an endpoint is known', () => {
    for (const type of VERCEL_AI_PROVIDER_NAMES) {
      const dedicatedAdapter = ['openai', 'anthropic', 'google-gemini'].includes(type);
      const hasEndpoint = dedicatedAdapter || PROVIDER_DEFAULT_BASE_URLS[type] !== undefined;
      expect([type, parses({ type })]).toEqual([type, hasEndpoint]);
    }
  });

  // An effort the adapter cannot map is dropped on the way to the provider, so a session that
  // requests it runs at the provider default and reports success.
  it('rejects a reasoning effort no adapter can honour', () => {
    const withEfforts = (efforts: string[]): boolean =>
      parses({
        type: 'anthropic',
        models: [{ model_id: 'a-model', name: 'a-model', properties: { reasoning_efforts: efforts } }],
      });
    expect(withEfforts(['low', 'medium', 'high', 'max'])).toBe(true);
    expect(withEfforts(['ultra'])).toBe(false);
  });
});
