import { updateGroupSchema } from './update-group.schema';

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
    ...overrides,
  };
}

// updateGroupSchema is full-replace (see the schema's own comment) - a
// PATCH cannot leave country/city untouched by omitting them, so an edit
// is exactly as strict as create here.
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

  it('rejects an update moving country/city out of sync with each other', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ country: 'FR', city: 'Poznań' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field, same as before this change', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ parentGroupId: 'some-id' }),
    );
    expect(result.success).toBe(false);
  });
});
