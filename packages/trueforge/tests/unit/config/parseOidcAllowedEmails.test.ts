import { parseOidcAllowedEmails } from '../../../src/config';

describe('parseOidcAllowedEmails', () => {
  it('returns an empty list when unset or blank', () => {
    expect(parseOidcAllowedEmails(undefined)).toEqual([]);
    expect(parseOidcAllowedEmails('')).toEqual([]);
    expect(parseOidcAllowedEmails('   ')).toEqual([]);
  });

  it('splits on commas and trims whitespace', () => {
    expect(parseOidcAllowedEmails(' alice@acme.com , *@partner.com ')).toEqual(['alice@acme.com', '*@partner.com']);
  });

  it('drops empty entries between commas', () => {
    expect(parseOidcAllowedEmails('a@b.com,, *@c.com,')).toEqual(['a@b.com', '*@c.com']);
  });
});
