import { CordSegmentInput } from './dto/cord-segment.schema';

interface CordSegmentFields {
  position: number;
  colorHex: string;
  proportion: number;
}

/**
 * Builds fresh segment entities from validated input - shared by
 * RanksService and CustomUserRankService so the field-assignment logic
 * isn't duplicated across the two (otherwise identically-shaped) entity
 * types (see rank-cord-segment.entity.ts / custom-user-rank-cord-segment
 * .entity.ts for why they are two separate entities rather than one
 * polymorphic table).
 */
export function buildCordSegments<T extends CordSegmentFields>(
  createSegment: () => T,
  inputs: readonly CordSegmentInput[],
): T[] {
  return inputs.map((input) => {
    const segment = createSegment();
    segment.position = input.position;
    segment.colorHex = input.colorHex;
    segment.proportion = input.proportion;
    return segment;
  });
}
