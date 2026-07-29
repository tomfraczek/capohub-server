import { updateGroupSchema } from './update-group.schema';

// Poznań, Poland - geonameId 3088171, region "Greater Poland".
function validUpdateInput(overrides: Record<string, unknown> = {}) {
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

// updateGroupSchema is full-replace (see the schema's own comment) - a
// PATCH cannot leave country/city/geonameId untouched by omitting them, so
// an edit is exactly as strict as create here (including for a legacy
// Group/Section that predates `geonameId` - it must resolve a real one the
// next time it is edited, see group.entity.ts).
describe('updateGroupSchema', () => {
  it('accepts a valid full-replace update', () => {
    const result = updateGroupSchema.safeParse(validUpdateInput());
    expect(result.success).toBe(true);
  });

  it('rejects an update that would leave city empty', () => {
    const result = updateGroupSchema.safeParse(validUpdateInput({ city: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects an update that would leave country empty', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ country: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an update omitting city entirely', () => {
    const input = validUpdateInput();
    delete (input as { city?: unknown }).city;

    const result = updateGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update omitting country entirely', () => {
    const input = validUpdateInput();
    delete (input as { country?: unknown }).country;

    const result = updateGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update omitting geonameId entirely - a legacy row must resolve a real one on its next edit', () => {
    const input = validUpdateInput();
    delete (input as { geonameId?: unknown }).geonameId;

    const result = updateGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an update moving country out of sync with geonameId', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ country: 'FR' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field, same as before this change', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ parentGroupId: 'some-id' }),
    );
    expect(result.success).toBe(false);
  });

  // Poland has two different towns both named "Piaski", in different
  // regions, each with its own geonameId - editing must enforce the same
  // geonameId/country/city/region consistency check as create.
  it('rejects an edit whose geonameId does not match its own city/region', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({
        city: 'Piaski',
        region: 'Lublin',
        geonameId: 3089217, // the *other* Piaski's geonameId
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts an edit into the other same-named city, consistently', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({
        city: 'Piaski',
        region: 'Greater Poland',
        geonameId: 3089217,
      }),
    );
    expect(result.success).toBe(true);
  });
});
