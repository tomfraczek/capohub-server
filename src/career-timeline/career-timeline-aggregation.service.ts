import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from '../events/event-access.service';
import { Event } from '../events/entities/event.entity';
import { FormalRankCorrectionService } from '../graduation/formal-rank-correction.service';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { Group } from '../groups/entities/group.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { Section } from '../groups/entities/section.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { findPossibleDuplicateSystemId } from './career-timeline-duplicate-detection';
import { CareerTimelineQueryInput } from './dto/career-timeline-query.schema';
import { CareerTimelineItemDto } from './dto/career-timeline-item.dto';
import { CareerTimelineResponseDto } from './dto/career-timeline-response.dto';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelineOrigin,
} from './enums/career-timeline-entry-type.enum';
import {
  buildFoundedGroupItem,
  buildIndependentRankItem,
  buildJoinedGroupItem,
  buildLeftGroupItem,
  buildManualItem,
  buildReceivedRankItem,
  buildStartedSectionItem,
  buildStartedTeachingItem,
  buildStartTrainingItem,
} from './mappers/career-timeline.mapper';

const ALL_TYPES = Object.values(CareerTimelineEntryType);

const RANK_POPULATE = ['rank.cordSegments', 'sourceGroup', 'event'] as const;

/**
 * Read-time aggregation across every career-timeline source (see the module
 * spec, "Model agregacji"): nothing is copied into a single table except
 * manual entries (CareerTimelineEntry). Every SYSTEM type is built fresh,
 * per request, from its owning source - User.capoeiraStartedAt,
 * FormalGroupAffiliation, FormalRankAssignment, RoleAssignment - then
 * merged, filtered, sorted and paginated in application code. There is no
 * background sync job of any kind, and consequently no duplicate-detection
 * machinery is needed either: a SYSTEM item can never be written twice,
 * because it is never written at all.
 *
 * There is deliberately no EVENT-per-attendance category any more (removed
 * per the redesign spec §1/§23 - "Nie twórz historii każdego eventu"; the
 * previous version of this service built one SYSTEM item per attended
 * Event, which amounted to an activity feed). An Event now only surfaces
 * inside a career-timeline item as an optional evidence link
 * (BATIZADO/RECEIVED_RANK/IMPORTANT_EVENT can reference one) - never as a
 * standalone automatic entry.
 *
 * Visibility is resolved once per type, per request:
 *  - the owner (isOwner) always sees everything;
 *  - a non-owner viewer only sees the whole endpoint at all when
 *    `target.showCareerTimeline` is true, and even then each type is
 *    additionally gated by the privacy toggle for its *underlying* source
 *    data (showFormalGroup, showFormalRank) - never a per-type timeline
 *    toggle of its own (explicitly rejected by the spec). STARTED_TEACHING/
 *    STARTED_SECTION/FOUNDED_GROUP reuse showFormalGroup, since they are
 *    all derived from the same RoleAssignment source as group affiliation.
 *  - RECEIVED_RANK (SYSTEM) reuses FormalRankCorrectionService.isPubliclyVisible
 *    rather than re-deriving the rule.
 *
 * FOUNDED_GROUP/STARTED_SECTION are the one exception to "nothing here is
 * ever re-derived from RoleAssignment": they read Group.founderUser /
 * Section.founderUser directly - a permanent record set once at creation
 * time (see those entities' own comments) - rather than the earliest-ever
 * OWNER RoleAssignment. A founder's RoleAssignment row can be physically
 * deleted (UserService.deleteLocalAccountData hard-deletes every
 * RoleAssignment for a deleted account); founderUser cannot silently
 * reattribute itself to a later owner the way a RoleAssignment-derived
 * "earliest owner" query would.
 */
@Injectable()
export class CareerTimelineAggregationService {
  constructor(
    private readonly em: EntityManager,
    private readonly formalRankCorrectionService: FormalRankCorrectionService,
    private readonly r2StorageService: R2StorageService,
    private readonly eventAccessService: EventAccessService,
  ) {}

  async getTimeline(
    viewer: User,
    targetUserId: string,
    query: CareerTimelineQueryInput,
  ): Promise<CareerTimelineResponseDto> {
    const target =
      viewer.id === targetUserId
        ? viewer
        : await this.em.findOne(User, { id: targetUserId });
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    const isOwner = viewer.id === target.id;

    if (!isOwner && !target.showCareerTimeline) {
      return { items: [], total: 0, hasMore: false };
    }

    const types = new Set(query.types ?? ALL_TYPES);
    const items: CareerTimelineItemDto[] = [];

    if (
      types.has(CareerTimelineEntryType.START_TRAINING) &&
      (isOwner || target.showCapoeiraStartedAt) &&
      target.capoeiraStartedAt
    ) {
      items.push(buildStartTrainingItem(target));
    }

    if (
      (types.has(CareerTimelineEntryType.JOINED_GROUP) ||
        types.has(CareerTimelineEntryType.LEFT_GROUP)) &&
      (isOwner || target.showFormalGroup)
    ) {
      const affiliations = await this.em.find(
        FormalGroupAffiliation,
        { user: target.id },
        { populate: ['group'] },
      );
      for (const affiliation of affiliations) {
        if (
          types.has(CareerTimelineEntryType.JOINED_GROUP) &&
          affiliation.startedOn
        ) {
          items.push(buildJoinedGroupItem(affiliation));
        }
        if (
          types.has(CareerTimelineEntryType.LEFT_GROUP) &&
          affiliation.endedOn
        ) {
          items.push(buildLeftGroupItem(affiliation));
        }
      }
    }

    if (
      types.has(CareerTimelineEntryType.RECEIVED_RANK) &&
      (isOwner || target.showFormalRank)
    ) {
      const assignments = await this.em.find(
        FormalRankAssignment,
        { user: target.id, startedOn: { $ne: null } },
        { populate: RANK_POPULATE },
      );
      for (const assignment of assignments) {
        if (!isOwner) {
          const visible =
            await this.formalRankCorrectionService.isPubliclyVisible(
              assignment.id,
            );
          if (!visible) {
            continue;
          }
        }
        const includeEvent = await this.isEventVisibleToViewer(
          viewer,
          isOwner,
          assignment.event,
        );
        items.push(
          buildReceivedRankItem(
            assignment,
            this.r2StorageService,
            includeEvent,
          ),
        );
      }
      // Independent-rank stints - current and past (see
      // buildIndependentRankItem). Same showFormalRank gate as on the
      // public profile.
      const independentRanks = await this.em.find(
        CustomUserRank,
        { user: target.id },
        { populate: ['cordSegments'] },
      );
      for (const customRank of independentRanks) {
        items.push(buildIndependentRankItem(customRank));
      }
    }

    if (
      types.has(CareerTimelineEntryType.STARTED_TEACHING) &&
      (isOwner || target.showFormalGroup)
    ) {
      for (const roleAssignment of await this.earliestRoleGrantsPerSection(
        target.id,
        GroupRole.INSTRUCTOR,
      )) {
        items.push(buildStartedTeachingItem(roleAssignment));
      }
    }

    if (
      types.has(CareerTimelineEntryType.STARTED_SECTION) &&
      (isOwner || target.showFormalGroup)
    ) {
      const foundedSections = await this.em.find(
        Section,
        { founderUser: target.id },
        { populate: ['parentGroup'] },
      );
      for (const section of foundedSections) {
        items.push(buildStartedSectionItem(section));
      }
    }

    if (
      types.has(CareerTimelineEntryType.FOUNDED_GROUP) &&
      (isOwner || target.showFormalGroup)
    ) {
      const foundedGroups = await this.em.find(Group, {
        founderUser: target.id,
      });
      for (const group of foundedGroups) {
        items.push(buildFoundedGroupItem(group));
      }
    }

    // MANUAL entries can be any of the 12 types (including one that also
    // has a SYSTEM counterpart, e.g. a manually-logged JOINED_GROUP for a
    // pre-CapoHub group) - so every requested type is checked against the
    // persisted table too, not just its SYSTEM source above.
    const manualTypes = ALL_TYPES.filter((type) => types.has(type));
    if (manualTypes.length > 0 && (isOwner || target.showCareerTimeline)) {
      const entries = await this.em.find(
        CareerTimelineEntry,
        { user: target.id, type: { $in: manualTypes } },
        { populate: ['group', 'section', 'event'] },
      );
      for (const entry of entries) {
        const includeEvent = await this.isEventVisibleToViewer(
          viewer,
          isOwner,
          entry.event,
        );
        items.push(buildManualItem(entry, this.r2StorageService, includeEvent));
      }
    }

    // Flags each MANUAL item that might describe the same real-world fact
    // as one of the SYSTEM items just built (redesign audit §2) - a hint
    // only, computed fresh every request, never persisted or auto-resolved.
    // Owner-only: this is a nudge for the person who might want to tidy up
    // their own history, not something a viewer of someone else's public
    // profile has any use for.
    if (isOwner) {
      const systemItems = items.filter(
        (item) => item.origin === CareerTimelineOrigin.SYSTEM,
      );
      for (const item of items) {
        if (item.origin === CareerTimelineOrigin.MANUAL) {
          item.possibleDuplicateOfId = findPossibleDuplicateSystemId(
            item,
            systemItems,
          );
        }
      }
    }

    const filtered = items.filter((item) => {
      if (query.dateFrom && item.occurredOn < query.dateFrom) {
        return false;
      }
      if (query.dateTo && item.occurredOn > query.dateTo) {
        return false;
      }
      return true;
    });

    // Descending by occurredOn, deterministic tie-break by the item's own
    // stable id (see the module spec, "z deterministycznym tie-breakerem") -
    // any consistent secondary key works, the id is simply already unique
    // and available.
    filtered.sort((a, b) => {
      if (a.occurredOn !== b.occurredOn) {
        return a.occurredOn < b.occurredOn ? 1 : -1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const total = filtered.length;
    const page = filtered.slice(query.offset, query.offset + query.limit);
    const hasMore = query.offset + page.length < total;

    return { items: page, total, hasMore };
  }

  /**
   * Finds `target`'s own RoleAssignment(`role`) rows on Sections, one per
   * distinct Section, each keyed by the *earliest-ever* grant of that role
   * to `target` there - including revoked rows (a role can be revoked
   * later without the historical fact "I started teaching this Section in
   * year X" ceasing to be true; see the module spec §12, "historia jest
   * historyczna"). Used only by STARTED_TEACHING now - STARTED_SECTION/
   * FOUNDED_GROUP moved to Section.founderUser/Group.founderUser (see
   * getTimeline), a permanent record that cannot be silently reattributed
   * to a different user the way an "earliest-ever OWNER RoleAssignment"
   * query could once the true founder's own row is gone.
   */
  private async earliestRoleGrantsPerSection(
    userId: string,
    role: GroupRole,
  ): Promise<RoleAssignment[]> {
    const own = await this.em.find(
      RoleAssignment,
      { user: userId, role, section: { $ne: null } },
      { populate: ['section', 'section.parentGroup'] },
    );

    const earliestPerSection = new Map<string, RoleAssignment>();
    for (const row of own) {
      const sectionId = row.section!.id;
      const existing = earliestPerSection.get(sectionId);
      if (!existing || this.isEarlier(row, existing)) {
        earliestPerSection.set(sectionId, row);
      }
    }
    return [...earliestPerSection.values()];
  }

  /**
   * Whether `event` (a linked-Event evidence reference on a RECEIVED_RANK
   * or MANUAL item) may have its own details shown to `viewer` - the
   * career-timeline fact itself (rank/title/date) is never gated by this,
   * only the Event sub-reference (redesign audit §3: a private Event's
   * name/community/location must not leak through someone else's public
   * career timeline just because they linked it). The owner always sees
   * their own linked Events regardless of the Event's own visibility
   * setting - same "isOwner bypasses everything" convention as the rest of
   * this service.
   */
  private async isEventVisibleToViewer(
    viewer: User,
    isOwner: boolean,
    event: Event | null,
  ): Promise<boolean> {
    if (isOwner || !event) {
      return true;
    }
    return this.eventAccessService.isVisibleToViewer(
      this.em,
      event,
      viewer.id,
      viewer.email,
    );
  }

  private isEarlier(a: RoleAssignment, b: RoleAssignment): boolean {
    if (a.grantedAt.getTime() !== b.grantedAt.getTime()) {
      return a.grantedAt.getTime() < b.grantedAt.getTime();
    }
    return a.id < b.id;
  }
}
