import { z } from 'zod';
import {
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';
import { CareerTimelineEntryType } from '../enums/career-timeline-entry-type.enum';

const DESCRIPTION_MAX_LENGTH = 2000;
const TITLE_MAX_LENGTH = 200;
const NAME_MAX_LENGTH = 200;
const APELIDO_MAX_LENGTH = 100;
const RANK_NAME_MAX_LENGTH = 100;
const AWARDED_BY_MAX_LENGTH = 200;
const LOCATION_MAX_LENGTH = 200;

// "YYYY", "YYYY-MM" or "YYYY-MM-DD" - see the module spec, "data
// częściowa". Future-date validation depends on "now" at write time, so it
// stays in CareerTimelineEntriesService, not here - same convention as
// every other date-not-in-future check in this codebase.
export const occurredOnPartialSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}(-\d{2}(-\d{2})?)?$/,
    'Must be YYYY, YYYY-MM, or YYYY-MM-DD',
  );

const description = optionalNullableText(DESCRIPTION_MAX_LENGTH).optional();
const location = optionalNullableText(LOCATION_MAX_LENGTH).optional();
const groupId = uuidSchema.optional();
const groupName = optionalNullableText(NAME_MAX_LENGTH).optional();
const sectionId = uuidSchema.optional();
const sectionName = optionalNullableText(NAME_MAX_LENGTH).optional();
const eventId = uuidSchema.optional();

// At least one of a relation's id/free-text name pair must be present -
// shared by every variant below that requires "which group/section" to be
// knowable (server resolves the id when given; otherwise the free text
// *is* the snapshot - see CareerTimelineEntriesService.resolveGroupRef).
function requireOneOf(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  idKey: string,
  nameKey: string,
  message: string,
) {
  if (!value[idKey] && !value[nameKey]) {
    ctx.addIssue({ code: 'custom', message, path: [nameKey] });
  }
}

const startTraining = z.object({
  type: z.literal(CareerTimelineEntryType.START_TRAINING),
  occurredOn: occurredOnPartialSchema,
  groupId,
  groupName,
  location,
  description,
});

const batizado = z.object({
  type: z.literal(CareerTimelineEntryType.BATIZADO),
  occurredOn: occurredOnPartialSchema,
  eventId,
  groupId,
  groupName,
  location,
  description,
});

const receivedApelido = z.object({
  type: z.literal(CareerTimelineEntryType.RECEIVED_APELIDO),
  occurredOn: occurredOnPartialSchema,
  apelido: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(APELIDO_MAX_LENGTH, `Must be at most ${APELIDO_MAX_LENGTH} characters`),
  awardedByName: optionalNullableText(AWARDED_BY_MAX_LENGTH).optional(),
  groupId,
  groupName,
  description,
});

const receivedRank = z.object({
  type: z.literal(CareerTimelineEntryType.RECEIVED_RANK),
  occurredOn: occurredOnPartialSchema,
  rankName: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(RANK_NAME_MAX_LENGTH, `Must be at most ${RANK_NAME_MAX_LENGTH} characters`),
  awardedByName: optionalNullableText(AWARDED_BY_MAX_LENGTH).optional(),
  groupId,
  groupName,
  eventId,
  description,
});

const joinedGroup = z
  .object({
    type: z.literal(CareerTimelineEntryType.JOINED_GROUP),
    occurredOn: occurredOnPartialSchema,
    groupId,
    groupName,
    description,
  })
  .superRefine((value, ctx) =>
    requireOneOf(value, ctx, 'groupId', 'groupName', 'Group is required'),
  );

const leftGroup = z
  .object({
    type: z.literal(CareerTimelineEntryType.LEFT_GROUP),
    occurredOn: occurredOnPartialSchema,
    groupId,
    groupName,
    description,
  })
  .superRefine((value, ctx) =>
    requireOneOf(value, ctx, 'groupId', 'groupName', 'Group is required'),
  );

const startedTeaching = z.object({
  type: z.literal(CareerTimelineEntryType.STARTED_TEACHING),
  occurredOn: occurredOnPartialSchema,
  groupId,
  groupName,
  sectionId,
  sectionName,
  location,
  description,
});

const startedSection = z
  .object({
    type: z.literal(CareerTimelineEntryType.STARTED_SECTION),
    occurredOn: occurredOnPartialSchema,
    sectionId,
    sectionName,
    groupId,
    groupName,
    location,
    description,
  })
  .superRefine((value, ctx) =>
    requireOneOf(value, ctx, 'sectionId', 'sectionName', 'Section is required'),
  );

const foundedGroup = z
  .object({
    type: z.literal(CareerTimelineEntryType.FOUNDED_GROUP),
    occurredOn: occurredOnPartialSchema,
    groupId,
    groupName,
    location,
    description,
  })
  .superRefine((value, ctx) =>
    requireOneOf(value, ctx, 'groupId', 'groupName', 'Group is required'),
  );

const importantEvent = z.object({
  type: z.literal(CareerTimelineEntryType.IMPORTANT_EVENT),
  occurredOn: occurredOnPartialSchema,
  title: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(TITLE_MAX_LENGTH, `Must be at most ${TITLE_MAX_LENGTH} characters`),
  eventId,
  location,
  description,
});

const achievement = z.object({
  type: z.literal(CareerTimelineEntryType.ACHIEVEMENT),
  occurredOn: occurredOnPartialSchema,
  title: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(TITLE_MAX_LENGTH, `Must be at most ${TITLE_MAX_LENGTH} characters`),
  description,
});

const other = z.object({
  type: z.literal(CareerTimelineEntryType.OTHER),
  occurredOn: occurredOnPartialSchema,
  title: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(TITLE_MAX_LENGTH, `Must be at most ${TITLE_MAX_LENGTH} characters`),
  description,
});

// Create and update share the exact same shape - full replace on update,
// like CreateCustomUserRankDto, simpler than tracking which individual
// fields changed.
export const careerTimelineEntrySchema = z.discriminatedUnion('type', [
  startTraining,
  batizado,
  receivedApelido,
  receivedRank,
  joinedGroup,
  leftGroup,
  startedTeaching,
  startedSection,
  foundedGroup,
  importantEvent,
  achievement,
  other,
]);

// Deliberately not a createZodDto(...) class, same as
// trainings/dto/update-training.schema.ts's own updateTrainingSchema: z.infer
// of a discriminated union is a union type, which cannot be a class's base
// constructor return type (TS2509). Only the ZodValidationPipe + these
// exported types are needed; nothing in this codebase reflects on the DTO
// class itself (no Swagger/OpenAPI).
export type CreateCareerTimelineEntryInput = z.infer<
  typeof careerTimelineEntrySchema
>;

export type UpdateCareerTimelineEntryInput = z.infer<
  typeof careerTimelineEntrySchema
>;
