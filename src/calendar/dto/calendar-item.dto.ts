import { EventRsvpStatus } from '../../events/enums/event-rsvp-status.enum';
import { EventStatus } from '../../events/enums/event-status.enum';
import { EventType } from '../../events/enums/event-type.enum';
import { TrainingRsvpStatus } from '../../trainings/enums/training-rsvp-status.enum';
import { TrainingStatus } from '../../trainings/enums/training-status.enum';

// A Calendar item's owning Community - always exactly a Group or a Section,
// never both (see event-community.util.ts) - a Training's community is
// always a Section (Training has no Group ownership at all - see
// training.entity.ts).
export interface CalendarCommunityRefDto {
  id: string;
  type: 'GROUP' | 'SECTION';
  name: string;
}

// The subset of EventResponseDto a calendar view actually renders - never
// the full DTO (no capabilities, no seat counts, no qrPayload/publicCode,
// no createdByUserId - see the Calendar module spec §2 "nie kopiuj całych
// EventResponseDto/TrainingResponseDto"). `id` is the stable, synthesized
// calendar item id ("event:<sourceId>" - see calendar-item.mapper.ts);
// `sourceId` is the real Event uuid, for the frontend to open the Event
// detail screen.
export interface CalendarEventItemDto {
  id: string;
  type: 'EVENT';
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  isCancelled: boolean;
  community: CalendarCommunityRefDto;
  eventType: EventType;
  locationName: string | null;
  locationAddress: string | null;
  // The caller's own EventAttendee.rsvpStatus for this Event, `null` when
  // they never registered (e.g. browsing a Section/Group calendar) - see
  // calendar.service.ts's bulk lookup, never a per-item query.
  viewerRsvp: EventRsvpStatus | null;
}

// The subset of TrainingResponseDto a calendar view actually renders -
// never trainingPlan/trainerNotes/management/capabilities/rsvpCounts (see
// the Calendar module spec §2 "Nie dodawaj danych administracyjnych, planu
// treningu, trainerNotes").
export interface CalendarTrainingItemDto {
  id: string;
  type: 'TRAINING';
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: TrainingStatus;
  isCancelled: boolean;
  community: CalendarCommunityRefDto;
  trainer: { id: string; displayName: string };
  locationName: string | null;
  locationAddress: string | null;
  userRsvp: TrainingRsvpStatus | null;
  isRecurring: boolean;
  seriesId: string | null;
}

// Discriminated on `type` - see the module spec §2 "discriminated union or
// równie jednoznaczny kontrakt". Only two source types exist today (EVENT,
// TRAINING); a future source type (e.g. an exam) is just a third union
// member plus a third mapper - no change to this type's shape or to
// CalendarService's merge/sort step (see calendar.service.ts).
export type CalendarItemDto = CalendarEventItemDto | CalendarTrainingItemDto;

export interface CalendarResponseDto {
  from: string;
  to: string;
  items: CalendarItemDto[];
}
