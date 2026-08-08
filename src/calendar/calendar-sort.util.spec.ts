import { CalendarItemDto } from './dto/calendar-item.dto';
import { sortCalendarItems } from './calendar-sort.util';

function buildEventItem(
  overrides: Partial<CalendarItemDto> & { id: string; sourceId: string },
): CalendarItemDto {
  return {
    type: 'EVENT',
    title: 'Some Event',
    startsAt: '2026-01-10T18:00:00.000Z',
    endsAt: '2026-01-10T20:00:00.000Z',
    status: 'PUBLISHED' as never,
    isCancelled: false,
    community: { id: 'c-1', type: 'SECTION', name: 'Section' },
    eventType: 'FESTIVAL' as never,
    locationName: null,
    locationAddress: null,
    viewerRsvp: null,
    ...overrides,
  } as CalendarItemDto;
}

describe('sortCalendarItems', () => {
  it('orders by startsAt ascending', () => {
    const later = buildEventItem({
      id: 'event:later',
      sourceId: 'later',
      startsAt: '2026-01-11T00:00:00.000Z',
    });
    const earlier = buildEventItem({
      id: 'event:earlier',
      sourceId: 'earlier',
      startsAt: '2026-01-09T00:00:00.000Z',
    });
    expect(sortCalendarItems([later, earlier])).toEqual([earlier, later]);
  });

  it('breaks a startsAt tie by endsAt ascending', () => {
    const longer = buildEventItem({
      id: 'event:longer',
      sourceId: 'longer',
      startsAt: '2026-01-10T18:00:00.000Z',
      endsAt: '2026-01-10T22:00:00.000Z',
    });
    const shorter = buildEventItem({
      id: 'event:shorter',
      sourceId: 'shorter',
      startsAt: '2026-01-10T18:00:00.000Z',
      endsAt: '2026-01-10T19:00:00.000Z',
    });
    expect(sortCalendarItems([longer, shorter])).toEqual([shorter, longer]);
  });

  it('breaks a startsAt/endsAt tie by type, then sourceId, deterministically', () => {
    const sameTime = {
      startsAt: '2026-01-10T18:00:00.000Z',
      endsAt: '2026-01-10T20:00:00.000Z',
    };
    const training = {
      ...buildEventItem({ id: 'training:b', sourceId: 'b', ...sameTime }),
      type: 'TRAINING' as const,
    } as CalendarItemDto;
    const eventB = buildEventItem({
      id: 'event:b',
      sourceId: 'b',
      ...sameTime,
    });
    const eventA = buildEventItem({
      id: 'event:a',
      sourceId: 'a',
      ...sameTime,
    });

    const sorted = sortCalendarItems([training, eventB, eventA]);
    expect(sorted.map((item) => item.id)).toEqual([
      'event:a',
      'event:b',
      'training:b',
    ]);
  });

  it('does not mutate the input array', () => {
    const items = [
      buildEventItem({
        id: 'event:2',
        sourceId: '2',
        startsAt: '2026-01-11T00:00:00.000Z',
      }),
      buildEventItem({
        id: 'event:1',
        sourceId: '1',
        startsAt: '2026-01-10T00:00:00.000Z',
      }),
    ];
    const original = [...items];
    sortCalendarItems(items);
    expect(items).toEqual(original);
  });
});
