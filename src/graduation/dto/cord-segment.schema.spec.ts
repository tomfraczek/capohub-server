import { cordSegmentsSchema } from './cord-segment.schema';

function segment(
  overrides: Partial<{
    position: number;
    colorHex: string;
    proportion: number;
  }> = {},
) {
  return { position: 1, colorHex: '#FF0000', proportion: 100, ...overrides };
}

describe('cordSegmentsSchema', () => {
  it('accepts a single-color cord (one segment summing to 100)', () => {
    const result = cordSegmentsSchema.safeParse([segment()]);
    expect(result.success).toBe(true);
  });

  it('accepts a two-color cord', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, colorHex: '#000000', proportion: 50 }),
      segment({ position: 2, colorHex: '#FFFFFF', proportion: 50 }),
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts a many-color cord with identical tip colors', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, colorHex: '#00FF00', proportion: 25 }),
      segment({ position: 2, colorHex: '#0000FF', proportion: 50 }),
      segment({ position: 3, colorHex: '#00FF00', proportion: 25 }),
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts differing tip colors with a distinct middle color', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, colorHex: '#111111', proportion: 30 }),
      segment({ position: 2, colorHex: '#222222', proportion: 40 }),
      segment({ position: 3, colorHex: '#333333', proportion: 30 }),
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects an empty segment list', () => {
    const result = cordSegmentsSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rejects proportions that sum to less than 100', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, proportion: 40 }),
      segment({ position: 2, proportion: 40 }),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects proportions that sum to more than 100', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, proportion: 60 }),
      segment({ position: 2, proportion: 60 }),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate position values', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, proportion: 50 }),
      segment({ position: 1, proportion: 50 }),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed hex color', () => {
    const result = cordSegmentsSchema.safeParse([segment({ colorHex: 'red' })]);
    expect(result.success).toBe(false);
  });

  it('rejects a hex color missing the leading #', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ colorHex: 'FF0000' }),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive proportion', () => {
    const result = cordSegmentsSchema.safeParse([segment({ proportion: 0 })]);
    expect(result.success).toBe(false);
  });

  it('tolerates floating-point rounding noise when summing to 100', () => {
    const result = cordSegmentsSchema.safeParse([
      segment({ position: 1, proportion: 33.33 }),
      segment({ position: 2, proportion: 33.33 }),
      segment({ position: 3, proportion: 33.34 }),
    ]);
    expect(result.success).toBe(true);
  });
});
