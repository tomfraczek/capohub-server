import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { NotificationCategory } from '../enums/notification-category.enum';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Deliberately minimal (module spec section 8) - "Wszystkie" / "Nieprzeczytane"
// plus an optional category filter, since the DTO already carries category
// at near-zero extra cost. No further per-type filtering.
export const notificationListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  category: enumValuesSchema(Object.values(NotificationCategory)).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class NotificationListQueryDto extends createZodDto(
  notificationListQuerySchema,
) {}

export type NotificationListQueryInput = z.infer<
  typeof notificationListQuerySchema
>;
