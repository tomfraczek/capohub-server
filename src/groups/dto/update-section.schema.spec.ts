import { updateSectionSchema } from './update-section.schema';

function validUpdateInput(overrides: Record<string, unknown> = {}) {
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

describe('updateSectionSchema', () => {
  it('accepts a valid full-replace update', () => {
    const result = updateSectionSchema.safeParse(validUpdateInput());
    expect(result.success).toBe(true);
  });

  it('rejects an update that would leave city empty', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({ city: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an update that would leave country empty', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({ country: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an update omitting city entirely', () => {
    const input = validUpdateInput();
    delete (input as { city?: unknown }).city;

    const result = updateSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update omitting country entirely', () => {
    const input = validUpdateInput();
    delete (input as { country?: unknown }).country;

    const result = updateSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update moving country/city out of sync with each other', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({ country: 'FR', city: 'Poznań' }),
    );
    expect(result.success).toBe(false);
  });
});
