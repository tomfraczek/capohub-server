import { createSectionSchema } from './create-section.schema';

// Poznań, Poland - geonameId 3088171, region "Greater Poland".
function validSectionInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Poznań',
    description: null,
    logoUrl: null,
    coverImageUrl: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    youtubeUrl: null,
    isPublic: true,
    isHidden: false,
    memberInvitesAllowed: false,
    timezone: 'Europe/Warsaw',
    currencyCode: 'PLN',
    country: 'PL',
    city: 'Poznań',
    region: 'Greater Poland',
    geonameId: 3088171,
    ...overrides,
  };
}

describe('createSectionSchema', () => {
  it('accepts a valid Section whose country/city/region match geonameId exactly', () => {
    const result = createSectionSchema.safeParse(validSectionInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('PL');
      expect(result.data.city).toBe('Poznań');
      expect(result.data.geonameId).toBe(3088171);
    }
  });

  it('rejects a Section with no country field at all', () => {
    const input = validSectionInput();
    delete (input as { country?: unknown }).country;

    const result = createSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects a Section with no city field at all', () => {
    const input = validSectionInput();
    delete (input as { city?: unknown }).city;

    const result = createSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects a Section with no geonameId field at all', () => {
    const input = validSectionInput();
    delete (input as { geonameId?: unknown }).geonameId;

    const result = createSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an empty string country', () => {
    const result = createSectionSchema.safeParse(
      validSectionInput({ country: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty string city', () => {
    const result = createSectionSchema.safeParse(
      validSectionInput({ city: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a country that does not match the city referenced by geonameId', () => {
    const result = createSectionSchema.safeParse(
      validSectionInput({ country: 'BR' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a geonameId that does not exist in the dataset', () => {
    const result = createSectionSchema.safeParse(
      validSectionInput({ geonameId: 999999999999 }),
    );
    expect(result.success).toBe(false);
  });

  // Poland has two different towns both named "Piaski", in different
  // regions - see create-group.schema.spec.ts for the identical scenario.
  describe('two different cities that happen to share a name ("Piaski")', () => {
    it('accepts the first one with its own real geonameId/region', () => {
      const result = createSectionSchema.safeParse(
        validSectionInput({
          city: 'Piaski',
          region: 'Lublin',
          geonameId: 762390,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.region).toBe('Lublin');
      }
    });

    it('accepts the second one with its own, different geonameId/region', () => {
      const result = createSectionSchema.safeParse(
        validSectionInput({
          city: 'Piaski',
          region: 'Greater Poland',
          geonameId: 3089217,
        }),
      );

      expect(result.success).toBe(true);
    });

    it('rejects a region that does not match either geonameId given', () => {
      const result = createSectionSchema.safeParse(
        validSectionInput({
          city: 'Piaski',
          region: 'Mazovia',
          geonameId: 762390,
        }),
      );
      expect(result.success).toBe(false);
    });
  });
});
