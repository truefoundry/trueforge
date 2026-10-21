import {
  hasMarkedReportableError,
  rememberReportedError,
  reportableErrorFields,
} from '../../../src/core/util/reportableErrorLog';

describe('hasMarkedReportableError', () => {
  it('is false until the error is marked, including through cause', () => {
    const cause = new Error('socket hang up');
    const wrapped = new Error('request failed', { cause });

    expect(hasMarkedReportableError(wrapped)).toBe(false);

    reportableErrorFields({ error: cause, operation: 'serviceFoundryRequest' });

    expect(hasMarkedReportableError(cause)).toBe(true);
    expect(hasMarkedReportableError(wrapped)).toBe(true);
  });

  it('treats an error remembered from a direct capture as already marked', () => {
    const error = new Error('already sent');
    rememberReportedError(error);

    expect(hasMarkedReportableError(error)).toBe(true);
    expect(hasMarkedReportableError(new Error('wrapper', { cause: error }))).toBe(true);
  });

  it('does not treat a different error as marked', () => {
    reportableErrorFields({ error: new Error('marked'), operation: 'redisClient' });

    expect(hasMarkedReportableError(new Error('other'))).toBe(false);
  });
});
