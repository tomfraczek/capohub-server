import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  CreateCareerTimelineEntryInput,
  UpdateCareerTimelineEntryInput,
} from './dto/career-timeline-entry-input.schema';
import { CustomTimelineItemDto } from './dto/career-timeline-item.dto';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import { buildCustomItem } from './mappers/career-timeline.mapper';

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Owns CareerTimelineEntry - the only persisted career-timeline data (see
 * the entity's own comment); every other category is read-only and lives in
 * CareerTimelineAggregationService instead. Every method scopes its query
 * by `user: user.id`, making "not mine" and "doesn't exist" indistinguishable
 * to the caller - same IDOR-safe pattern as CustomUserRankService.
 */
@Injectable()
export class CareerTimelineEntriesService {
  constructor(private readonly em: EntityManager) {}

  async create(
    user: User,
    input: CreateCareerTimelineEntryInput,
  ): Promise<CustomTimelineItemDto> {
    const occurredOn = this.validateOccurredOn(input.occurredOn);

    const entry = new CareerTimelineEntry();
    entry.user = user;
    entry.occurredOn = occurredOn;
    entry.title = input.title;
    entry.description = input.description;

    await this.em.persist(entry).flush();
    return buildCustomItem(entry);
  }

  async list(user: User): Promise<CustomTimelineItemDto[]> {
    const entries = await this.em.find(
      CareerTimelineEntry,
      { user: user.id },
      { orderBy: { occurredOn: 'desc' } },
    );
    return entries.map(buildCustomItem);
  }

  async getById(user: User, id: string): Promise<CustomTimelineItemDto> {
    const entry = await this.loadOwn(user.id, id);
    return buildCustomItem(entry);
  }

  async update(
    user: User,
    id: string,
    input: UpdateCareerTimelineEntryInput,
  ): Promise<CustomTimelineItemDto> {
    const entry = await this.loadOwn(user.id, id);
    entry.occurredOn = this.validateOccurredOn(input.occurredOn);
    entry.title = input.title;
    entry.description = input.description;
    await this.em.flush();
    return buildCustomItem(entry);
  }

  async delete(user: User, id: string): Promise<void> {
    const entry = await this.loadOwn(user.id, id);
    await this.em.remove(entry).flush();
  }

  private validateOccurredOn(value: string): Date {
    const occurredOn = parseDateOnly(value);
    if (occurredOn.getTime() > startOfTodayUtc().getTime()) {
      throw new BadRequestException({
        code: 'CAREER_TIMELINE_ENTRY_OCCURRED_ON_IN_FUTURE',
        message: 'occurredOn cannot be in the future',
      });
    }
    return occurredOn;
  }

  private async loadOwn(
    userId: string,
    id: string,
  ): Promise<CareerTimelineEntry> {
    const entry = await this.em.findOne(CareerTimelineEntry, {
      id,
      user: userId,
    });
    if (!entry) {
      throw new NotFoundException({
        code: 'CAREER_TIMELINE_ENTRY_NOT_FOUND',
        message: 'Career timeline entry not found',
      });
    }
    return entry;
  }
}
