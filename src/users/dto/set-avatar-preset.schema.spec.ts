import { setAvatarPresetSchema } from './set-avatar-preset.schema';

describe('setAvatarPresetSchema', () => {
  it('accepts a valid presetAvatarId', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'berimbau-01',
    });
    expect(result.success).toBe(true);
  });

  it('trims a valid presetAvatarId', () => {
    const result = setAvatarPresetSchema.parse({
      presetAvatarId: '  berimbau-01  ',
    });
    expect(result.presetAvatarId).toBe('berimbau-01');
  });

  it('rejects an empty presetAvatarId', () => {
    const result = setAvatarPresetSchema.safeParse({ presetAvatarId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a presetAvatarId that is only whitespace', () => {
    const result = setAvatarPresetSchema.safeParse({ presetAvatarId: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a presetAvatarId longer than 100 characters', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a presetAvatarId at exactly 100 characters', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'a'.repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a presetAvatarId containing spaces', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'berimbau 01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a presetAvatarId containing uppercase letters', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'Berimbau-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a presetAvatarId containing disallowed characters', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'berimbau/01!',
    });
    expect(result.success).toBe(false);
  });

  it('accepts underscores and hyphens', () => {
    const result = setAvatarPresetSchema.safeParse({
      presetAvatarId: 'berimbau_01-v2',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing presetAvatarId', () => {
    const result = setAvatarPresetSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-string presetAvatarId', () => {
    const result = setAvatarPresetSchema.safeParse({ presetAvatarId: 123 });
    expect(result.success).toBe(false);
  });
});
