import { createGroupSchema } from './create-group.schema';

// Group has no location fields (country/city/region/geonameId) - those
// live on Section only (see group.entity.ts / section.entity.ts, the
// Group/Section physical-split ADR) - see create-section.schema.spec.ts
// for the equivalent geonameId/country/city/region validation, which
// still applies there.
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
    ...overrides,
  };
}

describe('createGroupSchema', () => {
  it('accepts a valid Group with no location fields', () => {
    const result = createGroupSchema.safeParse(validGroupInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Capoeira Angola SP');
      expect(result.data).not.toHaveProperty('country');
      expect(result.data).not.toHaveProperty('city');
      expect(result.data).not.toHaveProperty('region');
      expect(result.data).not.toHaveProperty('geonameId');
    }
  });

  it('rejects a Group with an empty name', () => {
    const result = createGroupSchema.safeParse(validGroupInput({ name: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a Group with no timezone', () => {
    const input = validGroupInput();
    delete (input as { timezone?: unknown }).timezone;

    const result = createGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects a Group with no currencyCode', () => {
    const input = validGroupInput();
    delete (input as { currencyCode?: unknown }).currencyCode;

    const result = createGroupSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
