import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from './song-validation.helpers';

// Shared by POST /songs/:id/reject and POST
// /songs/:songId/edit-proposals/:proposalId/reject - a single, optional
// free-text reason. Deliberately one shared schema, not two near-identical
// ones, and deliberately just this one field rather than a whole moderation-
// comments subsystem (see the moderation audit's own scope note).
export const moderationReasonSchema = z
  .object({
    reason: optionalNullableText(1000),
  })
  .strict();

export class ModerationReasonDto extends createZodDto(moderationReasonSchema) {}

export type ModerationReasonInput = z.infer<typeof moderationReasonSchema>;
