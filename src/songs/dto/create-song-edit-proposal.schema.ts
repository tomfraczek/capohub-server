import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createSongSchema } from './create-song.schema';

// POST /songs/:songId/edit-proposals takes exactly the same full-snapshot
// shape as POST /songs and PATCH /songs/:id - see create-song.schema.ts's
// own comment on why one schema covers "what a complete, valid Song looks
// like" everywhere it's needed. The snapshot is stored as SongEditProposal.
// payload verbatim (see SongEditProposalsService.create); reusing the exact
// same schema here means a proposal can never contain something the direct
// create/update path itself would have rejected.
export const createSongEditProposalSchema = createSongSchema;

export class CreateSongEditProposalDto extends createZodDto(
  createSongEditProposalSchema,
) {}

export type CreateSongEditProposalInput = z.infer<
  typeof createSongEditProposalSchema
>;
