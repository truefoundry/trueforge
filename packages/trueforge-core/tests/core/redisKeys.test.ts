import { REDIS_KEY_NAMESPACE, redisKey } from '../../src/core/redisKeys';
import { heartbeatKey, replyKey, requestChannel } from '../../src/request-reply/utils';

describe('redisKeys', () => {
  it('namespaces every key under tfg', () => {
    expect(REDIS_KEY_NAMESPACE).toBe('tfg');
    expect(redisKey('agent', 'turn', 'ten', 'sess', 'turn1', 'stream')).toBe('tfg:agent:turn:ten:sess:turn1:stream');
  });

  it('prefixes request-reply keys and channels', () => {
    expect(heartbeatKey('exec-1')).toBe('tfg:rr:hb:exec-1');
    expect(requestChannel('exec-1')).toBe('tfg:rr:req:exec-1');
    expect(replyKey('req-1')).toBe('tfg:rr:reply:req-1');
  });
});
