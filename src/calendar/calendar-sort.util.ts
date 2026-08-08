import { CalendarItemDto } from './dto/calendar-item.dto';

// The only sort order Calendar ever returns - startsAt ASC, endsAt ASC,
// then a stable type/sourceId tie-breaker (module spec §12). The client
// never gets to choose a different order; day/week/month presentation is
// entirely a frontend concern applied on top of this one deterministic
// list.
export function sortCalendarItems(items: CalendarItemDto[]): CalendarItemDto[] {
  return [...items].sort((a, b) => {
    const startDiff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (startDiff !== 0) return startDiff;
    const endDiff = Date.parse(a.endsAt) - Date.parse(b.endsAt);
    if (endDiff !== 0) return endDiff;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });
}
