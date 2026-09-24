import { HTTPException } from 'hono/http-exception';
import {
  buildGatewayMetadata,
  gatewayMetadataHeadersForTurn,
  mergeGatewayMetadata,
  parseGatewayMetadataHeader,
  TFG_METADATA_PREFIX,
  X_TFY_METADATA,
} from '../../../src/truefoundry/gatewayMetadata';

const AGENT = { id: 'agent-1', name: 'my-agent' };

describe('parseGatewayMetadataHeader', () => {
  it('parses a JSON object of string values', () => {
    expect(parseGatewayMetadataHeader(JSON.stringify({ env: 'prod', team: 'platform' }))).toEqual({
      env: 'prod',
      team: 'platform',
    });
  });

  it.each([
    ['not json', 'not-json'],
    ['an array', '[]'],
    ['a scalar', '"nope"'],
    ['a value that is not a string', JSON.stringify({ env: 1 })],
  ])('rejects %s rather than silently dropping caller metadata', (_case, raw) => {
    expect(() => parseGatewayMetadataHeader(raw)).toThrow(HTTPException);
  });

  it('keeps the parse failure as the cause, so a bad header can be debugged', () => {
    expect(() => parseGatewayMetadataHeader('not-json')).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
  });
});

describe('buildGatewayMetadata', () => {
  it('stamps session/turn/agent fields only', () => {
    expect(buildGatewayMetadata({ sessionId: 'sess-1', turnId: 'turn-1', agent: AGENT })).toEqual({
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'my-agent',
    });
  });

  it('omits agent fields when the session has no saved agent', () => {
    expect(buildGatewayMetadata({ sessionId: 'sess-1', turnId: 'turn-1' })).toEqual({
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
    });
  });
});

describe('mergeGatewayMetadata', () => {
  it('keeps requestMetadata keys and overwrites spoofed tfg.* fields so order is maintained', () => {
    expect(
      mergeGatewayMetadata({
        sessionId: 'sess-1',
        turnId: 'turn-1',
        agent: AGENT,
        requestMetadata: {
          env: 'prod',
          [`${TFG_METADATA_PREFIX}.session_id`]: 'spoofed-session',
          [`${TFG_METADATA_PREFIX}.turn_id`]: 'spoofed-turn',
          [`${TFG_METADATA_PREFIX}.agent_id`]: 'spoofed-agent',
          [`${TFG_METADATA_PREFIX}.agent_name`]: 'spoofed-name',
        },
      }),
    ).toEqual({
      env: 'prod',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'my-agent',
    });
  });

  it('matches harness-only stamps when requestMetadata is absent', () => {
    expect(mergeGatewayMetadata({ sessionId: 'sess-1', turnId: 'turn-1', agent: AGENT })).toEqual(
      buildGatewayMetadata({ sessionId: 'sess-1', turnId: 'turn-1', agent: AGENT }),
    );
  });
});

describe('gatewayMetadataHeadersForTurn', () => {
  it('reads x-tfy-metadata from the raw request headers', () => {
    const headers = gatewayMetadataHeadersForTurn({
      sessionId: 'sess-1',
      turnId: 'turn-1',
      agent: AGENT,
      requestHeaders: { 'X-Tfy-Metadata': JSON.stringify({ env: 'prod' }) },
    });

    expect(JSON.parse(headers[X_TFY_METADATA] ?? '')).toEqual({
      env: 'prod',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'my-agent',
    });
  });
});
