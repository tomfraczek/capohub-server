import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { Group } from '../groups/entities/group.entity';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { GroupMembershipStatus } from '../groups/enums/group-membership-status.enum';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import { CancelEventInput } from './dto/cancel-event.schema';
import { CreateEventInput } from './dto/create-event.schema';
import { EventCapabilitiesDto } from './dto/event-capabilities.dto';
import { EventListQueryInput } from './dto/event-list-query.schema';
import { EventResponseDto } from './dto/event-response.dto';
import { UpdateEventInput } from './dto/update-event.schema';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventInvitation } from './entities/event-invitation.entity';
import { EventRoleAssignment } from './entities/event-role-assignment.entity';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { Event } from './entities/event.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { EventRole } from './enums/event-role.enum';
import { EventRsvpStatus } from './enums/event-rsvp-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { EventRolesService } from './event-roles.service';
import {
  ADMIN_OPERATION_STATUSES,
  assertEventStatusAllowed,
  reconcileEventFinished,
} from './event-write-policy';
import { toEventResponseDto } from './mappers/event.mapper';
import { EventPermission } from './permissions/event-permission.enum';
import { EventPermissionService } from './permissions/event-permission.service';

export interface EventListResult {
  items: EventResponseDto[];
  total: number;
  hasMore: boolean;
}

// Creation, editing, listing/reading, and the DRAFT -> PUBLISHED ->
// CANCELLED/FINISHED lifecycle - see event-write-policy.ts for the status
// transition rules and events-api.md for the full endpoint reference.
@Injectable()
export class EventsService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
    private readonly eventRolesService: EventRolesService,
    private readonly eventPermissionService: EventPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  async create(
    communityGroupId: string,
    input: CreateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const community = await em.findOne(Group, { id: communityGroupId });
      if (!community) {
        throw this.communityNotFound();
      }

      const event = new Event();
      event.community = community;
      event.createdBy = actor;
      event.status = EventStatus.DRAFT;
      this.applyFields(event, input);
      event.publicCode = await generateUniquePublicCode(em);
      await em.persist(event).flush();

      await this.eventRolesService.insertRoleAssignment(
        em,
        event,
        actor,
        EventRole.OWNER,
        actor,
      );
      await this.recordHistory(em, event, null, EventStatus.DRAFT, actor, null);

      return this.buildResponse(em, event, actor, [EventRole.OWNER]);
    });
  }

  async update(
    eventId: string,
    input: UpdateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'community',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      this.applyFields(event, input);
      await em.flush();

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async publish(eventId: string, actor: User): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'community',
      ]);
      assertEventStatusAllowed(event, [EventStatus.DRAFT]);
      await this.transitionStatus(
        em,
        event,
        EventStatus.PUBLISHED,
        actor,
        null,
      );

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async cancel(
    eventId: string,
    input: CancelEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'community',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      await this.transitionStatus(
        em,
        event,
        EventStatus.CANCELLED,
        actor,
        input.reason,
      );

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async finish(eventId: string, actor: User): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'community',
      ]);
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]);
      await this.transitionStatus(em, event, EventStatus.FINISHED, actor, null);

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async getById(eventId: string, viewer: User): Promise<EventResponseDto> {
    const em = this.em;
    const event = await this.eventAccessService.loadOrFail(em, eventId, [
      'community',
      'createdBy',
    ]);

    const roles = await this.eventRolesService.getRolesForUser(
      em,
      eventId,
      viewer.id,
    );

    if (roles.length === 0) {
      if (event.status === EventStatus.DRAFT) {
        throw this.eventAccessService.eventNotFound();
      }
      const visible = await this.eventAccessService.isVisibleToViewer(
        em,
        event,
        viewer.id,
        viewer.email,
      );
      if (!visible) {
        throw this.eventAccessService.eventNotFound();
      }
    }

    return this.buildResponse(em, event, viewer, roles);
  }

  async list(
    communityGroupId: string,
    viewer: User,
    query: EventListQueryInput,
  ): Promise<EventListResult> {
    const em = this.em;
    const community = await em.findOne(Group, { id: communityGroupId });
    if (!community) {
      throw this.communityNotFound();
    }

    const rootGroupId =
      await this.eventAccessService.getRootGroupIdForCommunity(em, community);
    const isMember = await this.eventAccessService.isActiveCommunityMember(
      em,
      rootGroupId,
      viewer.id,
    );
    const oversight = await this.resolveCommunityOversight(
      em,
      communityGroupId,
      viewer.id,
    );

    const [roleAssignments, invitations] = await Promise.all([
      em.find(
        EventRoleAssignment,
        { user: viewer.id, event: { community: communityGroupId } },
        { populate: ['event'] },
      ),
      em.find(EventInvitation, {
        event: { community: communityGroupId },
        status: {
          $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
        },
        $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
      }),
    ]);
    const roleEventIds = [
      ...new Set(roleAssignments.map((assignment) => assignment.event.id)),
    ];
    const invitedEventIds = [
      ...new Set(invitations.map((invitation) => invitation.event.id)),
    ];
    const rolesByEvent = new Map<string, EventRole[]>();
    for (const assignment of roleAssignments) {
      const list = rolesByEvent.get(assignment.event.id) ?? [];
      list.push(assignment.role);
      rolesByEvent.set(assignment.event.id, list);
    }

    const where: FilterQuery<Event> = { community: communityGroupId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };

    if (!oversight.viewAll) {
      const visibilityOr: FilterQuery<Event>[] = [
        { visibility: EventVisibility.PUBLIC },
      ];
      if (isMember) {
        visibilityOr.push({ visibility: EventVisibility.COMMUNITY_MEMBERS });
      }
      if (invitedEventIds.length > 0) {
        visibilityOr.push({ id: { $in: invitedEventIds } });
      }

      where.$and = [
        {
          $or: [
            {
              $and: [
                { status: { $ne: EventStatus.DRAFT } },
                { $or: visibilityOr },
              ],
            },
            ...(roleEventIds.length > 0 ? [{ id: { $in: roleEventIds } }] : []),
          ],
        },
      ];
    }

    const [events, total] = await em.findAndCount(Event, where, {
      populate: ['community'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    const items = await Promise.all(
      events.map((event) =>
        this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
          oversight,
        ),
      ),
    );

    return {
      items,
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  /**
   * Every Event visible to `viewer` across every Community they have any
   * relationship to - the "global events" feed (see events-api.md § Global
   * Events). Reuses exactly the same visibility rule as list() (PUBLIC to
   * anyone, COMMUNITY_MEMBERS to active members of that specific
   * Community, INVITE_ONLY to invitees, any Event role always included),
   * just without pre-selecting one `communityGroupId` - so the frontend
   * never has to fetch every Group/Section it belongs to and merge one
   * per-community request itself.
   *
   * Deliberately excludes the Community-level oversight override
   * (GroupPermission.EVENT_VIEW_ALL/EVENT_MODERATE) that list() resolves
   * for a single community: that is an Admin/Owner "browse every Draft
   * under the community I manage" tool, already served by
   * GET /groups/:groupId/events - not part of "the events relevant to me"
   * that this feed answers.
   */
  async listForViewer(
    viewer: User,
    query: EventListQueryInput,
  ): Promise<EventListResult> {
    const em = this.em;

    const memberships = await em.find(GroupMembership, {
      user: viewer.id,
      status: {
        $in: [GroupMembershipStatus.ACTIVE, GroupMembershipStatus.READ_ONLY],
      },
    });
    const myCommunityGroupIds = new Set<string>();
    for (const membership of memberships) {
      const rootGroupId = membership.rootGroup.id;
      myCommunityGroupIds.add(rootGroupId);
      const descendants = await this.groupHierarchyService.getDescendants(
        rootGroupId,
        em,
      );
      for (const descendant of descendants) {
        myCommunityGroupIds.add(descendant.id);
      }
    }

    const [roleAssignments, invitations] = await Promise.all([
      em.find(
        EventRoleAssignment,
        { user: viewer.id },
        { populate: ['event'] },
      ),
      em.find(EventInvitation, {
        status: {
          $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
        },
        $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
      }),
    ]);
    const roleEventIds = [
      ...new Set(roleAssignments.map((assignment) => assignment.event.id)),
    ];
    const invitedEventIds = [
      ...new Set(invitations.map((invitation) => invitation.event.id)),
    ];
    const rolesByEvent = new Map<string, EventRole[]>();
    for (const assignment of roleAssignments) {
      const list = rolesByEvent.get(assignment.event.id) ?? [];
      list.push(assignment.role);
      rolesByEvent.set(assignment.event.id, list);
    }

    const where: FilterQuery<Event> = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };

    const visibilityOr: FilterQuery<Event>[] = [
      { visibility: EventVisibility.PUBLIC },
    ];
    if (myCommunityGroupIds.size > 0) {
      visibilityOr.push({
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        community: { $in: [...myCommunityGroupIds] },
      });
    }
    if (invitedEventIds.length > 0) {
      visibilityOr.push({ id: { $in: invitedEventIds } });
    }

    where.$and = [
      {
        $or: [
          {
            $and: [
              { status: { $ne: EventStatus.DRAFT } },
              { $or: visibilityOr },
            ],
          },
          ...(roleEventIds.length > 0 ? [{ id: { $in: roleEventIds } }] : []),
        ],
      },
    ];

    const [events, total] = await em.findAndCount(Event, where, {
      populate: ['community'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    const items = await Promise.all(
      events.map((event) =>
        this.buildResponse(em, event, viewer, rolesByEvent.get(event.id) ?? []),
      ),
    );

    return {
      items,
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  private applyFields(event: Event, input: CreateEventInput): void {
    event.type = input.type;
    event.customTypeLabel = input.customTypeLabel;
    event.name = input.name;
    event.description = input.description;
    event.coverImageUrl = input.coverImageUrl;
    event.startsAt = new Date(input.startsAt);
    event.endsAt = new Date(input.endsAt);
    event.locationName = input.locationName;
    event.locationAddress = input.locationAddress;
    event.latitude = input.latitude;
    event.longitude = input.longitude;
    event.visibility = input.visibility;
    event.capacity = input.capacity;
    event.waitlistPolicy =
      input.capacity == null ? EventWaitlistPolicy.NONE : input.waitlistPolicy;
  }

  private async transitionStatus(
    em: EntityManager,
    event: Event,
    toStatus: EventStatus,
    actor: User,
    reason: string | null,
  ): Promise<void> {
    await this.recordHistory(em, event, event.status, toStatus, actor, reason);
    event.status = toStatus;
    await em.flush();
  }

  private async recordHistory(
    em: EntityManager,
    event: Event,
    fromStatus: EventStatus | null,
    toStatus: EventStatus,
    actor: User | null,
    reason: string | null,
  ): Promise<void> {
    const history = new EventStatusHistory();
    history.event = event;
    history.fromStatus = fromStatus;
    history.toStatus = toStatus;
    history.actor = actor;
    history.reason = reason;
    await em.persist(history).flush();
  }

  /**
   * Community-level oversight the viewer holds over `communityGroupId`
   * (GroupPermission.EVENT_VIEW_ALL / EVENT_MODERATE) - independent of any
   * Event role. See group-permission.enum.ts for why these exist at all.
   */
  private async resolveCommunityOversight(
    em: EntityManager,
    communityGroupId: string,
    viewerId: string,
  ): Promise<{ viewAll: boolean; moderate: boolean }> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        communityGroupId,
        viewerId,
        em,
      );
    if (!authorization) {
      return { viewAll: false, moderate: false };
    }
    const roles = authorization.roleAssignments.map((a) => a.role);
    const has = (permission: GroupPermission): boolean =>
      this.groupPermissionService.hasAllPermissionsForRoles(
        roles,
        [permission],
        authorization.membership.status,
      );
    return {
      viewAll: has(GroupPermission.EVENT_VIEW_ALL),
      moderate: has(GroupPermission.EVENT_MODERATE),
    };
  }

  private async buildResponse(
    em: EntityManager,
    event: Event,
    viewer: User,
    viewerRoles: EventRole[],
    precomputedOversight?: { viewAll: boolean; moderate: boolean },
  ): Promise<EventResponseDto> {
    const [attendeeCounts, oversight, canRegister] = await Promise.all([
      this.countAttendees(em, event),
      precomputedOversight ??
        this.resolveCommunityOversight(em, event.community.id, viewer.id),
      this.eventAccessService.canViewerRegister(
        em,
        event,
        viewer.id,
        viewer.email,
      ),
    ]);

    const capabilities = this.buildCapabilities(
      viewerRoles,
      oversight.moderate,
      canRegister,
    );

    return toEventResponseDto(event, {
      viewerRoles,
      capabilities,
      seatsTaken: attendeeCounts.seatsTaken,
      seatsAvailable:
        event.capacity == null
          ? null
          : Math.max(event.capacity - attendeeCounts.seatsTaken, 0),
      waitlistCount: attendeeCounts.waitlistCount,
    });
  }

  private async countAttendees(
    em: EntityManager,
    event: Event,
  ): Promise<{ seatsTaken: number; waitlistCount: number }> {
    const [seatsTaken, waitlistCount] = await Promise.all([
      em.count(EventAttendee, {
        event: event.id,
        isWaitlisted: false,
        rsvpStatus: { $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE] },
      }),
      em.count(EventAttendee, { event: event.id, isWaitlisted: true }),
    ]);
    return { seatsTaken, waitlistCount };
  }

  private buildCapabilities(
    roles: EventRole[],
    hasModerateOverride: boolean,
    canRegister: boolean,
  ): EventCapabilitiesDto {
    const has = (permission: EventPermission): boolean =>
      this.eventPermissionService.hasAllPermissionsForRoles(roles, [
        permission,
      ]);

    return {
      canViewManagement: roles.length > 0,
      canEdit: has(EventPermission.EVENT_EDIT),
      canPublish: has(EventPermission.EVENT_PUBLISH),
      canCancel: has(EventPermission.EVENT_CANCEL) || hasModerateOverride,
      canFinish: has(EventPermission.EVENT_FINISH),
      canManageOrganizers: has(EventPermission.EVENT_MANAGE_ORGANIZERS),
      canManageModerators: has(EventPermission.EVENT_MANAGE_MODERATORS),
      canTransferOwnership: has(EventPermission.EVENT_OWNERSHIP_TRANSFER),
      canManageInvitations: has(EventPermission.EVENT_MANAGE_INVITATIONS),
      canManageParticipants: has(EventPermission.EVENT_MANAGE_PARTICIPANTS),
      canCheckIn: has(EventPermission.EVENT_CHECKIN),
      canRegister,
    };
  }

  private communityNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
