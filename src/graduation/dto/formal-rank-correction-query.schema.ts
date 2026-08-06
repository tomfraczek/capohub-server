import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { FormalRankCorrectionStatus } from '../enums/formal-rank-correction-status.enum';

// page/limit, matching every other paginated list in this codebase (see
// AuditLogQuery) - not the literal limit/offset shape a caller might
// expect from the module spec's own endpoint sketch, since the project's
// own pagination convention takes precedence (see paginationQuerySchema).
export const formalRankCorrectionQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(FormalRankCorrectionStatus).optional(),
});

export class FormalRankCorrectionQueryDto extends createZodDto(
  formalRankCorrectionQuerySchema,
) {}

export type FormalRankCorrectionQuery = z.infer<
  typeof formalRankCorrectionQuerySchema
>;
