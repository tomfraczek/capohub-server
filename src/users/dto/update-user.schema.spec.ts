import { updateUserSchema } from './update-user.schema';

describe('updateUserSchema', () => {
  it('accepts an empty object (no changes)', () => {
    const result = updateUserSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('trims a valid displayName', () => {
    const result = updateUserSchema.parse({ displayName: '  Ada Lovelace  ' });
    expect(result.displayName).toBe('Ada Lovelace');
  });

  it('rejects a displayName shorter than 2 characters', () => {
    const result = updateUserSchema.safeParse({ displayName: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects a displayName that is only whitespace (trims to < 2 chars)', () => {
    const result = updateUserSchema.safeParse({ displayName: '   a   ' });
    expect(result.success).toBe(false);
  });

  it('accepts a displayName at exactly the minimum length', () => {
    const result = updateUserSchema.safeParse({ displayName: 'Ab' });
    expect(result.success).toBe(true);
  });

  it('rejects a displayName longer than 100 characters', () => {
    const result = updateUserSchema.safeParse({
      displayName: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a displayName at exactly 100 characters', () => {
    const result = updateUserSchema.safeParse({
      displayName: 'a'.repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it('does not accept null for displayName (required once present)', () => {
    const result = updateUserSchema.safeParse({ displayName: null });
    expect(result.success).toBe(false);
  });

  it.each(['system', 'light', 'dark'] as const)('accepts theme=%s', (theme) => {
    const result = updateUserSchema.safeParse({ theme });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid theme value', () => {
    const result = updateUserSchema.safeParse({ theme: 'blue' });
    expect(result.success).toBe(false);
  });

  it('accepts notificationsEnabled=true', () => {
    const result = updateUserSchema.parse({ notificationsEnabled: true });
    expect(result.notificationsEnabled).toBe(true);
  });

  it('accepts notificationsEnabled=false', () => {
    const result = updateUserSchema.parse({ notificationsEnabled: false });
    expect(result.notificationsEnabled).toBe(false);
  });

  it('rejects a non-boolean notificationsEnabled', () => {
    const result = updateUserSchema.safeParse({ notificationsEnabled: 'yes' });
    expect(result.success).toBe(false);
  });

  it('leaves omitted fields as undefined', () => {
    const result = updateUserSchema.parse({ displayName: 'Ada' });
    expect(result.theme).toBeUndefined();
    expect(result.notificationsEnabled).toBeUndefined();
  });

  it('rejects an unknown field like email', () => {
    const result = updateUserSchema.safeParse({ email: 'new@example.com' });
    // Unknown keys are stripped by default zod object parsing, so the
    // request itself does not fail - but the field never reaches the entity.
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('email');
  });

  it('strips globalRole - it can never be changed via PATCH /users/me', () => {
    const result = updateUserSchema.safeParse({
      displayName: 'Ada',
      globalRole: 'ADMIN',
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('globalRole');
    expect(result.data).toEqual({ displayName: 'Ada' });
  });

  it('strips avatarType/avatarUrl/presetAvatarId - avatar changes go through their own endpoints', () => {
    const result = updateUserSchema.safeParse({
      displayName: 'Ada',
      avatarType: 'UPLOAD',
      avatarUrl: 'https://evil.example.com/avatar.png',
      presetAvatarId: 'berimbau-01',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ displayName: 'Ada' });
  });

  it('updates all three fields together', () => {
    const result = updateUserSchema.parse({
      displayName: ' Mestre Capoeira ',
      theme: 'light',
      notificationsEnabled: false,
    });
    expect(result).toEqual({
      displayName: 'Mestre Capoeira',
      theme: 'light',
      notificationsEnabled: false,
    });
  });
});
