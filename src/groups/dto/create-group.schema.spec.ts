import { createGroupSchema } from './create-group.schema';

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
    ...overrides,
  };
}

describe('createGroupSchema', () => {
  it('accepts a valid Group with a real city of the given country', () => {
    const result = createGroupSchema.safeParse(validGroupInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('PL');
      expect(result.data.city).toBe('Poznań');
    }
  });

  it('normalizes country to uppercase', () => {
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

  it('rejects a Group with country explicitly null', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ country: null }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a Group with no city field at all', () => {
    const input = validGroupInput();
    delete (input as { city?: unknown }).city;

    const result = createGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects a Group with city explicitly null', () => {
    const result = createGroupSchema.safeParse(validGroupInput({ city: null }));
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

  it('rejects a city that does not belong to the given country', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ country: 'DE', city: 'Poznań' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes('city')),
      ).toBe(true);
    }
  });

  it('rejects a made-up city name for an otherwise-valid country', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ city: 'Not A Real City' }),
    );
    expect(result.success).toBe(false);
  });
});
