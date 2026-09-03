import { listSongsQuerySchema } from './song-list-query.schema';

describe('listSongsQuerySchema', () => {
  it('applies defaults when only pagination is given', () => {
    const result = listSongsQuerySchema.safeParse({ page: '1', limit: '20' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('-createdAt');
      expect(result.data.tagIds).toBeUndefined();
    }
  });

  it('parses and deduplicates a comma-separated tagIds list', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      tagIds: `${a},${b},${a}`,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual([a, b]);
    }
  });

  it('rejects a tagIds list containing a non-UUID entry', () => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      tagIds: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported sort token', () => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      sort: 'popular',
    });
    expect(result.success).toBe(false);
  });

  it.each([
    'title',
    '-title',
    'createdAt',
    '-createdAt',
    'updatedAt',
    '-updatedAt',
  ])('accepts the sort token "%s"', (sort) => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      sort,
    });
    expect(result.success).toBe(true);
  });

  it('lowercases translationLanguage', () => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      translationLanguage: 'PT-BR',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.translationLanguage).toBe('pt-br');
    }
  });

  // Schema-level, `status` is always accepted regardless of createdByMe -
  // it only takes effect together with createdByMe=true, but that's
  // enforced by queryVisibleSongIds (the query builder), not this schema.
  it.each(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'HIDDEN'])(
    'accepts status=%s',
    (status) => {
      const result = listSongsQuerySchema.safeParse({
        page: '1',
        limit: '20',
        status,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(status);
      }
    },
  );

  it('rejects an unsupported status token', () => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      status: 'ARCHIVED',
    });
    expect(result.success).toBe(false);
  });

  it.each(['true', 'false'])('parses hasPhonetics=%s as a boolean', (value) => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      hasPhonetics: value,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasPhonetics).toBe(value === 'true');
    }
  });
});
