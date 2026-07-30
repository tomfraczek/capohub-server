import { AnnouncementResponseDto } from '../../announcements/dto/announcement-response.dto';
import { EventResponseDto } from '../../events/dto/event-response.dto';
import { LearningSongListItemDto } from '../../song-library/dto/learning-songs-list-response.dto';

// Generic capped-preview section shape, same convention as
// CommunityHomeBoundedSectionDto (see docs/api-conventions.md "Dashboard
// section shape") - `total`/`hasMore` always describe the full matching
// set, not just `items`, so a "See all" affordance never needs a second
// request just to learn whether one is warranted.
export interface HomeBoundedSectionDto<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface HomeContinueLearningDto {
  toReview: HomeBoundedSectionDto<LearningSongListItemDto>;
}

// Deliberately not the generic HomeBoundedSectionDto<T> (no `total`/
// `hasMore`) - `items` is always capped at 3 (see HomeService), and
// `unreadCount` describes the caller's *entire* cross-community unread
// count, not just how many of these 3 items are unread, so it would be
// misleading to overload `total`/`hasMore` (which the rest of this DTO
// uses for "the full matching set") for a different, broader count.
export interface HomeAnnouncementsDto {
  items: AnnouncementResponseDto[];
  unreadCount: number;
}

export interface HomeResponseDto {
  // The one name to greet the caller with - see HomeService for why this
  // is simply User.displayName (there is no separate "imię"/"login" field
  // in this codebase to prefer over it). Frontend must display this as-is,
  // never re-deriving a greeting name from `email` itself.
  greetingName: string;
  // The soonest upcoming Event (any type) the caller can see, or `null` if
  // none - see HomeService. May be the same Event as `nearestTraining`
  // when the very next thing on the caller's calendar happens to be a
  // training; the two sections are independent facts, never deduplicated.
  nearestEvent: EventResponseDto | null;
  // The soonest upcoming Event of type OPEN_TRAINING the caller can see, or
  // `null` if none.
  nearestTraining: EventResponseDto | null;
  continueLearning: HomeContinueLearningDto;
  announcements: HomeAnnouncementsDto;
}
