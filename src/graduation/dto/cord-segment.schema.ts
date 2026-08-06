import { z } from 'zod';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const MAX_SEGMENTS = 20;
// Sum-to-100 is compared after rounding to 2 decimal places (proportion is
// stored as decimal(5,2)) to avoid floating-point artifacts like
// 33.33 + 33.33 + 33.34 evaluating to 99.99999999999999.
const SUM_EPSILON = 0.005;

// Shared by Rank and CustomUserRank - both accept "the full list of cord
// segments" on every create/update and replace their stored segments
// atomically (see RanksService.replaceCordSegments /
// CustomUserRankService), never an incremental append. That is exactly
// what makes it safe to validate "segments sum to 100" here, at the
// schema layer, for the whole incoming list in one shot - there is no
// later, separate write that could add a row after this check already
// ran (see rank-cord-segment.entity.ts's own comment on why this can't be
// a single-row DB CHECK).
export const cordSegmentSchema = z.object({
  position: z.number().int().min(1, 'Must be at least 1'),
  colorHex: z
    .string()
    .trim()
    .regex(HEX_COLOR_PATTERN, 'Must be a valid hex color (e.g. "#RRGGBB")'),
  proportion: z
    .number()
    .positive('Must be greater than 0')
    .max(100, 'Must be at most 100'),
});

export const cordSegmentsSchema = z
  .array(cordSegmentSchema)
  .min(1, 'At least one cord segment is required')
  .max(MAX_SEGMENTS, `Must have at most ${MAX_SEGMENTS} cord segments`)
  .superRefine((segments, ctx) => {
    const positions = segments.map((segment) => segment.position);
    if (new Set(positions).size !== positions.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'position values must be unique',
        path: ['position'],
      });
    }

    const sum = segments.reduce(
      (total, segment) => total + segment.proportion,
      0,
    );
    if (Math.abs(sum - 100) > SUM_EPSILON) {
      ctx.addIssue({
        code: 'custom',
        message: `proportion values must sum to exactly 100 (got ${sum})`,
        path: ['proportion'],
      });
    }
  });

export type CordSegmentInput = z.infer<typeof cordSegmentSchema>;
