import {
  booleanQuerySchema,
  optionalTrimmedStringQuerySchema,
  positiveIntegerQuerySchema,
  trimmedStringQuerySchema,
  uuidQuerySchema,
} from './query.schemas';

describe('booleanQuerySchema', () => {
  it('parses "true" as true', () => {
    expect(booleanQuerySchema.parse('true')).toBe(true);
  });

  it('parses "false" as false', () => {
    expect(booleanQuerySchema.parse('false')).toBe(false);
  });

  it.each(['1', '0', 'yes', 'no', 'TRUE', ''])('rejects %p', (value) => {
    expect(booleanQuerySchema.safeParse(value).success).toBe(false);
  });
});

describe('positiveIntegerQuerySchema', () => {
  it('parses "1" as 1', () => {
    expect(positiveIntegerQuerySchema.parse('1')).toBe(1);
  });

  it('parses a multi-digit value', () => {
    expect(positiveIntegerQuerySchema.parse('42')).toBe(42);
  });

  it.each(['1.5', '1abc', '-1', '', 'NaN', ' 1', '1 ', '0x1'])(
    'rejects %p',
    (value) => {
      expect(positiveIntegerQuerySchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects zero (not positive)', () => {
    expect(positiveIntegerQuerySchema.safeParse('0').success).toBe(false);
  });
});

describe('trimmedStringQuerySchema', () => {
  it('trims surrounding whitespace', () => {
    expect(trimmedStringQuerySchema.parse('  hello  ')).toBe('hello');
  });

  it('rejects an empty string', () => {
    expect(trimmedStringQuerySchema.safeParse('').success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(trimmedStringQuerySchema.safeParse('   ').success).toBe(false);
  });
});

describe('optionalTrimmedStringQuerySchema', () => {
  it('allows undefined', () => {
    expect(optionalTrimmedStringQuerySchema.safeParse(undefined).success).toBe(
      true,
    );
  });

  it('rejects an empty string rather than treating it as undefined', () => {
    expect(optionalTrimmedStringQuerySchema.safeParse('').success).toBe(false);
  });

  it('trims and keeps a non-empty value', () => {
    expect(optionalTrimmedStringQuerySchema.parse(' hi ')).toBe('hi');
  });
});

describe('uuidQuerySchema', () => {
  it('accepts a valid UUID', () => {
    expect(
      uuidQuerySchema.safeParse('3fa85f64-5717-4562-b3fc-2c963f66afa6').success,
    ).toBe(true);
  });

  it('rejects an invalid string', () => {
    expect(uuidQuerySchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(uuidQuerySchema.safeParse('').success).toBe(false);
  });
});
