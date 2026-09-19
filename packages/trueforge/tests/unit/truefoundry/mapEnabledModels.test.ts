import { mapEnabledModels, resolveCustomEndpointCall } from '../../../src/truefoundry/mapEnabledModels';

describe('resolveCustomEndpointCall', () => {
  const base = {
    gatewayUrl: 'https://gateway.truefoundry.ai',
    accountName: 'jev',
    endpointName: 'custom-endpoint',
    modelFqn: 'jev/custom-endpoint',
  };

  it('posts to the proxy root when the upstream URL already includes /chat/completions', () => {
    expect(
      resolveCustomEndpointCall({
        ...base,
        upstreamBaseUrl: 'https://api.siliconflow.com/v1/chat/completions',
      }),
    ).toEqual({
      kind: 'chat',
      baseUrl: 'https://gateway.truefoundry.ai/proxy-api/jev/custom-endpoint',
      chatCompletionsPath: '',
    });
  });

  it('appends /chat/completions when the upstream is an OpenAI /v1 root', () => {
    expect(
      resolveCustomEndpointCall({
        ...base,
        accountName: 'acme',
        endpointName: 'llama',
        modelFqn: 'acme/llama',
        gatewayUrl: 'https://internal.example/api/llm',
        upstreamBaseUrl: 'https://llm.internal.example/v1',
      }),
    ).toEqual({
      kind: 'chat',
      baseUrl: 'https://internal.example/api/llm/proxy-api/acme/llama',
      chatCompletionsPath: '/chat/completions',
    });
  });

  it('refuses TypeSafe Jev, whose API is POST /v1/systemone', () => {
    const call = resolveCustomEndpointCall({
      ...base,
      upstreamBaseUrl: 'https://api.typesafe.ai/v1',
    });
    expect(call.kind).toBe('unsupported');
    if (call.kind !== 'unsupported') {
      throw new Error('expected unsupported');
    }
    expect(call.message).toContain('POST /v1/systemone');
    expect(call.message).toContain('jev/custom-endpoint');
  });

  it('refuses a custom endpoint whose path is not chat completions', () => {
    const call = resolveCustomEndpointCall({
      ...base,
      upstreamBaseUrl: 'https://api.typesafe.ai.example/v1/systemone',
    });
    expect(call.kind).toBe('unsupported');
  });
});

describe('mapEnabledModels', () => {
  it('marks custom-endpoint integrations and keeps provider integrations on the unified API', () => {
    expect(
      mapEnabledModels({
        integrations: [
          {
            name: 'gpt-4o',
            type: 'integration/model/openai',
            manifest: { model_types: ['chat'] },
            providerAccount: { name: 'openai-main' },
          },
          {
            name: 'custom-endpoint',
            type: 'integration/model/custom-endpoint',
            manifest: {
              type: 'integration/model/custom-endpoint',
              model_types: ['chat'],
              base_url: 'https://api.typesafe.ai/v1/systemone',
            },
            providerAccount: { name: 'jev', manifest: { type: 'provider-account/custom-endpoint' } },
          },
        ],
      }),
    ).toEqual([
      {
        accountName: 'openai-main',
        modelName: 'gpt-4o',
        properties: {},
        endpointKind: 'provider',
        upstreamBaseUrl: undefined,
      },
      {
        accountName: 'jev',
        modelName: 'custom-endpoint',
        properties: {},
        endpointKind: 'custom-endpoint',
        upstreamBaseUrl: 'https://api.typesafe.ai/v1/systemone',
      },
    ]);
  });
});
