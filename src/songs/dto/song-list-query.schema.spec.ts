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

  it('has no status filter - GET /songs always means PUBLISHED only, so a status param is silently ignored rather than rejected', () => {
    const result = listSongsQuerySchema.safeParse({
      page: '1',
      limit: '20',
      status: 'PENDING_REVIEW',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('status' in result.data).toBe(false);
    }
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
