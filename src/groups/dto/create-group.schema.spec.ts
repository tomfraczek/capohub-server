import { createGroupSchema } from './create-group.schema';

// Poznań, Poland - geonameId 3088171, region "Greater Poland" (see
// city-directory.spec.ts for how this is confirmed against the bundled
// GeoNames dataset).
function validGroupInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Capoeira Angola SP',
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

describe('createGroupSchema', () => {
  it('accepts a valid Group whose country/city/region match geonameId exactly', () => {
    const result = createGroupSchema.safeParse(validGroupInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('PL');
      expect(result.data.city).toBe('Poznań');
      expect(result.data.region).toBe('Greater Poland');
      expect(result.data.geonameId).toBe(3088171);
    }
  });

  it('normalizes country to uppercase before checking it against geonameId', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ country: 'pl' }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('PL');
    }
  });

  it('rejects a Group with no country field at all', () => {
    const input = validGroupInput();
    delete (input as { country?: unknown }).country;

    const result = createGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects a Group with no city field at all', () => {
    const input = validGroupInput();
    delete (input as { city?: unknown }).city;

    const result = createGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an empty string city', () => {
    const result = createGroupSchema.safeParse(validGroupInput({ city: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only city (trims to empty)', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ city: '   ' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty string country', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ country: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an invalid ISO country code', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ country: 'XX' }),
    );
    expect(result.success).toBe(false);
  });

  describe('geonameId', () => {
    it('rejects a Group with no geonameId field at all', () => {
      const input = validGroupInput();
      delete (input as { geonameId?: unknown }).geonameId;

      const result = createGroupSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects a geonameId that does not exist in the dataset', () => {
      const result = createGroupSchema.safeParse(
        validGroupInput({ geonameId: 999999999999 }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes('geonameId')),
        ).toBe(true);
      }
    });

    it('rejects a non-integer or non-positive geonameId', () => {
      expect(
        createGroupSchema.safeParse(validGroupInput({ geonameId: 1.5 }))
          .success,
      ).toBe(false);
      expect(
        createGroupSchema.safeParse(validGroupInput({ geonameId: -1 })).success,
      ).toBe(false);
    });

    it('rejects when country does not match the city referenced by geonameId', () => {
      const result = createGroupSchema.safeParse(
        validGroupInput({ country: 'DE' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes('country')),
        ).toBe(true);
      }
    });

    it('rejects when city does not match the city referenced by geonameId', () => {
      const result = createGroupSchema.safeParse(
        validGroupInput({ city: 'Not The Real Name' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes('city')),
        ).toBe(true);
      }
    });

    it('rejects when region does not match the region referenced by geonameId', () => {
      const result = createGroupSchema.safeParse(
        validGroupInput({ region: 'Lublin' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes('region')),
        ).toBe(true);
      }
    });

    // Poland has two different towns both named "Piaski", in different
    // regions - each has its own distinct, stable geonameId, so both are
    // independently reachable and never confused with each other, unlike
    // the previous (pre-GeoNames) name-based ambiguity check.
    describe('two different cities that happen to share a name ("Piaski")', () => {
      it('accepts the first one with its own real geonameId/country/region', () => {
        const result = createGroupSchema.safeParse(
          validGroupInput({
            city: 'Piaski',
            region: 'Lublin',
            geonameId: 762390,
          }),
        );

        expect(result.success).toBe(true);
      });

      it('accepts the second one with its own, different geonameId/region', () => {
        const result = createGroupSchema.safeParse(
          validGroupInput({
            city: 'Piaski',
            region: 'Greater Poland',
            geonameId: 3089217,
          }),
        );

        expect(result.success).toBe(true);
      });

      it('rejects mixing the first geonameId with the second region', () => {
        const result = createGroupSchema.safeParse(
          validGroupInput({
            city: 'Piaski',
            region: 'Greater Poland',
            geonameId: 762390,
          }),
        );

        expect(result.success).toBe(false);
      });
    });
  });
});
