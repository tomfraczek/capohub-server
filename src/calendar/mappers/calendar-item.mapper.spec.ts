import { EventResponseDto } from '../../events/dto/event-response.dto';
import { EventRsvpStatus } from '../../events/enums/event-rsvp-status.enum';
import { EventStatus } from '../../events/enums/event-status.enum';
import { EventType } from '../../events/enums/event-type.enum';
import { EventVisibility } from '../../events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../../events/enums/event-waitlist-policy.enum';
import { TrainingResponseDto } from '../../trainings/dto/training-response.dto';
import { TrainingRsvpStatus } from '../../trainings/enums/training-rsvp-status.enum';
import { TrainingStatus } from '../../trainings/enums/training-status.enum';
import { TrainingVisibility } from '../../trainings/enums/training-visibility.enum';
import {
  toCalendarEventItem,
  toCalendarTrainingItem,
} from './calendar-item.mapper';

function buildEvent(
  overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
  return {
    id: 'event-1',
    organizer: {
      type: 'SECTION',
      id: 'section-1',
      name: 'Downtown Section',
      image: { url: null },
    },
    community: {
      id: 'section-1',
      name: 'Downtown Section',
      logoUrl: null,
      isRootGroup: false,
      communityType: 'SECTION',
    },
    createdByUserId: 'user-2',
    type: EventType.FESTIVAL,
    customTypeLabel: null,
    name: 'Roda Grande',
    description: 'A big roda',
    coverImageUrl: null,
    startsAt: '2026-01-10T18:00:00.000Z',
    endsAt: '2026-01-10T21:00:00.000Z',
    isMultiDay: false,
    locationName: 'Community Hall',
    locationAddress: '123 Main St',
    visibility: EventVisibility.PUBLIC,
    status: EventStatus.PUBLISHED,
    capacity: null,
    waitlistPolicy: EventWaitlistPolicy.NONE,
    seatsTaken: 0,
    seatsAvailable: null,
    waitlistCount: 0,
    publicCode: 'ABCDEFGHIJKLMNO',
    numericCode: '042981',
    qrPayload: 'capohub:v1:f:042981',
    viewerRoles: [],
    capabilities: {
      canViewManagement: false,
      canEdit: false,
      canPublish: false,
      canCancel: false,
      canFinish: false,
      canManageOrganizers: false,
      canManageModerators: false,
      canTransferOwnership: false,
      canManageInvitations: false,
      canManageParticipants: false,
      canCheckIn: false,
      canRegister: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTraining(
  overrides: Partial<TrainingResponseDto> = {},
): TrainingResponseDto {
  return {
    id: 'training-1',
    section: { id: 'section-1', name: 'Downtown Section', logoUrl: null },
    seriesId: null,
    startsAt: '2026-01-12T18:00:00.000Z',
    endsAt: '2026-01-12T20:00:00.000Z',
    locationName: 'Gym',
    locationAddress: '456 Side St',
    latitude: null,
    longitude: null,
    trainer: { id: 'trainer-1', displayName: 'Mestre Ada' },
    description: null,
    visibility: TrainingVisibility.MEMBERS_ONLY,
    allowExternalRsvp: false,
    status: TrainingStatus.SCHEDULED,
    rsvpCounts: { yes: 3, no: 1, maybe: 0 },
    viewerRsvp: null,
    management: null,
    capabilities: {
      canEdit: false,
      canCancel: false,
      canManageAttendance: false,
      canManagePlanNotes: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('toCalendarEventItem', () => {
  it('builds a stable "event:<id>" item id, distinct from the real sourceId', () => {
    const item = toCalendarEventItem(buildEvent(), null);
    expect(item.id).toBe('event:event-1');
    expect(item.sourceId).toBe('event-1');
  });

  it('marks isCancelled true exactly when status is CANCELLED', () => {
    expect(
      toCalendarEventItem(buildEvent({ status: EventStatus.CANCELLED }), null)
        .isCancelled,
    ).toBe(true);
    expect(
      toCalendarEventItem(buildEvent({ status: EventStatus.PUBLISHED }), null)
        .isCancelled,
    ).toBe(false);
  });

  it('derives community.type from communityType, never from isRootGroup alone', () => {
    const groupItem = toCalendarEventItem(
      buildEvent({
        community: {
          id: 'group-1',
          name: 'Cordao de Ouro',
          logoUrl: null,
          isRootGroup: false,
          communityType: 'GROUP',
        },
      }),
      null,
    );
    expect(groupItem.community).toEqual({
      id: 'group-1',
      type: 'GROUP',
      name: 'Cordao de Ouro',
    });
  });

  it('carries the given viewerRsvp through unchanged, including null', () => {
    expect(toCalendarEventItem(buildEvent(), null).viewerRsvp).toBeNull();
    expect(
      toCalendarEventItem(buildEvent(), EventRsvpStatus.GOING).viewerRsvp,
    ).toBe(EventRsvpStatus.GOING);
  });

  it('never leaks capabilities/seat counts/codes - only the documented calendar fields', () => {
    const item = toCalendarEventItem(buildEvent(), null);
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'type',
        'sourceId',
        'title',
        'startsAt',
        'endsAt',
        'status',
        'isCancelled',
        'community',
        'eventType',
        'locationName',
        'locationAddress',
        'viewerRsvp',
      ].sort(),
    );
  });
});

describe('toCalendarTrainingItem', () => {
  it('builds a stable "training:<id>" item id, distinct from the real sourceId', () => {
    const item = toCalendarTrainingItem(buildTraining());
    expect(item.id).toBe('training:training-1');
    expect(item.sourceId).toBe('training-1');
  });

  it('marks isCancelled true exactly when status is CANCELLED', () => {
    expect(
      toCalendarTrainingItem(
        buildTraining({ status: TrainingStatus.CANCELLED }),
      ).isCancelled,
    ).toBe(true);
    expect(
      toCalendarTrainingItem(
        buildTraining({ status: TrainingStatus.SCHEDULED }),
      ).isCancelled,
    ).toBe(false);
  });

  it('always reports community.type SECTION, using the training section ref', () => {
    const item = toCalendarTrainingItem(buildTraining());
    expect(item.community).toEqual({
      id: 'section-1',
      type: 'SECTION',
      name: 'Downtown Section',
    });
  });

  it('derives isRecurring/seriesId from seriesId, and passes userRsvp through', () => {
    expect(toCalendarTrainingItem(buildTraining()).isRecurring).toBe(false);
    const recurring = toCalendarTrainingItem(
      buildTraining({
        seriesId: 'series-1',
        viewerRsvp: TrainingRsvpStatus.YES,
      }),
    );
    expect(recurring.isRecurring).toBe(true);
    expect(recurring.seriesId).toBe('series-1');
    expect(recurring.userRsvp).toBe(TrainingRsvpStatus.YES);
  });

  it('never leaks trainingPlan/trainerNotes/management/capabilities/rsvpCounts', () => {
    const item = toCalendarTrainingItem(
      buildTraining({
        management: {
          trainingPlan: 'secret plan',
          trainerNotes: 'secret notes',
        },
      }),
    );
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'type',
        'sourceId',
        'title',
        'startsAt',
        'endsAt',
        'status',
        'isCancelled',
        'community',
        'trainer',
        'locationName',
        'locationAddress',
        'userRsvp',
        'isRecurring',
        'seriesId',
      ].sort(),
    );
  });
});
