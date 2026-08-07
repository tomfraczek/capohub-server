import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
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
import { assignEventCommunity, eventCommunity } from './event-community.util';
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
      const community = await this.groupHierarchyService.findCommunityById(
        communityGroupId,
        em,
      );
      if (!community) {
        throw this.communityNotFound();
      }

      const event = new Event();
      assignEventCommunity(event, community);
      event.createdBy = actor;
      event.status = EventStatus.DRAFT;
      // type/customTypeLabel are set here, on create, only - see
      // applyCommonFields, which update() also calls but which
      // structurally cannot touch either field (UpdateEventInput has no
      // such keys - see update-event.schema.ts).
      event.type = input.type;
      event.customTypeLabel = input.customTypeLabel;
      this.applyCommonFields(event, input);
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
        'communityGroup',
        'communitySection',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      // UpdateEventInput structurally has no `type`/`customTypeLabel` keys
      // (see update-event.schema.ts) - there is no line here, or anywhere
      // else in this method, that could reassign event.type even by
      // accident.
      this.applyCommonFields(event, input);
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
        'communityGroup',
        'communitySection',
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
        'communityGroup',
        'communitySection',
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
        'communityGroup',
        'communitySection',
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
      'communityGroup',
      'communitySection',
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
    const community = await this.groupHierarchyService.findCommunityById(
      communityGroupId,
      em,
    );
    if (!community) {
      throw this.communityNotFound();
    }

    const isMember = await this.eventAccessService.isActiveCommunityMember(
      em,
      community.id,
      viewer.id,
    );
    const oversight = await this.resolveCommunityOversight(
      em,
      communityGroupId,
      viewer.id,
    );

    const eventInCommunity = {
      $or: [
        { communityGroup: communityGroupId },
        { communitySection: communityGroupId },
      ],
    };
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const roleAssignments = await em.find(
      EventRoleAssignment,
      { user: viewer.id, event: eventInCommunity },
      { populate: ['event'] },
    );
    const invitations = await em.find(EventInvitation, {
      event: eventInCommunity,
      status: {
        $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
      },
      $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
    });
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

    const where: FilterQuery<Event> = {
      $or: [
        { communityGroup: communityGroupId },
        { communitySection: communityGroupId },
      ],
    };
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
      populate: ['communityGroup', 'communitySection'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    // Sequential, not Promise.all(events.map(...)) - each buildResponse
    // issues several queries against the same EntityManager/connection;
    // running them concurrently races at the driver level.
    const items = [];
    for (const event of events) {
      items.push(
        await this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
          oversight,
        ),
      );
    }

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
    const { visibilityAnd, rolesByEvent } = await this.resolveViewerVisibility(
      em,
      viewer,
    );

    const where: FilterQuery<Event> = { $and: visibilityAnd };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };

    const [events, total] = await em.findAndCount(Event, where, {
      populate: ['communityGroup', 'communitySection'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    // Sequential, not Promise.all(events.map(...)) - see list()'s identical
    // comment above.
    const items = [];
    for (const event of events) {
      items.push(
        await this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
        ),
      );
    }

    return {
      items,
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  /**
   * The single soonest upcoming Event (any type) visible to `viewer` from
   * `from` onward - backs GET /home (see HomeService).
   *
   * `nearestTraining` is always `null`: EventType.OPEN_TRAINING was
   * removed (see the EventType cleanup report) - a training is not an
   * Event and will be resolved from a dedicated future training module
   * instead (same "no dedicated training flag on Event" call already made
   * in career-timeline-aggregation.service.ts and formal-rank.service.ts).
   * The field stays in the return shape/HomeResponseDto so the /home
   * response contract is unchanged until that module exists to back it.
   */
  async findNearestEventAndTraining(
    viewer: User,
    from: string,
  ): Promise<{
    nearestEvent: EventResponseDto | null;
    nearestTraining: EventResponseDto | null;
  }> {
    const em = this.em;
    const { visibilityAnd, rolesByEvent } = await this.resolveViewerVisibility(
      em,
      viewer,
    );
    const endsAtFrom = { $gte: new Date(from) };

    const [anyEvents] = await em.findAndCount(
      Event,
      { $and: visibilityAnd, endsAt: endsAtFrom },
      {
        populate: ['communityGroup', 'communitySection'],
        orderBy: { startsAt: 'asc' },
        limit: 1,
      },
    );

    for (const event of anyEvents) {
      await reconcileEventFinished(em, event);
    }

    const nearestEvent = anyEvents[0]
      ? await this.buildResponse(
          em,
          anyEvents[0],
          viewer,
          rolesByEvent.get(anyEvents[0].id) ?? [],
        )
      : null;

    return { nearestEvent, nearestTraining: null };
  }

  /**
   * Resolves everything listForViewer/findNearestEventAndTraining need to
   * decide which Events `viewer` may see, independent of any `type`/`from`/
   * `to` query filter: their shared Groups (own Root Group plus every
   * descendant - ADR-002, unlimited hierarchy depth), Event Role
   * Assignments (always visible regardless of Community membership), and
   * pending/accepted Event Invitations. Returns a ready-to-spread `$and`
   * fragment (same rule both callers used to build inline: PUBLIC to
   * anyone, COMMUNITY_MEMBERS to members of one of `viewer`'s Communities,
   * invited-only Events to their invitee, any Event Role always included -
   * DRAFT excluded unless a Role applies) plus the viewer's own roles per
   * Event for buildResponse's `viewerRoles`/`capabilities`.
   */
  private async resolveViewerVisibility(
    em: EntityManager,
    viewer: User,
  ): Promise<{
    visibilityAnd: FilterQuery<Event>[];
    rolesByEvent: Map<string, EventRole[]>;
  }> {
    // "My communities" - every Group where I hold an active RoleAssignment
    // (Group's only participants are role holders) and every Section where
    // I have an active membership. No inheritance: unlike the old
    // root-Membership model, this never expands to a whole organization
    // tree just because I belong to one Section or Group somewhere in it -
    // see RoleAssignmentsService.getCommunityIdsWithAnyRole.
    const participation =
      await this.roleAssignmentsService.getCommunityIdsWithAnyRole(viewer.id);
    const myCommunityGroupIds = new Set<string>();
    const myCommunitySectionIds = new Set<string>();
    if (participation.length > 0) {
      // Sequential, not Promise.all - concurrent queries on the same
      // EntityManager/connection race each other at the driver level.
      const groups = await em.find(
        Group,
        { id: { $in: participation } },
        { fields: ['id'] },
      );
      const sections = await em.find(
        Section,
        { id: { $in: participation } },
        { fields: ['id'] },
      );
      for (const group of groups) {
        myCommunityGroupIds.add(group.id);
      }
      for (const section of sections) {
        myCommunitySectionIds.add(section.id);
      }
    }

    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const roleAssignments = await em.find(
      EventRoleAssignment,
      { user: viewer.id },
      { populate: ['event'] },
    );
    const invitations = await em.find(EventInvitation, {
      status: {
        $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
      },
      $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
    });
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

    const visibilityOr: FilterQuery<Event>[] = [
      { visibility: EventVisibility.PUBLIC },
    ];
    if (myCommunityGroupIds.size > 0) {
      visibilityOr.push({
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        communityGroup: { $in: [...myCommunityGroupIds] },
      });
    }
    if (myCommunitySectionIds.size > 0) {
      visibilityOr.push({
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        communitySection: { $in: [...myCommunitySectionIds] },
      });
    }
    if (invitedEventIds.length > 0) {
      visibilityOr.push({ id: { $in: invitedEventIds } });
    }

    const visibilityAnd: FilterQuery<Event>[] = [
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

    return { visibilityAnd, rolesByEvent };
  }

  // Every field but `type`/`customTypeLabel` - shared by create() and
  // update(). Takes UpdateEventInput (the narrower shape, lacking
  // type/customTypeLabel) so update() can never pass those fields through
  // even by accident; create() still satisfies this, since CreateEventInput
  // is a structural superset of UpdateEventInput.
  private applyCommonFields(event: Event, input: UpdateEventInput): void {
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
    const targetKind =
      authorization.community instanceof Group ? 'GROUP' : 'SECTION';
    const has = (permission: GroupPermission): boolean =>
      this.groupPermissionService.hasAllPermissionsForRoles(
        targetKind,
        roles,
        [permission],
        authorization.membership?.status ?? null,
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
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const attendeeCounts = await this.countAttendees(em, event);
    const oversight =
      precomputedOversight ??
      (await this.resolveCommunityOversight(
        em,
        eventCommunity(event).id,
        viewer.id,
      ));
    const canRegister = await this.eventAccessService.canViewerRegister(
      em,
      event,
      viewer.id,
      viewer.email,
    );

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
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const seatsTaken = await em.count(EventAttendee, {
      event: event.id,
      isWaitlisted: false,
      rsvpStatus: { $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE] },
    });
    const waitlistCount = await em.count(EventAttendee, {
      event: event.id,
      isWaitlisted: true,
    });
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
