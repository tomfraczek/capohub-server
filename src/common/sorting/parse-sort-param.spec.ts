import { parseSortParam } from './parse-sort-param';

const allowedFields = ['createdAt', 'title'] as const;

describe('parseSortParam', () => {
  it('falls back to the default field and direction when no value is given', () => {
    expect(
      parseSortParam({
        value: undefined,
        allowedFields,
        defaultField: 'createdAt',
        defaultDirection: 'desc',
      }),
    ).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('parses a plain field as ascending', () => {
    expect(
      parseSortParam({
        value: 'createdAt',
        allowedFields,
        defaultField: 'createdAt',
      }),
    ).toEqual({ field: 'createdAt', direction: 'asc' });
  });

  it('parses a "-"-prefixed field as descending', () => {
    expect(
      parseSortParam({
        value: '-createdAt',
        allowedFields,
        defaultField: 'createdAt',
      }),
    ).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('throws for a field outside the allowlist', () => {
    expect(() =>
      parseSortParam({
        value: 'password',
        allowedFields,
        defaultField: 'createdAt',
      }),
    ).toThrow();
  });

  it('treats an empty string like a missing value (uses defaults)', () => {
    expect(
      parseSortParam({
        value: '',
        allowedFields,
        defaultField: 'title',
        defaultDirection: 'asc',
      }),
    ).toEqual({ field: 'title', direction: 'asc' });
  });

  it('rejects a value that looks like a SQL injection attempt', () => {
    expect(() =>
      parseSortParam({
        value: 'createdAt; DROP TABLE users;--',
        allowedFields,
        defaultField: 'createdAt',
      }),
    ).toThrow();
  });

  it('throws if defaultField is not part of allowedFields (programmer error)', () => {
    expect(() =>
      parseSortParam({
        value: undefined,
        allowedFields,
        // @ts-expect-error - intentionally invalid to test the guard
        defaultField: 'notAllowed',
      }),
    ).toThrow();
  });

  it('applies the default direction of "asc" when none is given', () => {
    expect(
      parseSortParam({
        value: undefined,
        allowedFields,
        defaultField: 'title',
      }),
    ).toEqual({ field: 'title', direction: 'asc' });
  });
});
