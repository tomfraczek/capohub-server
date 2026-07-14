import { createPaginationMeta } from './pagination.utils';

describe('createPaginationMeta', () => {
  it('computes metadata for a standard list', () => {
    expect(
      createPaginationMeta({ page: 1, limit: 20, totalItems: 45 }),
    ).toEqual({
      page: 1,
      limit: 20,
      totalItems: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('marks the first page correctly', () => {
    const meta = createPaginationMeta({ page: 1, limit: 10, totalItems: 30 });
    expect(meta.hasPreviousPage).toBe(false);
    expect(meta.hasNextPage).toBe(true);
  });

  it('marks the last page correctly', () => {
    const meta = createPaginationMeta({ page: 3, limit: 10, totalItems: 30 });
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('marks a middle page correctly', () => {
    const meta = createPaginationMeta({ page: 2, limit: 10, totalItems: 30 });
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('handles an empty list', () => {
    expect(createPaginationMeta({ page: 1, limit: 20, totalItems: 0 })).toEqual(
      {
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    );
  });

  it('rounds up when totalItems is not evenly divisible by limit', () => {
    const meta = createPaginationMeta({ page: 1, limit: 10, totalItems: 25 });
    expect(meta.totalPages).toBe(3);
  });
});
