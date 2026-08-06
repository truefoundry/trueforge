import { VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/utils-core/core';
import { ModelProviderSchema } from '../../../src/schemas/modelProvider';

const models = [{ model_id: 'a-model', name: 'a-model', properties: {} }];

function parse(body: Record<string, unknown>): { success: boolean; name?: string; base_url?: string } {
  const result = ModelProviderSchema.safeParse({ auth: { api_key: 'k' }, models, ...body });
  return result.success
    ? { success: true, name: result.data.name, base_url: result.data.base_url }
    : { success: false };
}

/** A custom endpoint is arbitrary, so there is nothing to default to. */
const TYPES_WITHOUT_DEFAULT_BASE_URL = ['custom'];

describe('ModelProviderSchema', () => {
  // A type with no schema of its own leaves its catalog entries unconfigurable.
  it('can configure every adapter the harness can build', () => {
    const rejected = VERCEL_AI_PROVIDER_NAMES.filter(
      type => !parse({ type, name: type, base_url: 'https://example.com/v1' }).success,
    );
    expect(rejected).toEqual([]);
  });

  // A named endpoint keeps buildLanguageModel off its adapter's implicit default.
  it('defaults base_url for every type that has a known endpoint', () => {
    for (const type of VERCEL_AI_PROVIDER_NAMES) {
      const parsed = parse({ type });
      if (TYPES_WITHOUT_DEFAULT_BASE_URL.includes(type)) {
        expect([type, parsed.success]).toEqual([type, false]);
      } else {
        expect([type, parsed.base_url]).toEqual([type, expect.stringMatching(/^https:\/\//)]);
      }
    }
  });

  it('keeps a caller-supplied base_url over the default', () => {
    expect(parse({ type: 'openai', base_url: 'https://gateway.internal/v1' }).base_url).toBe(
      'https://gateway.internal/v1',
    );
  });

  // Pinning the name to the type is what makes a second write replace the first.
  it('names every type but custom after itself', () => {
    expect(parse({ type: 'anthropic' }).name).toBe('anthropic');
    expect(parse({ type: 'anthropic', name: 'anthropic' }).name).toBe('anthropic');
    expect(parse({ type: 'anthropic', name: 'anthropic-eu' }).success).toBe(false);
  });

  it('requires a caller-supplied name for custom providers', () => {
    const base = { type: 'custom', base_url: 'https://llm.internal/v1' };
    expect(parse({ ...base, name: 'internal' }).name).toBe('internal');
    expect(parse(base).success).toBe(false);
  });

  // An unmappable effort is dropped on the way out, so the session silently runs at the default.
  it('rejects a reasoning effort no adapter can honour', () => {
    const withEfforts = (efforts: string[]): boolean =>
      parse({
        type: 'anthropic',
        models: [{ model_id: 'a-model', name: 'a-model', properties: { reasoning_efforts: efforts } }],
      }).success;
    expect(withEfforts(['low', 'medium', 'high', 'max'])).toBe(true);
    expect(withEfforts(['ultra'])).toBe(false);
  });
});
