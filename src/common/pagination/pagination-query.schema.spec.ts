import { paginationQuerySchema } from './pagination-query.schema';

describe('paginationQuerySchema', () => {
  it('defaults to page=1 and limit=20 when no params are given', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('parses valid string values', () => {
    expect(paginationQuerySchema.parse({ page: '2', limit: '50' })).toEqual({
      page: 2,
      limit: 50,
    });
  });

  it('rejects page=0', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects limit=0', () => {
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects limit=101', () => {
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false,
    );
  });

  it('accepts limit=100 (upper bound)', () => {
    expect(paginationQuerySchema.safeParse({ limit: '100' }).success).toBe(
      true,
    );
  });

  it('rejects a decimal page', () => {
    expect(paginationQuerySchema.safeParse({ page: '2.5' }).success).toBe(
      false,
    );
  });

  it('rejects a string with trailing garbage characters', () => {
    expect(paginationQuerySchema.safeParse({ page: '1abc' }).success).toBe(
      false,
    );
  });

  it('rejects an empty string', () => {
    expect(paginationQuerySchema.safeParse({ page: '' }).success).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(paginationQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
  });

  it('rejects the literal "NaN"', () => {
    expect(paginationQuerySchema.safeParse({ limit: 'NaN' }).success).toBe(
      false,
    );
  });
});
