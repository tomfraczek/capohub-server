import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Event } from '../events/entities/event.entity';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import {
  CreateCareerTimelineEntryInput,
  UpdateCareerTimelineEntryInput,
} from './dto/career-timeline-entry-input.schema';
import { CareerTimelineItemDto } from './dto/career-timeline-item.dto';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelinePrecision,
} from './enums/career-timeline-entry-type.enum';
import { buildManualItem } from './mappers/career-timeline.mapper';

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// "YYYY" -> YEAR (normalized to Jan 1), "YYYY-MM" -> MONTH (normalized to
// the 1st), "YYYY-MM-DD" -> DAY - see the module spec, "data częściowa".
// Format is already guaranteed by occurredOnPartialSchema at this point.
function parsePartialDate(value: string): {
  occurredOn: Date;
  precision: CareerTimelinePrecision;
} {
  const parts = value.split('-');
  if (parts.length === 1) {
    return {
      occurredOn: new Date(Date.UTC(Number(parts[0]), 0, 1)),
      precision: CareerTimelinePrecision.YEAR,
    };
  }
  if (parts.length === 2) {
    return {
      occurredOn: new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1)),
      precision: CareerTimelinePrecision.MONTH,
    };
  }
  return {
    occurredOn: new Date(`${value}T00:00:00.000Z`),
    precision: CareerTimelinePrecision.DAY,
  };
}

// "In the future" is judged at the same granularity the user actually
// entered - a bare "2026" is only in the future once the current year
// exceeds it, not the instant it's after today's month/day.
function isInFuture(
  occurredOn: Date,
  precision: CareerTimelinePrecision,
): boolean {
  const today = startOfTodayUtc();
  if (precision === CareerTimelinePrecision.DAY) {
    return occurredOn.getTime() > today.getTime();
  }
  if (precision === CareerTimelinePrecision.MONTH) {
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    return occurredOn.getTime() > monthStart.getTime();
  }
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  return occurredOn.getTime() > yearStart.getTime();
}

interface ResolvedRelation<T> {
  entity: T | null;
  nameSnapshot: string | null;
}

interface ResolvedEvent {
  entity: Event | null;
  nameSnapshot: string | null;
  startsAtSnapshot: Date | null;
  locationNameSnapshot: string | null;
}

/**
 * Owns CareerTimelineEntry - the only persisted career-timeline data (see
 * the entity's own comment); every SYSTEM item is read-only and lives in
 * CareerTimelineAggregationService instead. Every method scopes its query
 * by `user: user.id`, making "not mine" and "doesn't exist" indistinguishable
 * to the caller - same IDOR-safe pattern as CustomUserRankService.
 *
 * Also owns title generation (buildTitle): for every type except
 * OTHER/IMPORTANT_EVENT/ACHIEVEMENT, the title is derived server-side from
 * the type-specific fields, never sent by the client - see the module
 * spec, "Tytuł wpisu".
 */
@Injectable()
export class CareerTimelineEntriesService {
  constructor(
    private readonly em: EntityManager,
    private readonly r2StorageService: R2StorageService,
  ) {}

  async create(
    user: User,
    input: CreateCareerTimelineEntryInput,
  ): Promise<CareerTimelineItemDto> {
    const entry = new CareerTimelineEntry();
    entry.user = user;
    await this.applyInput(entry, input);
    await this.em.persist(entry).flush();
    return buildManualItem(entry, this.r2StorageService);
  }

  async list(user: User): Promise<CareerTimelineItemDto[]> {
    const entries = await this.em.find(
      CareerTimelineEntry,
      { user: user.id },
      {
        orderBy: { occurredOn: 'desc' },
        populate: ['group', 'section', 'event'],
      },
    );
    return entries.map((entry) =>
      buildManualItem(entry, this.r2StorageService),
    );
  }

  async getById(user: User, id: string): Promise<CareerTimelineItemDto> {
    const entry = await this.loadOwn(user.id, id);
    return buildManualItem(entry, this.r2StorageService);
  }

  async update(
    user: User,
    id: string,
    input: UpdateCareerTimelineEntryInput,
  ): Promise<CareerTimelineItemDto> {
    const entry = await this.loadOwn(user.id, id);
    await this.applyInput(entry, input);
    await this.em.flush();
    return buildManualItem(entry, this.r2StorageService);
  }

  async delete(user: User, id: string): Promise<void> {
    const entry = await this.loadOwn(user.id, id);
    await this.em.remove(entry).flush();
  }

  private async applyInput(
    entry: CareerTimelineEntry,
    input: CreateCareerTimelineEntryInput,
  ): Promise<void> {
    const { occurredOn, precision } = parsePartialDate(input.occurredOn);
    if (isInFuture(occurredOn, precision)) {
      throw new BadRequestException({
        code: 'CAREER_TIMELINE_ENTRY_OCCURRED_ON_IN_FUTURE',
        message: 'occurredOn cannot be in the future',
      });
    }
    entry.occurredOn = occurredOn;
    entry.occurredOnPrecision = precision;
    entry.type = input.type;
    entry.description = input.description ?? null;

    // Reset every optional field before repopulating - update() reuses
    // this on an existing row, and a type change (or simply omitting a
    // field this time) must not leave a stale value from a previous edit.
    entry.group = null;
    entry.groupNameSnapshot = null;
    entry.section = null;
    entry.sectionNameSnapshot = null;
    entry.event = null;
    entry.eventNameSnapshot = null;
    entry.eventStartsAtSnapshot = null;
    entry.eventLocationNameSnapshot = null;
    entry.apelido = null;
    entry.rankName = null;
    entry.awardedByName = null;
    entry.location = null;

    switch (input.type) {
      case CareerTimelineEntryType.START_TRAINING: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.location = input.location ?? null;
        entry.title = 'Rozpoczęcie treningów Capoeira';
        break;
      }
      case CareerTimelineEntryType.BATIZADO: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        const batizadoEvent = await this.resolveEvent(input.eventId);
        entry.event = batizadoEvent.entity;
        entry.eventNameSnapshot = batizadoEvent.nameSnapshot;
        entry.eventStartsAtSnapshot = batizadoEvent.startsAtSnapshot;
        entry.eventLocationNameSnapshot = batizadoEvent.locationNameSnapshot;
        entry.location = input.location ?? null;
        entry.title = 'Batizado';
        break;
      }
      case CareerTimelineEntryType.RECEIVED_APELIDO: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.apelido = input.apelido;
        entry.awardedByName = input.awardedByName ?? null;
        entry.title = `Otrzymanie apelido „${input.apelido}”`;
        break;
      }
      case CareerTimelineEntryType.RECEIVED_RANK: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        const receivedRankEvent = await this.resolveEvent(input.eventId);
        entry.event = receivedRankEvent.entity;
        entry.eventNameSnapshot = receivedRankEvent.nameSnapshot;
        entry.eventStartsAtSnapshot = receivedRankEvent.startsAtSnapshot;
        entry.eventLocationNameSnapshot =
          receivedRankEvent.locationNameSnapshot;
        entry.rankName = input.rankName;
        entry.awardedByName = input.awardedByName ?? null;
        entry.title = `Otrzymanie stopnia ${input.rankName}`;
        break;
      }
      case CareerTimelineEntryType.JOINED_GROUP: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.title = `Dołączenie do ${group.nameSnapshot}`;
        break;
      }
      case CareerTimelineEntryType.LEFT_GROUP: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.title = `Odejście z ${group.nameSnapshot}`;
        break;
      }
      case CareerTimelineEntryType.STARTED_TEACHING: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        const section = await this.resolveSection(
          input.sectionId,
          input.sectionName,
        );
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.section = section.entity;
        entry.sectionNameSnapshot = section.nameSnapshot;
        entry.location = input.location ?? null;
        entry.title = 'Rozpoczęcie prowadzenia treningów';
        break;
      }
      case CareerTimelineEntryType.STARTED_SECTION: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        const section = await this.resolveSection(
          input.sectionId,
          input.sectionName,
        );
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.section = section.entity;
        entry.sectionNameSnapshot = section.nameSnapshot;
        entry.location = input.location ?? null;
        entry.title = input.location
          ? `Rozpoczęcie prowadzenia sekcji w ${input.location}`
          : 'Rozpoczęcie prowadzenia sekcji';
        break;
      }
      case CareerTimelineEntryType.FOUNDED_GROUP: {
        const group = await this.resolveGroup(input.groupId, input.groupName);
        entry.group = group.entity;
        entry.groupNameSnapshot = group.nameSnapshot;
        entry.location = input.location ?? null;
        entry.title = `Założenie ${group.nameSnapshot}`;
        break;
      }
      case CareerTimelineEntryType.IMPORTANT_EVENT: {
        const importantEvent = await this.resolveEvent(input.eventId);
        entry.event = importantEvent.entity;
        entry.eventNameSnapshot = importantEvent.nameSnapshot;
        entry.eventStartsAtSnapshot = importantEvent.startsAtSnapshot;
        entry.eventLocationNameSnapshot = importantEvent.locationNameSnapshot;
        entry.location = input.location ?? null;
        entry.title = input.title;
        break;
      }
      case CareerTimelineEntryType.ACHIEVEMENT: {
        entry.title = input.title;
        break;
      }
      case CareerTimelineEntryType.OTHER: {
        entry.title = input.title;
        break;
      }
    }
  }

  private async resolveGroup(
    groupId: string | undefined,
    groupName: string | null | undefined,
  ): Promise<ResolvedRelation<Group>> {
    if (groupId) {
      const group = await this.em.findOne(Group, { id: groupId });
      if (!group) {
        throw new BadRequestException({
          code: 'CAREER_TIMELINE_ENTRY_GROUP_NOT_FOUND',
          message: 'Group not found',
        });
      }
      return { entity: group, nameSnapshot: group.name };
    }
    if (groupName) {
      return { entity: null, nameSnapshot: groupName };
    }
    return { entity: null, nameSnapshot: null };
  }

  private async resolveSection(
    sectionId: string | undefined,
    sectionName: string | null | undefined,
  ): Promise<ResolvedRelation<Section>> {
    if (sectionId) {
      const section = await this.em.findOne(Section, { id: sectionId });
      if (!section) {
        throw new BadRequestException({
          code: 'CAREER_TIMELINE_ENTRY_SECTION_NOT_FOUND',
          message: 'Section not found',
        });
      }
      return { entity: section, nameSnapshot: section.name };
    }
    if (sectionName) {
      return { entity: null, nameSnapshot: sectionName };
    }
    return { entity: null, nameSnapshot: null };
  }

  private async resolveEvent(
    eventId: string | undefined,
  ): Promise<ResolvedEvent> {
    if (!eventId) {
      return {
        entity: null,
        nameSnapshot: null,
        startsAtSnapshot: null,
        locationNameSnapshot: null,
      };
    }
    const event = await this.em.findOne(Event, { id: eventId });
    if (!event) {
      throw new BadRequestException({
        code: 'CAREER_TIMELINE_ENTRY_EVENT_NOT_FOUND',
        message: 'Event not found',
      });
    }
    return {
      entity: event,
      nameSnapshot: event.name,
      startsAtSnapshot: event.startsAt,
      locationNameSnapshot: event.locationName,
    };
  }

  private async loadOwn(
    userId: string,
    id: string,
  ): Promise<CareerTimelineEntry> {
    const entry = await this.em.findOne(
      CareerTimelineEntry,
      { id, user: userId },
      { populate: ['group', 'section', 'event'] },
    );
    if (!entry) {
      throw new NotFoundException({
        code: 'CAREER_TIMELINE_ENTRY_NOT_FOUND',
        message: 'Career timeline entry not found',
      });
    }
    return entry;
  }
}
