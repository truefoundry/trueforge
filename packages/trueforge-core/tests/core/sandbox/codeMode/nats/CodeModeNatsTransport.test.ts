import { createNatsConnectionOptions } from '../../../../../src/core/sandbox/codeMode/nats/CodeModeNatsTransport';

describe('CodeModeNatsTransport WebSocket connection options', () => {
  it('binds provider headers to the WebSocket factory for that resolved host', async () => {
    let upgrade: { url: string; headers: Record<string, string> } | undefined;
    const options = createNatsConnectionOptions(
      {
        url: 'wss://sandbox-a.e2b.test',
        webSocketHeaders: { 'E2B-Traffic-Access-Token': 'traffic-for-sandbox-a' },
      },
      params => {
        upgrade = params;
        throw new Error('Socket construction stopped by test');
      },
    );
    const webSocketFactory = options.wsFactory;
    if (webSocketFactory === undefined) {
      throw new Error('Expected an authenticated WebSocket factory');
    }

    await expect(webSocketFactory('wss://sandbox-a.e2b.test')).rejects.toThrow('stopped by test');
    expect(upgrade).toEqual({
      url: 'wss://sandbox-a.e2b.test',
      headers: { 'E2B-Traffic-Access-Token': 'traffic-for-sandbox-a' },
    });
  });

  it('leaves Daytona signed-preview connections on the default WebSocket path', () => {
    const options = createNatsConnectionOptions({
      url: 'wss://signed-preview.daytona.test',
      webSocketHeaders: undefined,
    });

    expect(options.servers).toEqual(['wss://signed-preview.daytona.test']);
    expect(options.wsFactory).toBeUndefined();
  });
});
