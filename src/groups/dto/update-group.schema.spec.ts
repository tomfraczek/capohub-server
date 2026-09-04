import { updateGroupSchema } from './update-group.schema';

// Group has no location fields (country/city/region/geonameId) - those
// live on Section only (see group.entity.ts / section.entity.ts, the
// Group/Section physical-split ADR) - see update-section.schema.spec.ts
// for the equivalent geonameId/country/city/region validation, which
// still applies there. Also no timezone/currencyCode (unlike Section,
// which still has its own) - those are set once, per-User, from
// PATCH /users/me.
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
    ...overrides,
  };
}

// updateGroupSchema is full-replace, `.strict()` (see the schema's own
// comment) - unknown fields, including the removed country/city/region/
// geonameId, are rejected rather than silently ignored.
describe('updateGroupSchema', () => {
  it('accepts a valid full-replace update', () => {
    const result = updateGroupSchema.safeParse(validUpdateInput());
    expect(result.success).toBe(true);
  });

  it('rejects an update that would leave name empty', () => {
    const result = updateGroupSchema.safeParse(validUpdateInput({ name: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field, same as before this change', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ parentGroupId: 'some-id' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects the now-removed location fields (country/city/region/geonameId)', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ country: 'PL', city: 'Poznań' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects the now-removed timezone/currencyCode fields', () => {
    const result = updateGroupSchema.safeParse(
      validUpdateInput({ timezone: 'Europe/Warsaw', currencyCode: 'PLN' }),
    );
    expect(result.success).toBe(false);
  });
});
