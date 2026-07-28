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
  nullableCoordinate,
} from './event-validation.helpers';

// Full-replace create schema - see update-event.schema.ts, which reuses
// this exact shape (status/visibility-gated fields like `status` itself
// are deliberately excluded here too: a new Event always starts as DRAFT,
// see EventsService.create).
export const createEventSchema = z
  .object({
    type: enumValuesSchema(Object.values(EventType)),
    // Required only when type === CUSTOM; must be omitted/null otherwise -
    // enforced below, not by the field's own optionality.
    customTypeLabel: optionalNullableText(CUSTOM_TYPE_LABEL_MAX_LENGTH),
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
    description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
    coverImageUrl: optionalNullableUrl(URL_MAX_LENGTH),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH),
    locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH),
    latitude: nullableCoordinate(-90, 90),
    longitude: nullableCoordinate(-180, 180),
    visibility: enumValuesSchema(Object.values(EventVisibility)),
    // null = no limit (spec: "Limit jest opcjonalny").
    capacity: z
      .number()
      .int()
      .min(1, 'Must be at least 1')
      .nullish()
      .transform((value) => (value === undefined ? null : value)),
    waitlistPolicy: enumValuesSchema(
      Object.values(EventWaitlistPolicy),
    ).default(EventWaitlistPolicy.NONE),
  })
  .superRefine((value, ctx) => {
    if (value.type === EventType.CUSTOM && !value.customTypeLabel) {
      ctx.addIssue({
        code: 'custom',
        message: 'customTypeLabel is required when type is CUSTOM',
        path: ['customTypeLabel'],
      });
    }
    if (value.type !== EventType.CUSTOM && value.customTypeLabel) {
      ctx.addIssue({
        code: 'custom',
        message: 'customTypeLabel is only allowed when type is CUSTOM',
        path: ['customTypeLabel'],
      });
    }
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
  });

export class CreateEventDto extends createZodDto(createEventSchema) {}

export type CreateEventInput = z.infer<typeof createEventSchema>;
