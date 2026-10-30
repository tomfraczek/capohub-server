import { redactDatabaseUrl } from './migrate';

const DATABASE_URL =
  'postgresql://doadmin:s3cr%40t-pass@db-capohub.example.invalid:25060/defaultdb?sslmode=require';

describe('redactDatabaseUrl', () => {
  it('replaces the full connection string', () => {
    expect(
      redactDatabaseUrl(`failed to connect to ${DATABASE_URL}`, DATABASE_URL),
    ).toBe('failed to connect to <DATABASE_URL>');
  });

  it('masks the (decoded) password wherever it appears', () => {
    expect(
      redactDatabaseUrl('auth failed for password s3cr@t-pass', DATABASE_URL),
    ).toBe('auth failed for password *****');
  });

  it('leaves messages without secrets untouched', () => {
    expect(
      redactDatabaseUrl(
        'self-signed certificate in certificate chain',
        DATABASE_URL,
      ),
    ).toBe('self-signed certificate in certificate chain');
  });

  it('is a no-op without a DATABASE_URL', () => {
    expect(redactDatabaseUrl('boom', undefined)).toBe('boom');
  });
});
