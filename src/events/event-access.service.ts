import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  Community,
  GroupHierarchyService,
} from '../groups/group-hierarchy.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { EventInvitation } from './entities/event-invitation.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventType } from './enums/event-type.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { Event } from './entities/event.entity';
import { eventCommunity } from './event-community.util';
import { reconcileEventFinished } from './event-write-policy';

/**
 * Shared, dependency-free helpers reused by every Event sub-service
 * (EventsService, EventRolesService, EventRsvpService,
 * EventInvitationsService, EventGuardiansService, EventAttendanceService) -
 * kept in its own service, rather than on EventsService itself, so that
 * EventsService (which needs EventRolesService to grant OWNER at creation)
 * and EventRolesService (which needs to load/reconcile an Event before
 * resolving a caller's roles) do not end up depending on each other.
 */
@Injectable()
export class EventAccessService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  /**
   * Loads an Event by id, lazily reconciling PUBLISHED -> FINISHED if
   * `endsAt` has passed (see reconcileEventFinished) before returning it -
   * every read of a single Event, for any purpose, goes through this so
   * the status is never stale by the time a permission/status check runs
   * against it.
   */
  async loadOrFail(
    em: EntityManager,
    eventId: string,
    populate: (
      'communityGroup' | 'communitySection' | 'organizerUser' | 'createdBy'
    )[] = ['communityGroup', 'communitySection', 'organizerUser'],
  ): Promise<Event> {
    const event = await em.findOne(Event, { id: eventId }, { populate });
    if (!event) {
      throw this.eventNotFound();
    }
    await reconcileEventFinished(em, event);
    return event;
  }

  /**
   * Loads an Event by its (type, numericCode) public identity instead of
   * its id - backs GET events/by-code/:type/:code (see
   * event-lookup.controller.ts). Same reconciliation as loadOrFail; the
   * caller is still responsible for the usual visibility check afterwards
   * (see EventsService.getVisibleEventResponse) - finding an Event by its
   * numeric code never bypasses access control.
   */
  async loadByTypeAndCodeOrFail(
    em: EntityManager,
    type: EventType,
    numericCode: string,
    populate: (
      'communityGroup' | 'communitySection' | 'organizerUser' | 'createdBy'
    )[] = ['communityGroup', 'communitySection', 'organizerUser'],
  ): Promise<Event> {
    const event = await em.findOne(Event, { type, numericCode }, { populate });
    if (!event) {
      throw this.eventNotFound();
    }
    await reconcileEventFinished(em, event);
    return event;
  }

  /**
   * The Root Group (Group) that owns `event`'s Community - itself,
   * when the Community already *is* the Root Group. Community membership
   * (GroupMembership) is always Root-Group-scoped (ADR-004), so this is
   * the id every membership-based check below resolves against, even when
   * the Event belongs to a Child Group or a Section.
   *
   * Not callable for a User-organized Event, which has no Community at all
   * (see event-community.util.ts) - this method is not called anywhere in
   * the codebase today (Root Group resolution for Events currently only
   * happens through getRootGroupIdForCommunity, called with an
   * already-known Community), but throws explicitly rather than silently
   * misbehaving if that ever changes.
   */
  async getRootGroupId(em: EntityManager, event: Event): Promise<string> {
    const community = eventCommunity(event);
    if (!community) {
      throw new Error(
        'getRootGroupId is not supported for a User-organized Event',
      );
    }
    return this.getRootGroupIdForCommunity(em, community);
  }

  /**
   * Same resolution as getRootGroupId, but for a Community (Group or
   * Section) that has not necessarily been loaded as part of an Event yet -
   * used by EventsService.list, which resolves the community once per
   * request rather than once per Event row.
   */
  async getRootGroupIdForCommunity(
    em: EntityManager,
    community: Community,
  ): Promise<string> {
    const root = await this.groupHierarchyService.resolveRootGroup(
      community,
      em,
    );
    return root.id;
  }

  /**
   * Whether `userId` is currently a member of `communityId` - the *exact*
   * Group or Section the Event belongs to, never a resolved root (no
   * inheritance: a Section's own membership is what gates COMMUNITY_MEMBERS
   * visibility for an Event under that Section, not the parent
   * organization's). Delegates to RoleAssignmentsService.isCommunityMember.
   */
  async isActiveCommunityMember(
    em: EntityManager,
    communityId: string,
    userId: string,
  ): Promise<boolean> {
    return this.roleAssignmentsService.isCommunityMember(
      communityId,
      userId,
      em,
    );
  }

  /**
   * The invited-user's or invited-email's non-terminal (PENDING or already
   * ACCEPTED) EventInvitation for `event`, if any - the registration gate
   * for INVITE_ONLY Events (see event-invitation.entity.ts). Matches by
   * `invitedUser` first, falling back to `invitedEmail` (case-insensitive
   * - User.email is already stored normalized) for an invitation sent
   * before the invitee had linked/created an account.
   */
  async findActiveInvitation(
    em: EntityManager,
    eventId: string,
    userId: string,
    userEmail: string,
  ): Promise<EventInvitation | null> {
    return em.findOne(EventInvitation, {
      event: eventId,
      status: {
        $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
      },
      $or: [{ invitedUser: userId }, { invitedEmail: userEmail }],
    });
  }

  /**
   * Whether `viewerId` may see `event` at all, given its own visibility
   * rule - deliberately independent of whether the viewer holds an Event
   * role (callers check that separately first, since a role always grants
   * view access regardless of visibility - see EventsService.getById).
   * PUBLIC is visible to any authenticated user; COMMUNITY_MEMBERS
   * requires an active Community membership; INVITE_ONLY requires a
   * non-terminal invitation.
   */
  async isVisibleToViewer(
    em: EntityManager,
    event: Event,
    viewerId: string,
    viewerEmail: string,
  ): Promise<boolean> {
    switch (event.visibility) {
      case EventVisibility.PUBLIC:
        return true;
      case EventVisibility.COMMUNITY_MEMBERS: {
        const community = eventCommunity(event);
        // Structurally unreachable for a User-organized Event - create/
        // update both reject COMMUNITY_MEMBERS visibility whenever
        // organizerUser is set (see EventsService). Guarded defensively
        // anyway: a User-organized Event has no Community to check
        // membership against, so it can never be visible under this rule.
        if (!community) {
          return false;
        }
        return this.isActiveCommunityMember(em, community.id, viewerId);
      }
      case EventVisibility.INVITE_ONLY: {
        const invitation = await this.findActiveInvitation(
          em,
          event.id,
          viewerId,
          viewerEmail,
        );
        return invitation !== null;
      }
    }
  }

  /**
   * Whether `viewerId` may self-register right now - stricter than
   * isVisibleToViewer: additionally requires the Event to be PUBLISHED
   * (spec: registration only ever targets a live, published Event).
   */
  async canViewerRegister(
    em: EntityManager,
    event: Event,
    viewerId: string,
    viewerEmail: string,
  ): Promise<boolean> {
    if (event.status !== EventStatus.PUBLISHED) {
      return false;
    }
    return this.isVisibleToViewer(em, event, viewerId, viewerEmail);
  }

  eventNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'EVENT_NOT_FOUND',
      message: 'Event not found',
    });
  }
}
