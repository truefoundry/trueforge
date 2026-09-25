/**
 * Provider model discovery with fetch stubbed (same pattern as the MCP OAuth tests).
 * Covers the two response shapes — Gemini's native list and the OpenAI-compatible one —
 * plus the failure paths the route maps onto 501 and 502.
 */
import {
  ModelDiscoveryError,
  ModelDiscoveryUnsupportedError,
  discoverProviderModels,
} from '../../../src/modelDiscovery/discoverProviderModels';
import type { ModelProviderManifest } from '../../../src/schemas/modelProvider';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Captures the URL and headers the module requested, so key placement is asserted, not assumed.
 * `makeResponse` runs per call: a Response body reads only once, so every call needs a fresh one.
 */
function stubFetch(makeResponse: () => Response): { calls: { url: string; headers: HeadersInit }[] } {
  const calls: { url: string; headers: HeadersInit }[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), headers: init?.headers ?? {} });
    return makeResponse();
  }) as typeof globalThis.fetch;
  return { calls };
}

/** Resolves to whatever the call threw, so one rejection can be asserted from several angles. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to reject, but it resolved');
    },
    (error: unknown) => error,
  );
}

const geminiManifest = {
  type: 'google-gemini',
  base_url: 'https://generativelanguage.googleapis.com/v1beta',
  auth: { api_key: 'test-key' },
  models: [{ model_id: 'gemini-1.0', name: 'gemini-1-0', properties: {} }],
} as unknown as ModelProviderManifest;

const openAiManifest = {
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
  auth: { api_key: 'test-key' },
  models: [{ model_id: 'gpt-x', name: 'gpt-x', properties: {} }],
} as unknown as ModelProviderManifest;

describe('discoverProviderModels', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('google-gemini', () => {
    it('maps token limits onto model properties', async () => {
      stubFetch(() =>
        json({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              supportedGenerationMethods: ['generateContent'],
              inputTokenLimit: 1048576,
              outputTokenLimit: 65536,
            },
          ],
        }),
      );

      const { models } = await discoverProviderModels(geminiManifest);

      expect(models).toEqual([{ model_id: 'gemini-3.8-flash', context_length: 1048576, max_output_tokens: 65536 }]);
    });

    it('skips models that cannot serve generateContent', async () => {
      stubFetch(() =>
        json({
          models: [
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      );

      const { models } = await discoverProviderModels(geminiManifest);

      expect(models.map(model => model.model_id)).toEqual(['gemini-3.8-flash']);
    });

    it('omits limits the provider does not report rather than inventing them', async () => {
      stubFetch(() =>
        json({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              supportedGenerationMethods: ['generateContent'],
              inputTokenLimit: 0,
              outputTokenLimit: 'not-a-number',
            },
          ],
        }),
      );

      const { models } = await discoverProviderModels(geminiManifest);

      expect(models).toEqual([{ model_id: 'gemini-3.8-flash' }]);
    });

    it('sends the key as a query parameter, not a bearer header', async () => {
      const stub = stubFetch(() => json({ models: [] }));

      await discoverProviderModels(geminiManifest);

      expect(stub.calls[0]?.url).toContain('key=test-key');
      expect(stub.calls[0]?.headers).toEqual({});
    });
  });

  describe('openai-compatible', () => {
    it('returns ids with no properties, since the shape carries no limits', async () => {
      stubFetch(() => json({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }));

      const { models } = await discoverProviderModels(openAiManifest);

      expect(models).toEqual([{ model_id: 'gpt-5' }, { model_id: 'gpt-5-mini' }]);
    });

    it('sends the key as a bearer header, keeping it out of the URL', async () => {
      const stub = stubFetch(() => json({ data: [] }));

      await discoverProviderModels(openAiManifest);

      expect(stub.calls[0]?.headers).toEqual({ Authorization: 'Bearer test-key' });
      expect(stub.calls[0]?.url).not.toContain('test-key');
    });
  });

  describe('failures', () => {
    it('surfaces the provider status and body on a rejected request', async () => {
      stubFetch(() => new Response('bad key', { status: 403 }));

      const error = await rejection(discoverProviderModels(geminiManifest));

      expect(error).toBeInstanceOf(ModelDiscoveryError);
      expect((error as Error).message).toMatch(/403.*bad key/s);
    });

    it('rejects a payload whose model list is missing', async () => {
      stubFetch(() => json({ notModels: [] }));

      const error = await rejection(discoverProviderModels(geminiManifest));

      expect((error as Error).message).toMatch(/did not contain a model list/);
    });

    it('reports an unreachable provider rather than throwing raw', async () => {
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });

      const error = await rejection(discoverProviderModels(geminiManifest));

      expect((error as Error).message).toMatch(/Could not reach the provider/);
    });

    it('refuses to call out when no API key is stored', async () => {
      const manifest = { ...geminiManifest, auth: { api_key: '' } } as unknown as ModelProviderManifest;

      const error = await rejection(discoverProviderModels(manifest));

      expect((error as Error).message).toMatch(/no stored API key/);
    });

    it('marks truefoundry unsupported, since its endpoint is resolved at runtime', async () => {
      const manifest = {
        type: 'truefoundry',
        base_url: 'https://gateway.example.com',
        auth: { api_key: 'test-key' },
        models: [],
      } as unknown as ModelProviderManifest;

      const error = await rejection(discoverProviderModels(manifest));

      expect(error).toBeInstanceOf(ModelDiscoveryUnsupportedError);
    });
  });
});
