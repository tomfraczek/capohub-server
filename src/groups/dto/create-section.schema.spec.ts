import { createSectionSchema } from './create-section.schema';

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
    ...overrides,
  };
}

describe('createSectionSchema', () => {
  it('accepts a valid Section with a real city of the given country', () => {
    const result = createSectionSchema.safeParse(validSectionInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('PL');
      expect(result.data.city).toBe('Poznań');
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

  it('rejects a city that does not belong to the given country', () => {
    const result = createSectionSchema.safeParse(
      validSectionInput({ country: 'BR', city: 'Poznań' }),
    );
    expect(result.success).toBe(false);
  });
});
