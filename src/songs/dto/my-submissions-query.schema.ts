import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { SongStatus } from '../enums/song-status.enum';
import { enumValuesSchema } from './song-validation.helpers';

// The statuses a Song can have while it is still the caller's own private
// submission, not yet (or no longer) part of the public songbook - see
// GET /songs/my-submissions and the moderation model. PUBLISHED is
// deliberately excluded: a published song already lives in GET /songs, so
// it has no business being repeated here. HIDDEN is deliberately excluded
// too - it was PUBLISHED at some point and was taken down by a moderator,
// which makes it moderation history rather than an in-progress submission;
// see the moderation model audit for the reasoning and duplicate-
// suggestions.query.ts's OWN_ONLY_STATUSES for the same HIDDEN exclusion
// made independently, for a different endpoint.
export const MY_SUBMISSION_STATUSES = [
  SongStatus.DRAFT,
  SongStatus.PENDING_REVIEW,
  SongStatus.REJECTED,
] as const;

export const mySubmissionsQuerySchema = paginationQuerySchema.extend({
  status: enumValuesSchema(MY_SUBMISSION_STATUSES).optional(),
});

export class MySubmissionsQueryDto extends createZodDto(
  mySubmissionsQuerySchema,
) {}

export type MySubmissionsQuery = z.infer<typeof mySubmissionsQuerySchema>;
