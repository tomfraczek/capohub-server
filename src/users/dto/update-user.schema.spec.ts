import { updateUserSchema } from './update-user.schema';

describe('updateUserSchema', () => {
  it('accepts an empty object (no changes)', () => {
    const result = updateUserSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('trims a valid firstName', () => {
    const result = updateUserSchema.parse({ firstName: '  Ada  ' });
    expect(result.firstName).toBe('Ada');
  });

  it('turns an empty string into null', () => {
    const result = updateUserSchema.parse({ firstName: '' });
    expect(result.firstName).toBeNull();
  });

  it('turns a whitespace-only string into null', () => {
    const result = updateUserSchema.parse({ lastName: '   ' });
    expect(result.lastName).toBeNull();
  });

  it('accepts an explicit null', () => {
    const result = updateUserSchema.parse({ firstName: null });
    expect(result.firstName).toBeNull();
  });

  it('leaves an omitted field as undefined', () => {
    const result = updateUserSchema.parse({ firstName: 'Ada' });
    expect(result.lastName).toBeUndefined();
  });

  it('rejects a firstName longer than the max length', () => {
    const result = updateUserSchema.safeParse({ firstName: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts a firstName at exactly the max length', () => {
    const result = updateUserSchema.safeParse({ firstName: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('rejects a lastName longer than the max length', () => {
    const result = updateUserSchema.safeParse({ lastName: 'b'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string firstName', () => {
    const result = updateUserSchema.safeParse({ firstName: 123 });
    expect(result.success).toBe(false);
  });

  it('updates both fields together', () => {
    const result = updateUserSchema.parse({
      firstName: ' Ada ',
      lastName: ' Lovelace ',
    });
    expect(result).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });
});
