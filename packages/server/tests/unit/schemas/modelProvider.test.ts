import { VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/trueforge-core/core';
import { ModelProviderManifestSchema, modelProviderName } from '../../../src/schemas/modelProvider';

const models = [{ model_id: 'a-model', name: 'a-model', properties: {} }];

function parse(body: Record<string, unknown>): { success: boolean; name?: string; base_url?: string } {
  const result = ModelProviderManifestSchema.safeParse({ auth: { api_key: 'k' }, models, ...body });
  return result.success
    ? { success: true, name: modelProviderName(result.data), base_url: result.data.base_url }
    : { success: false };
}

/** A custom endpoint is arbitrary, so there is nothing to default to, and nothing to name it after. */
const CALLER_SUPPLIED_TYPES = ['custom'];

/** Only `custom` takes a name; the others reject one, so fixtures name just that type. */
function providerFor(type: string, body: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, ...(CALLER_SUPPLIED_TYPES.includes(type) ? { name: 'internal' } : {}), ...body };
}

describe('ModelProviderManifestSchema', () => {
  // A type with no schema of its own leaves its catalog entries unconfigurable.
  it('can configure every adapter the harness can build', () => {
    const rejected = VERCEL_AI_PROVIDER_NAMES.filter(
      type => !parse(providerFor(type, { base_url: 'https://example.com/v1' })).success,
    );
    expect(rejected).toEqual([]);
  });

  // A named endpoint keeps buildLanguageModel off its adapter's implicit default.
  it('defaults base_url for every type that has a known endpoint', () => {
    for (const type of VERCEL_AI_PROVIDER_NAMES) {
      const parsed = parse(providerFor(type));
      if (CALLER_SUPPLIED_TYPES.includes(type)) {
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

  // Deriving the name is what makes a second write replace the first, so the body cannot carry one.
  it('names every type but custom after itself, and takes no name from the caller', () => {
    expect(parse({ type: 'anthropic' }).name).toBe('anthropic');
    expect(parse({ type: 'anthropic', name: 'anthropic' }).success).toBe(false);
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
