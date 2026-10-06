interface CordSegmentLike {
  position: number;
  colorHex: string;
  proportion: number;
}

/**
 * A canonical key for how a cord LOOKS - two cords with the same key are
 * visually identical, so a track must never hold both (see
 * RanksService.assertCordUnique). Normalized so cosmetic input differences
 * don't hide a duplicate:
 *  - segments in `position` order (never array order),
 *  - hex colors compared case-insensitively,
 *  - adjacent segments of the same color merged (red 50 + red 50 looks
 *    exactly like red 100),
 *  - proportions rounded to 2 decimal places (stored as decimal(5,2)).
 * Proportions DO count: the same colors in different proportions (e.g.
 * different-length tips) are a different cord.
 */
export function cordSignature(segments: readonly CordSegmentLike[]): string {
  const merged: { color: string; proportion: number }[] = [];
  for (const segment of [...segments].sort((a, b) => a.position - b.position)) {
    const color = segment.colorHex.trim().toUpperCase();
    const last = merged[merged.length - 1];
    if (last && last.color === color) {
      last.proportion += Number(segment.proportion);
    } else {
      merged.push({ color, proportion: Number(segment.proportion) });
    }
  }
  return merged
    .map(({ color, proportion }) => `${color}:${proportion.toFixed(2)}`)
    .join('|');
}
