import {
  isRedactedSecretValue,
  MissingStoredSecretError,
  resolveStoredSecretValue,
  SECRET_REDACTION,
  toRedactedSecretValue,
} from '../../../src/utils/secretRedaction';

/**
 * The property these cover: the mask a GET returns is the only thing a later PUT may treat as
 * "keep what you already have", and that mask publishes as little of the secret as it can.
 */
describe('secret redaction masking', () => {
  it('never reveals more than the last four characters', () => {
    const masked = toRedactedSecretValue('sk-ant-0123456789abcdef');

    expect(masked).toBe(`${SECRET_REDACTION}-cdef`);
    // The first three characters used to be published as well, which on a short key left very
    // little unknown.
    expect(masked).not.toContain('sk-');
  });

  it('masks a short secret completely, because a suffix would be most of it', () => {
    expect(toRedactedSecretValue('short')).toBe(SECRET_REDACTION);
    expect(toRedactedSecretValue('12345678901')).toBe(SECRET_REDACTION);
  });

  it('leaks at most four of a secret at the threshold length', () => {
    const secret = '123456789012';
    const masked = toRedactedSecretValue(secret);

    const revealed = [...secret].filter(character => masked.includes(character));
    expect(masked).toBe(`${SECRET_REDACTION}-9012`);
    // Eight of twelve characters stay unknown. The old mask published six of ten.
    expect(new Set(revealed).size).toBeLessThanOrEqual(4);
  });
});

describe('recognising the mask a client sends back', () => {
  it('recognises the two shapes a GET can return', () => {
    expect(isRedactedSecretValue(SECRET_REDACTION)).toBe(true);
    expect(isRedactedSecretValue(toRedactedSecretValue('sk-0123456789abcdef'))).toBe(true);
  });

  it('does not treat a real secret containing the sentinel as a mask', () => {
    /*
     * A substring test classified any value with the sentinel anywhere in it as "keep the stored
     * one", so a secret that happened to contain it was silently dropped — persisting the old
     * value, or failing a create with a message about a missing key and no explanation.
     */
    expect(isRedactedSecretValue(`Bearer token=${SECRET_REDACTION}-demo`)).toBe(false);
    expect(isRedactedSecretValue(`${SECRET_REDACTION}-with-a-longer-tail`)).toBe(false);
    expect(isRedactedSecretValue(`prefix-${SECRET_REDACTION}`)).toBe(false);
    expect(isRedactedSecretValue(`sk-${SECRET_REDACTION}-test`)).toBe(false);
  });

  it('does not treat an ordinary secret as a mask', () => {
    expect(isRedactedSecretValue('sk-ant-0123456789')).toBe(false);
    expect(isRedactedSecretValue('')).toBe(false);
  });
});

describe('resolving what to store', () => {
  it('stores a real secret that contains the sentinel instead of dropping it', () => {
    // The user typed this. Before the fix it vanished and the old key stayed.
    const typed = `sk-${SECRET_REDACTION}-test`;

    expect(resolveStoredSecretValue({ incoming: typed, existing: 'sk-old-value-here' })).toBe(typed);
  });

  it('keeps the stored secret when the client sends that secret’s own mask', () => {
    const stored = 'sk-ant-0123456789abcdef';

    expect(resolveStoredSecretValue({ incoming: toRedactedSecretValue(stored), existing: stored })).toBe(stored);
  });

  it('keeps the stored secret for the bare sentinel, which a short one masks to', () => {
    expect(resolveStoredSecretValue({ incoming: SECRET_REDACTION, existing: 'short' })).toBe('short');
  });

  it('refuses a mask when there is nothing stored to keep', () => {
    expect(() => resolveStoredSecretValue({ incoming: SECRET_REDACTION, existing: undefined })).toThrow(
      MissingStoredSecretError,
    );
  });

  it('rotates to a new real secret', () => {
    expect(resolveStoredSecretValue({ incoming: 'sk-new', existing: 'sk-old' })).toBe('sk-new');
  });
});
