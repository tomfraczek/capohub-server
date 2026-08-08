/**
 * Unit tests for HomeService.
 *
 * Covers:
 *  - greetingName is exactly User.displayName, untouched
 *  - nearestEvent is read as-is from EventsService.findNearestEvent,
 *    nearestTraining is read as-is from
 *    TrainingsService.findNearestForViewer, both `null` when there is
 *    nothing upcoming
 *  - continueLearning.toReview only contains TO_REVIEW rows, with
 *    total/hasMore describing the full matching set, not just the capped
 *    preview
 *  - announcements is read as-is from AnnouncementsService.listForViewer,
 *    called with a limit of 3 (task requirement)
 *  - there is no `birthdays`/`continueLearning.lastActive` field anywhere
 *    in the response (see home-response.dto.ts - no real backing module in
 *    this codebase)
 */

import { AnnouncementResponseDto } from '../announcements/dto/announcement-response.dto';
import { AnnouncementsService } from '../announcements/announcements.service';
import { AnnouncementRecipientType } from '../announcements/enums/announcement-recipient-type.enum';
import { MembershipRequestTarget } from '../groups/enums/membership-request-target.enum';
import { EventResponseDto } from '../events/dto/event-response.dto';
import { EventType } from '../events/enums/event-type.enum';
import { EventsService } from '../events/events.service';
import { TrainingResponseDto } from '../trainings/dto/training-response.dto';
import { TrainingVisibility } from '../trainings/enums/training-visibility.enum';
import { TrainingStatus } from '../trainings/enums/training-status.enum';
import { TrainingsService } from '../trainings/trainings.service';
import { LearningSongListItemDto } from '../song-library/dto/learning-songs-list-response.dto';
import { LearningStatus } from '../song-library/enums/learning-status.enum';
import { LearningStatusService } from '../song-library/learning-status.service';
import { User } from '../users/entities/user.entity';
import { HomeService } from './home.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'test@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildEvent(
  overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
  return {
    id: 'event-1',
    community: {
      id: 'group-1',
      name: 'Group',
      logoUrl: null,
      isRootGroup: true,
      communityType: 'GROUP',
    },
    createdByUserId: 'user-2',
    type: EventType.FESTIVAL,
    customTypeLabel: null,
    name: 'Roda',
    description: null,
    coverImageUrl: null,
    startsAt: '2026-08-01T18:00:00.000Z',
    endsAt: '2026-08-01T20:00:00.000Z',
    isMultiDay: false,
    locationName: null,
    locationAddress: null,
    latitude: null,
    longitude: null,
    visibility: 'PUBLIC' as never,
    status: 'PUBLISHED' as never,
    capacity: null,
    waitlistPolicy: 'NONE' as never,
    seatsTaken: 0,
    seatsAvailable: null,
    waitlistCount: 0,
    publicCode: null,
    numericCode: '000001',
    qrPayload: 'capohub:v1:f:000001',
    viewerRoles: [],
    capabilities: {} as never,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTraining(
  overrides: Partial<TrainingResponseDto> = {},
): TrainingResponseDto {
  return {
    id: 'training-1',
    section: { id: 'section-1', name: 'Section', logoUrl: null },
    seriesId: null,
    startsAt: '2026-08-01T18:00:00.000Z',
    endsAt: '2026-08-01T20:00:00.000Z',
    locationName: null,
    locationAddress: null,
    latitude: null,
    longitude: null,
    trainer: { id: 'user-2', displayName: 'Trainer' },
    description: null,
    visibility: TrainingVisibility.MEMBERS_ONLY,
    allowExternalRsvp: false,
    status: TrainingStatus.SCHEDULED,
    rsvpCounts: { yes: 0, no: 0, maybe: 0 },
    viewerRsvp: null,
    management: null,
    capabilities: {
      canEdit: false,
      canCancel: false,
      canManageAttendance: false,
      canManagePlanNotes: false,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildLearningSong(
  overrides: Partial<LearningSongListItemDto> = {},
): LearningSongListItemDto {
  return {
    id: 'song-1',
    title: 'Song',
    authorName: null,
    status: 'PUBLISHED' as never,
    category: { id: 'cat-1', name: 'Category' } as never,
    tags: [],
    hasPhonetics: false,
    translationLanguages: [],
    hasMedia: false,
    createdBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    learningStatus: LearningStatus.LEARNING,
    ...overrides,
  };
}

function buildAnnouncement(
  overrides: Partial<AnnouncementResponseDto> = {},
): AnnouncementResponseDto {
  return {
    id: 'announcement-1',
    communityGroupId: 'group-1',
    communityResourceType: MembershipRequestTarget.GROUP,
    title: 'Announcement',
    body: 'Body',
    author: { id: 'user-2', displayName: 'Author' },
    recipientType: AnnouncementRecipientType.GROUP,
    recipientGroupId: null,
    isPinned: false,
    isActive: true,
    expiresAt: '2026-09-01T00:00:00.000Z',
    publishedAt: '2026-07-01T00:00:00.000Z',
    editedAt: null,
    isRead: false,
    readAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildService(options: {
  nearestEvent?: EventResponseDto | null;
  nearestTraining?: TrainingResponseDto | null;
  learningSongs?: LearningSongListItemDto[];
  announcements?: AnnouncementResponseDto[];
  unreadCount?: number;
}) {
  const findNearestEvent = jest
    .fn()
    .mockResolvedValue(options.nearestEvent ?? null);
  const findNearestForViewer = jest
    .fn()
    .mockResolvedValue(options.nearestTraining ?? null);
  const listLearningSongs = jest
    .fn()
    .mockResolvedValue(options.learningSongs ?? []);
  const listForViewer = jest.fn().mockResolvedValue({
    items: options.announcements ?? [],
    unreadCount: options.unreadCount ?? 0,
  });

  const eventsService = { findNearestEvent } as unknown as EventsService;
  const trainingsService = {
    findNearestForViewer,
  } as unknown as TrainingsService;
  const learningStatusService = {
    listLearningSongs,
  } as unknown as LearningStatusService;
  const announcementsService = {
    listForViewer,
  } as unknown as AnnouncementsService;

  return {
    service: new HomeService(
      eventsService,
      trainingsService,
      learningStatusService,
      announcementsService,
    ),
    findNearestEvent,
    findNearestForViewer,
    listLearningSongs,
    listForViewer,
  };
}

describe('HomeService', () => {
  it("returns the caller's displayName as greetingName, untouched", async () => {
    const { service } = buildService({});
    const home = await service.getHome(buildUser({ displayName: 'Ana' }));
    expect(home.greetingName).toBe('Ana');
  });

  it('returns nearestEvent/nearestTraining exactly as EventsService/TrainingsService resolve them, and passes the caller through', async () => {
    const event = buildEvent({ id: 'event-1', type: EventType.WORKSHOP });
    const training = buildTraining({ id: 'training-1' });
    const { service, findNearestEvent, findNearestForViewer } = buildService({
      nearestEvent: event,
      nearestTraining: training,
    });
    const user = buildUser();

    const home = await service.getHome(user);

    expect(home.nearestEvent).toEqual(event);
    expect(home.nearestTraining).toEqual(training);
    expect(findNearestEvent).toHaveBeenCalledTimes(1);
    expect(findNearestEvent).toHaveBeenCalledWith(user, expect.any(String));
    expect(findNearestForViewer).toHaveBeenCalledTimes(1);
    expect(findNearestForViewer).toHaveBeenCalledWith(user, expect.any(String));
  });

  it('returns null for nearestEvent/nearestTraining when nothing is upcoming', async () => {
    const { service } = buildService({});
    const home = await service.getHome(buildUser());

    expect(home.nearestEvent).toBeNull();
    expect(home.nearestTraining).toBeNull();
  });

  it('continueLearning.toReview only includes TO_REVIEW rows, with total/hasMore describing the full matching set', async () => {
    const toReview1 = buildLearningSong({
      id: 'song-review-1',
      learningStatus: LearningStatus.TO_REVIEW,
    });
    const toReview2 = buildLearningSong({
      id: 'song-review-2',
      learningStatus: LearningStatus.TO_REVIEW,
    });
    const learning = buildLearningSong({
      id: 'song-learning',
      learningStatus: LearningStatus.LEARNING,
    });
    const { service } = buildService({
      learningSongs: [toReview1, learning, toReview2],
    });

    const home = await service.getHome(buildUser());

    expect(home.continueLearning.toReview).toEqual({
      items: [toReview1, toReview2],
      total: 2,
      hasMore: false,
    });
  });

  it('caps the toReview preview and sets hasMore when there are more TO_REVIEW rows than the preview limit', async () => {
    const toReviewSongs = Array.from({ length: 12 }, (_, i) =>
      buildLearningSong({
        id: `song-review-${i}`,
        learningStatus: LearningStatus.TO_REVIEW,
      }),
    );
    const { service } = buildService({ learningSongs: toReviewSongs });

    const home = await service.getHome(buildUser());

    expect(home.continueLearning.toReview.items).toHaveLength(10);
    expect(home.continueLearning.toReview.total).toBe(12);
    expect(home.continueLearning.toReview.hasMore).toBe(true);
  });

  it('returns announcements.items/unreadCount exactly as AnnouncementsService.listForViewer resolves them, requesting at most 3', async () => {
    const announcement = buildAnnouncement({ id: 'announcement-1' });
    const { service, listForViewer } = buildService({
      announcements: [announcement],
      unreadCount: 5,
    });
    const user = buildUser();

    const home = await service.getHome(user);

    expect(home.announcements).toEqual({
      items: [announcement],
      unreadCount: 5,
    });
    expect(listForViewer).toHaveBeenCalledTimes(1);
    expect(listForViewer).toHaveBeenCalledWith(user, {
      limit: 3,
      includeUnreadCount: true,
    });
  });

  it('returns an empty announcements section when nothing is visible', async () => {
    const { service } = buildService({});
    const home = await service.getHome(buildUser());

    expect(home.announcements).toEqual({ items: [], unreadCount: 0 });
  });

  it('returns no birthdays or continueLearning.lastActive field', async () => {
    const { service } = buildService({});
    const home = await service.getHome(buildUser());

    expect(home).not.toHaveProperty('birthdays');
    expect(home.continueLearning).not.toHaveProperty('lastActive');
  });
});
