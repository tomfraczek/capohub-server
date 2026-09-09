import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableUrl } from '../../groups/dto/group-validation.helpers';
import {
  enumValuesSchema,
  optionalNullableText,
} from '../../songs/dto/song-validation.helpers';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';
import {
  CUSTOM_TYPE_LABEL_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  LOCATION_ADDRESS_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  NAME_MAX_LENGTH,
  URL_MAX_LENGTH,
  isoDateTimeSchema,
} from './event-validation.helpers';

// Shared by create and update - see update-event.schema.ts, which reuses
// this exact shape minus `type`/`customTypeLabel` (immutable after
// creation, see event.entity.ts) and `status` (never set here at all: a
// new Event always starts as DRAFT and only ever changes status through
// the publish/cancel/finish actions - see EventsService).
export const eventBaseSchema = z.object({
  type: enumValuesSchema(Object.values(EventType)),
  // Required only when type === OTHER; must be omitted/null otherwise -
  // enforced below, not by the field's own optionality.
  customTypeLabel: optionalNullableText(CUSTOM_TYPE_LABEL_MAX_LENGTH),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
  coverImageUrl: optionalNullableUrl(URL_MAX_LENGTH),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH),
  locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH),
  visibility: enumValuesSchema(Object.values(EventVisibility)),
  // null = no limit (spec: "Limit jest opcjonalny").
  capacity: z
    .number()
    .int()
    .min(1, 'Must be at least 1')
    .nullish()
    .transform((value) => (value === undefined ? null : value)),
  waitlistPolicy: enumValuesSchema(Object.values(EventWaitlistPolicy)).default(
    EventWaitlistPolicy.NONE,
  ),
});

// Shared between create and update - date range and waitlist/capacity
// consistency checks apply regardless of whether `type`/`customTypeLabel`
// are even part of the schema being validated.
export function refineEventDateAndWaitlist(
  value: {
    startsAt: string;
    endsAt: string;
    capacity: number | null | undefined;
    waitlistPolicy: EventWaitlistPolicy;
  },
  ctx: z.RefinementCtx,
): void {
  if (new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
    ctx.addIssue({
      code: 'custom',
      message: 'endsAt must not be before startsAt',
      path: ['endsAt'],
    });
  }
  if (
    value.capacity == null &&
    value.waitlistPolicy !== EventWaitlistPolicy.NONE
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'waitlistPolicy must be NONE when there is no capacity limit',
      path: ['waitlistPolicy'],
    });
  }
}

export const createEventSchema = eventBaseSchema.superRefine((value, ctx) => {
  if (value.type === EventType.OTHER && !value.customTypeLabel) {
    ctx.addIssue({
      code: 'custom',
      message: 'customTypeLabel is required when type is OTHER',
      path: ['customTypeLabel'],
    });
  }
  if (value.type !== EventType.OTHER && value.customTypeLabel) {
    ctx.addIssue({
      code: 'custom',
      message: 'customTypeLabel is only allowed when type is OTHER',
      path: ['customTypeLabel'],
    });
  }
  refineEventDateAndWaitlist(value, ctx);
});

export class CreateEventDto extends createZodDto(createEventSchema) {}

export type CreateEventInput = z.infer<typeof createEventSchema>;
