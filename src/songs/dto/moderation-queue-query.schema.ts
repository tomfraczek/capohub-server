import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { SongStatus } from '../enums/song-status.enum';
import { enumValuesSchema } from './song-validation.helpers';

// The statuses GET /moderation/songs can be asked for - deliberately just
// the two a moderator currently needs (see the moderation model audit):
// PENDING_REVIEW (the actual review queue) and REJECTED (recently-decided
// history). DRAFT is excluded - it isn't submitted for review yet, so it's
// nobody's queue but its own author's (see GET /songs/my-submissions).
// PUBLISHED/HIDDEN are excluded too - once decided-and-live, a song is the
// public songbook's concern, not the moderation queue's. Kept as its own
// array (not reusing MY_SUBMISSION_STATUSES) so the two lists can diverge
// independently - e.g. adding HIDDEN here later for moderation history
// would say nothing about my-submissions.
export const MODERATION_QUEUE_STATUSES = [
  SongStatus.PENDING_REVIEW,
  SongStatus.REJECTED,
] as const;

export const moderationQueueQuerySchema = paginationQuerySchema.extend({
  status: enumValuesSchema(MODERATION_QUEUE_STATUSES).default(
    SongStatus.PENDING_REVIEW,
  ),
});

export class ModerationQueueQueryDto extends createZodDto(
  moderationQueueQuerySchema,
) {}

export type ModerationQueueQuery = z.infer<typeof moderationQueueQuerySchema>;
