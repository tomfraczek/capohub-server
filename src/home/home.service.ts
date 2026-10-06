import { Injectable } from '@nestjs/common';
import { AnnouncementsService } from '../announcements/announcements.service';
import { EventsService } from '../events/events.service';
import { LearningStatus } from '../song-library/enums/learning-status.enum';
import { LearningStatusService } from '../song-library/learning-status.service';
import { TrainingsService } from '../trainings/trainings.service';
import { User } from '../users/entities/user.entity';
import { HomeResponseDto } from './dto/home-response.dto';

// Caps the "songs to review" preview the same way every other dashboard
// section in this codebase caps its preview (see docs/api-conventions.md
// "Dashboard section shape" and CommunityHomeService.PENDING_SECTION_LIMIT)
// - a small, fixed preview with total/hasMore, never the full list.
const TO_REVIEW_PREVIEW_LIMIT = 10;

// At most 3 active Announcements, per the Home contract (task
// requirement) - AnnouncementsService.listForViewer already resolves the
// full unread count independent of this cap (see HomeAnnouncementsDto).
const ANNOUNCEMENTS_PREVIEW_LIMIT = 3;

// Backs the mobile app's Home screen. Purely a composition layer: every
// section here is read from an existing, already-authorized service
// (EventsService.findNearestEvent / TrainingsService.findNearestForViewer -
// same viewer-scoped visibility rule GET /events and GET .../trainings
// themselves run; LearningStatusService.listLearningSongs - the same data
// GET /users/me/learning-songs returns; AnnouncementsService.listForViewer -
// the same visibility/sorting rule the community-scoped announcements list
// endpoint uses) and reshaped into the specific facts the Home screen
// needs. No section here re-implements or duplicates any business rule
// already owned by those services - a query filter change (e.g. what
// counts as "upcoming", which Events/Trainings/Announcements a viewer may
// see) belongs in EventsService/TrainingsService/AnnouncementsService, not
// here.
//
// Deliberately still has no "birthdays" section: User carries no birth
// date field anywhere in this codebase. Inventing it inside this
// aggregator would put real business logic in the wrong layer, and a
// permanently-empty placeholder section would misrepresent a feature this
// backend does not actually implement yet - it will be added to this
// contract only once its own business module (a birth-date field on User,
// or wherever it belongs) exists to back it.
@Injectable()
export class HomeService {
  constructor(
    private readonly eventsService: EventsService,
    private readonly trainingsService: TrainingsService,
    private readonly learningStatusService: LearningStatusService,
    private readonly announcementsService: AnnouncementsService,
  ) {}

  async getHome(user: User): Promise<HomeResponseDto> {
    const now = new Date().toISOString();

    // Sequential, not Promise.all - concurrent queries on the same
    // request-scoped EntityManager corrupt the underlying pg connection
    // (see CapoHub's other services' identical comment on this pattern).
    const nearestEvent = await this.eventsService.findNearestEvent(user, now);
    const nearestTraining = await this.trainingsService.findNearestForViewer(
      user,
      now,
    );
    const learningSongs = await this.learningStatusService.listLearningSongs(
      user.id,
    );
    const announcements = await this.announcementsService.listForViewer(user, {
      limit: ANNOUNCEMENTS_PREVIEW_LIMIT,
      includeUnreadCount: true,
    });

    const toReviewItems = learningSongs.filter(
      (item) => item.learningStatus === LearningStatus.TO_REVIEW,
    );
    const toReviewPreview = toReviewItems.slice(0, TO_REVIEW_PREVIEW_LIMIT);

    return {
      greetingName: resolveGreetingName(user),
      nearestEvent,
      nearestTraining,
      continueLearning: {
        toReview: {
          items: toReviewPreview,
          total: toReviewItems.length,
          hasMore: toReviewItems.length > toReviewPreview.length,
        },
      },
      announcements: {
        items: announcements.items,
        unreadCount: announcements.unreadCount,
      },
    };
  }
}

// Who the caller is in capoeira first: their apelido whenever they have
// one, else their first name from the profile, and only then the account
// displayName (generated once from the email local-part, e.g.
// "Tomasfr90" - never something the user chose to be called).
export function resolveGreetingName(user: User): string {
  const apelido = user.apelido?.trim();
  if (apelido) {
    return apelido;
  }
  const firstName = user.firstName?.trim();
  if (firstName) {
    return firstName;
  }
  return user.displayName;
}
