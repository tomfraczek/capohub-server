import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';
import { DEPENDENT_DISPLAY_NAME_MAX_LENGTH } from './event-validation.helpers';

const MAX_CHILDREN_PER_REGISTRATION = 20;

// A child with their own account (spec: "dziecko posiada własne konto") -
// verified against ChildrenDirectoryPort at the service layer, since no
// real Children module exists yet, this branch is currently always
// rejected with CHILDREN_DIRECTORY_NOT_AVAILABLE - see
// children-directory.port.ts and EventRsvpService.register.
const childAccountSchema = z.object({
  subjectType: z.literal('CHILD_ACCOUNT'),
  childUserId: uuidSchema,
});

// A child with no account (spec: "dziecko jest profilem zależnym") -
// captured as free text scoped to this one registration - see
// EventAttendee.dependentDisplayName.
const childDependentSchema = z.object({
  subjectType: z.literal('CHILD_DEPENDENT'),
  displayName: z.string().trim().min(1).max(DEPENDENT_DISPLAY_NAME_MAX_LENGTH),
});

export const registerForEventChildSchema = z.discriminatedUnion('subjectType', [
  childAccountSchema,
  childDependentSchema,
]);

// A single call registers the caller (optionally) and any number of their
// children at once (spec: "Podczas zapisu na Event wybiera: czy sam bierze
// udział, które dzieci zapisuje"). Re-registering someone already
// registered updates their existing EventAttendee row in place rather than
// erroring (see EventRsvpService.register) - RSVP can be changed any
// number of times.
export const registerForEventSchema = z
  .object({
    attendSelf: z.boolean().default(true),
    // Only meaningful when attendSelf is true. NOT_GOING is intentionally
    // not offered here - declining without ever registering has no row to
    // create; changing an existing registration to NOT_GOING is done via
    // the dedicated rsvp-update endpoint instead.
    selfRsvpStatus: z
      .enum([EventRsvpStatus.GOING, EventRsvpStatus.MAYBE])
      .default(EventRsvpStatus.GOING),
    children: z
      .array(registerForEventChildSchema)
      .max(
        MAX_CHILDREN_PER_REGISTRATION,
        `Must register at most ${MAX_CHILDREN_PER_REGISTRATION} children at once`,
      )
      .default([]),
  })
  .refine(
    (value) => value.attendSelf || value.children.length > 0,
    'Must register yourself and/or at least one child',
  );

export class RegisterForEventDto extends createZodDto(registerForEventSchema) {}

export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;
