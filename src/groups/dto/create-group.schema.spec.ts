import { createGroupSchema } from './create-group.schema';

// Group has no location fields (country/city/region/geonameId) - those
// live on Section only (see group.entity.ts / section.entity.ts, the
// Group/Section physical-split ADR) - see create-section.schema.spec.ts
// for the equivalent geonameId/country/city/region validation, which
// still applies there. Also no timezone/currencyCode (unlike Section,
// which still has its own) - those are set once, per-User, from
// PATCH /users/me (see update-user.schema.spec.ts).
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
    ...overrides,
  };
}

describe('createGroupSchema', () => {
  it('accepts a valid Group with no location or regional-settings fields', () => {
    const result = createGroupSchema.safeParse(validGroupInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Capoeira Angola SP');
      expect(result.data).not.toHaveProperty('country');
      expect(result.data).not.toHaveProperty('city');
      expect(result.data).not.toHaveProperty('region');
      expect(result.data).not.toHaveProperty('geonameId');
      expect(result.data).not.toHaveProperty('timezone');
      expect(result.data).not.toHaveProperty('currencyCode');
    }
  });

  it('rejects a Group with an empty name', () => {
    const result = createGroupSchema.safeParse(validGroupInput({ name: '' }));
    expect(result.success).toBe(false);
  });

  it.each([
    'https://example.com',
    'https://www.example.com',
    'http://example.com',
    'www.example.com',
    'example.com',
    'example.com/path?x=1',
    'facebook.com/mygroup',
  ])('accepts websiteUrl in any common format: %s', (websiteUrl) => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ websiteUrl }),
    );
    expect(result.success).toBe(true);
  });

  it.each(['www.example.com', 'example.com'])(
    'normalizes a schemeless websiteUrl to https://: %s',
    (websiteUrl) => {
      const result = createGroupSchema.safeParse(
        validGroupInput({ websiteUrl }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.websiteUrl).toBe(`https://${websiteUrl}`);
      }
    },
  );

  it('leaves a websiteUrl that already has a scheme untouched', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ websiteUrl: 'http://example.com' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.websiteUrl).toBe('http://example.com');
    }
  });

  it('rejects a facebookUrl that is not a domain at all', () => {
    const result = createGroupSchema.safeParse(
      validGroupInput({ facebookUrl: 'not a url' }),
    );
    expect(result.success).toBe(false);
  });
});
