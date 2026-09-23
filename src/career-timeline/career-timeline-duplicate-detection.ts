import { CareerTimelineItemDto } from './dto/career-timeline-item.dto';
import { CareerTimelinePrecision } from './enums/career-timeline-entry-type.enum';

const PRECISION_LENGTH: Record<CareerTimelinePrecision, number> = {
  [CareerTimelinePrecision.YEAR]: 4,
  [CareerTimelinePrecision.MONTH]: 7,
  [CareerTimelinePrecision.DAY]: 10,
};

// Compares both dates truncated to the *less specific* item's own
// precision - a YEAR-only MANUAL entry ("2023") is considered the same
// period as any SYSTEM item that falls somewhere in 2023, not only one
// landing on the normalized "2023-01-01". Every SYSTEM item is always
// DAY-precision (a real recorded timestamp), so in practice this always
// truncates to the MANUAL item's own precision - see the redesign audit
// §4, "czy potencjalne wykrywanie duplikatów uwzględnia precyzję daty".
function sameDateAtPrecision(
  a: string,
  b: string,
  precision: CareerTimelinePrecision,
): boolean {
  const len = PRECISION_LENGTH[precision];
  return a.slice(0, len) === b.slice(0, len);
}

// A known, differing Group on both sides rules the pair out; missing Group
// info on either side is never treated as a mismatch (absence of
// information must not rule out a genuine duplicate) - this is the only
// disambiguating signal beyond type+date, deliberately no title/text
// comparison (spec: "Nie dodawaj skomplikowanego systemu deduplikacji
// opartego na heurystykach").
function groupsConflict(
  manual: CareerTimelineItemDto,
  system: CareerTimelineItemDto,
): boolean {
  if (!manual.group?.groupId || !system.group?.groupId) {
    return false;
  }
  return manual.group.groupId !== system.group.groupId;
}

/**
 * Flags a MANUAL item as a *possible* duplicate of an already-aggregated
 * SYSTEM fact (redesign audit §2 - e.g. a user manually logs "2023 -
 * Otrzymanie stopnia Instrutor", then a group admin later backfills the
 * same real grant into FormalRankAssignment). Returns the matching SYSTEM
 * item's id, or null.
 *
 * Deliberately conservative: same `type`, same calendar period at the
 * MANUAL item's own precision, and no conflicting Group. Never auto-
 * resolved - the caller (CareerTimelineAggregationService) only attaches
 * this as a hint; nothing is merged, hidden, or deleted automatically. The
 * SYSTEM item is treated as the authoritative source of the fact; the
 * MANUAL item (and its description) is left entirely intact until the user
 * themselves chooses to delete it.
 */
export function findPossibleDuplicateSystemId(
  manual: CareerTimelineItemDto,
  systemItems: CareerTimelineItemDto[],
): string | null {
  for (const system of systemItems) {
    if (system.type !== manual.type) {
      continue;
    }
    if (
      !sameDateAtPrecision(
        manual.occurredOn,
        system.occurredOn,
        manual.occurredOnPrecision,
      )
    ) {
      continue;
    }
    if (groupsConflict(manual, system)) {
      continue;
    }
    return system.id;
  }
  return null;
}
