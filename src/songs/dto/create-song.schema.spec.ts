import { createSongSchema } from './create-song.schema';

const VALID_CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const VALID_TAG_ID = '22222222-2222-4222-8222-222222222222';

function validPayload(): Record<string, unknown> {
  return {
    title: 'Paranauê',
    authorName: 'Mestre Test',
    categoryId: VALID_CATEGORY_ID,
    alternativeTitles: [{ title: 'Paranauê Paraná', position: 1 }],
    tagIds: [VALID_TAG_ID],
    parts: [
      {
        performer: 'CHORUS',
        position: 1,
        lines: [
          {
            originalText: 'Paranauê, paranauê Paraná',
            phoneticText: 'Paranau-e, paranau-e Parana',
            position: 1,
            translations: [
              { languageCode: 'pl', text: 'Paranauê, paranauê Paraná' },
            ],
          },
        ],
      },
      {
        performer: 'LEAD',
        position: 2,
        lines: [
          {
            originalText: 'Meu mestre mandou chamar',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
    ],
    media: [
      {
        provider: 'YOUTUBE',
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Wersja koncertowa',
        position: 1,
      },
    ],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
  };
}

describe('createSongSchema', () => {
  it('accepts a valid, fully-populated request', () => {
    const result = createSongSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('normalizes an empty authorName to null', () => {
    const result = createSongSchema.safeParse({
      ...validPayload(),
      authorName: '   ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorName).toBeNull();
    }
  });

  it('rejects a request missing title', () => {
    const payload = validPayload();
    delete payload.title;
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects non-contiguous part positions', () => {
    const payload = validPayload();
    (payload.parts as { position: number }[])[1].position = 3;
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate part positions', () => {
    const payload = validPayload();
    (payload.parts as { position: number }[])[1].position = 1;
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a part with no lines', () => {
    const payload = validPayload();
    (payload.parts as { lines: unknown[] }[])[0].lines = [];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects non-contiguous line positions within a part', () => {
    const payload = validPayload();
    const part = (payload.parts as { lines: { position: number }[] }[])[0];
    part.lines.push({ ...part.lines[0], position: 3 });
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects an empty line (blank originalText)', () => {
    const payload = validPayload();
    (
      payload.parts as { lines: { originalText: string }[] }[]
    )[0].lines[0].originalText = '   ';
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate translation languageCode within a line', () => {
    const payload = validPayload();
    const line = (
      payload.parts as { lines: { translations: unknown[] }[] }[]
    )[0].lines[0];
    line.translations = [
      { languageCode: 'pl', text: 'a' },
      { languageCode: 'PL', text: 'b' },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it.each(['p', 'toolongcode123', 'pl_PL', '123'])(
    'rejects an invalid languageCode "%s"',
    (languageCode) => {
      const payload = validPayload();
      const line = (
        payload.parts as { lines: { translations: unknown[] }[] }[]
      )[0].lines[0];
      line.translations = [{ languageCode, text: 'a' }];
      const result = createSongSchema.safeParse(payload);
      expect(result.success).toBe(false);
    },
  );

  it('accepts a normalized regional languageCode like pt-BR', () => {
    const payload = validPayload();
    const line = (
      payload.parts as { lines: { translations: unknown[] }[] }[]
    )[0].lines[0];
    line.translations = [{ languageCode: 'pt-BR', text: 'a' }];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate tagIds', () => {
    const payload = validPayload();
    payload.tagIds = [VALID_TAG_ID, VALID_TAG_ID];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid categoryId', () => {
    const payload = validPayload();
    payload.categoryId = 'not-a-uuid';
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate alternative titles', () => {
    const payload = validPayload();
    payload.alternativeTitles = [
      { title: 'Same Title', position: 1 },
      { title: 'Same Title', position: 2 },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate media URLs', () => {
    const payload = validPayload();
    const url = 'https://www.youtube.com/watch?v=abc123';
    payload.media = [
      { provider: 'YOUTUBE', url, title: null, position: 1 },
      { provider: 'YOUTUBE', url, title: null, position: 2 },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a media URL whose domain does not match the provider', () => {
    const payload = validPayload();
    payload.media = [
      {
        provider: 'YOUTUBE',
        url: 'https://open.spotify.com/track/abc123',
        title: null,
        position: 1,
      },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a media URL that is not https', () => {
    const payload = validPayload();
    payload.media = [
      {
        provider: 'YOUTUBE',
        url: 'http://www.youtube.com/watch?v=abc123',
        title: null,
        position: 1,
      },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects an attempt to set status', () => {
    const result = createSongSchema.safeParse({
      ...validPayload(),
      status: 'PUBLISHED',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attempt to set createdBy', () => {
    const result = createSongSchema.safeParse({
      ...validPayload(),
      createdBy: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attempt to set slug (removed from the model - songs are identified by id)', () => {
    const result = createSongSchema.safeParse({
      ...validPayload(),
      slug: 'paranaue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attempt to set isVerified on a media item', () => {
    const payload = validPayload();
    payload.media = [
      {
        provider: 'YOUTUBE',
        url: 'https://www.youtube.com/watch?v=abc123',
        title: null,
        position: 1,
        isVerified: true,
      },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts an empty alternativeTitles, tagIds and media list', () => {
    const payload = validPayload();
    payload.alternativeTitles = [];
    payload.tagIds = [];
    payload.media = [];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects a song with zero parts', () => {
    const payload = validPayload();
    payload.parts = [];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts a song made of only LEAD parts (no alternation required)', () => {
    const payload = validPayload();
    payload.parts = [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: 'a',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
      {
        performer: 'LEAD',
        position: 2,
        lines: [
          {
            originalText: 'b',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
    ];
    const result = createSongSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
