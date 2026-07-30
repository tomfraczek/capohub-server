import { Injectable } from '@nestjs/common';
import { AnnouncementsService } from '../announcements/announcements.service';
import { EventsService } from '../events/events.service';
import { LearningStatus } from '../song-library/enums/learning-status.enum';
import { LearningStatusService } from '../song-library/learning-status.service';
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
// (EventsService.findNearestEventAndTraining - same viewer-scoped
// visibility rule GET /events itself runs, just resolved once for both
// facts instead of via two independent listForViewer calls - see that
// method's own comment; LearningStatusService.listLearningSongs - the same
// data GET /users/me/learning-songs returns; AnnouncementsService.listForViewer -
// the same visibility/sorting rule the community-scoped announcements list
// endpoint uses) and reshaped into the specific facts the Home screen
// needs. No section here re-implements or duplicates any business rule
// already owned by those services - a query filter change (e.g. what
// counts as "upcoming", which Events/Announcements a viewer may see)
// belongs in EventsService/AnnouncementsService, not here.
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
    private readonly learningStatusService: LearningStatusService,
    private readonly announcementsService: AnnouncementsService,
  ) {}

  async getHome(user: User): Promise<HomeResponseDto> {
    const now = new Date().toISOString();

    const [{ nearestEvent, nearestTraining }, learningSongs, announcements] =
      await Promise.all([
        this.eventsService.findNearestEventAndTraining(user, now),
        this.learningStatusService.listLearningSongs(user.id),
        this.announcementsService.listForViewer(
          user,
          ANNOUNCEMENTS_PREVIEW_LIMIT,
        ),
      ]);

    const toReviewItems = learningSongs.filter(
      (item) => item.learningStatus === LearningStatus.TO_REVIEW,
    );
    const toReviewPreview = toReviewItems.slice(0, TO_REVIEW_PREVIEW_LIMIT);

    return {
      // The one and only name field this codebase tracks for a user beyond
      // `email` - already generated once at account creation from the
      // email local-part (see generateDisplayNameFromEmail) and never
      // overwritten afterwards, so it already *is* the best available name
      // to greet the caller with.
      greetingName: user.displayName,
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
