import { updateSectionSchema } from './update-section.schema';

// Poznań, Poland - geonameId 3088171, region "Greater Poland".
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
    country: 'PL',
    city: 'Poznań',
    region: 'Greater Poland',
    geonameId: 3088171,
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

  it('rejects an update omitting geonameId entirely - a legacy row must resolve a real one on its next edit', () => {
    const input = validUpdateInput();
    delete (input as { geonameId?: unknown }).geonameId;

    const result = updateSectionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update moving country out of sync with geonameId', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({ country: 'FR' }),
    );
    expect(result.success).toBe(false);
  });

  // Poland has two different towns both named "Piaski", in different
  // regions, each with its own geonameId.
  it('rejects an edit whose geonameId does not match its own city/region', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({
        city: 'Piaski',
        region: 'Lublin',
        geonameId: 3089217, // the *other* Piaski's geonameId
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts an edit into a different, consistent city', () => {
    const result = updateSectionSchema.safeParse(
      validUpdateInput({
        city: 'Piaski',
        region: 'Lublin',
        geonameId: 762390,
      }),
    );
    expect(result.success).toBe(true);
  });
});
