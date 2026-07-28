import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { EventAccessService } from './event-access.service';
import { GrantEventRoleInput } from './dto/grant-event-role.schema';
import { EventRoleAssignmentResponseDto } from './dto/event-role-assignment-response.dto';
import { TransferEventOwnershipInput } from './dto/transfer-event-ownership.schema';
import { Event } from './entities/event.entity';
import {
  EVENT_ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  EventRoleAssignment,
} from './entities/event-role-assignment.entity';
import { EventRole } from './enums/event-role.enum';
import { EventStatus } from './enums/event-status.enum';
import { toEventRoleAssignmentResponseDto } from './mappers/event-role-assignment.mapper';

/**
 * Owns everything about the Owner/Organizer/Moderator tier for a specific
 * Event - deliberately separate from Community roles (see
 * event-role-assignment.entity.ts). Depends only on EventAccessService, not
 * EventsService, so EventsService can depend on this one directionally
 * (granting OWNER at Event creation) without a cycle.
 */
@Injectable()
export class EventRolesService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
  ) {}

  /**
   * Resolves the caller's Event roles for `eventId` - always succeeds with
   * a (possibly empty) role list as long as the Event itself exists; throws
   * EVENT_NOT_FOUND otherwise. Never a 403 by itself - EventPermissionsGuard
   * decides 404 vs 403 based on the returned roles and, for the narrow
   * community-moderation override, the caller's Community-level
   * permissions (see events/guards/event-permissions.guard.ts).
   */
  async resolveAuthorization(
    eventId: string,
    userId: string,
    em: EntityManager = this.em,
  ): Promise<{ event: Event; roles: EventRole[] }> {
    const event = await this.eventAccessService.loadOrFail(em, eventId);
    const roles = await this.getRolesForUser(em, eventId, userId);
    return { event, roles };
  }

  async getRolesForUser(
    em: EntityManager,
    eventId: string,
    userId: string,
  ): Promise<EventRole[]> {
    const assignments = await em.find(EventRoleAssignment, {
      event: eventId,
      user: userId,
    });
    return assignments.map((assignment) => assignment.role);
  }

  /**
   * Unconditionally creates one new Role Assignment row - the primitive
   * behind granting the initial OWNER at Event creation (see
   * EventsService.create) and every subsequent grant (see grantRole).
   * Must run inside the caller's transaction.
   */
  async insertRoleAssignment(
    em: EntityManager,
    event: Event,
    user: User,
    role: EventRole,
    grantedBy: User | null,
  ): Promise<EventRoleAssignment> {
    const assignment = new EventRoleAssignment();
    assignment.event = event;
    assignment.user = user;
    assignment.role = role;
    assignment.grantedAt = new Date();
    assignment.grantedBy = grantedBy;
    await em.persist(assignment).flush();
    return assignment;
  }

  async listRoles(eventId: string): Promise<EventRoleAssignmentResponseDto[]> {
    const assignments = await this.em.find(
      EventRoleAssignment,
      { event: eventId },
      { populate: ['user', 'grantedBy'], orderBy: { grantedAt: 'asc' } },
    );
    return assignments.map(toEventRoleAssignmentResponseDto);
  }

  /**
   * Grants ORGANIZER or MODERATOR (OWNER is never grantable here - see
   * transferOwnership). EventPermissionsGuard only guarantees the caller
   * holds at least EVENT_MANAGE_MODERATORS (i.e. is ORGANIZER or OWNER);
   * granting ORGANIZER specifically is further restricted to OWNER only
   * here, mirroring how RoleAssignmentsService/GroupPermissionsGuard split
   * coarse (guard) vs target-specific (service) checks.
   */
  async grantRole(
    eventId: string,
    input: GrantEventRoleInput,
    actor: User,
  ): Promise<EventRoleAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId);
      const actorRoles = await this.getRolesForUser(em, eventId, actor.id);

      if (
        input.role === EventRole.ORGANIZER &&
        !actorRoles.includes(EventRole.OWNER)
      ) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_EVENT_PERMISSIONS',
          message: 'Only the Owner may grant the Organizer role',
        });
      }

      const rootGroupId = await this.eventAccessService.getRootGroupId(
        em,
        event,
      );
      const isMember = await this.eventAccessService.isActiveCommunityMember(
        em,
        rootGroupId,
        input.userId,
      );
      if (!isMember) {
        throw new ConflictException({
          code: 'EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER',
          message:
            "The target user must be an active member of this event's community",
        });
      }

      const existing = await em.findOne(EventRoleAssignment, {
        event: eventId,
        user: input.userId,
        role: input.role,
      });
      if (existing) {
        throw new ConflictException({
          code: 'EVENT_ROLE_ALREADY_EXISTS',
          message: 'This user already holds this role for this event',
        });
      }

      const targetUser = em.getReference(User, input.userId);
      let assignment: EventRoleAssignment;
      try {
        assignment = await this.insertRoleAssignment(
          em,
          event,
          targetUser,
          input.role,
          actor,
        );
      } catch (error) {
        if (isUniqueViolationOn(error, EVENT_ROLE_ASSIGNMENTS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'EVENT_ROLE_ALREADY_EXISTS',
            message: 'This user already holds this role for this event',
          });
        }
        throw error;
      }

      return toEventRoleAssignmentResponseDto(assignment);
    });
  }

  /**
   * Revokes a single Role Assignment. OWNER can never be revoked here -
   * ownership only moves via transferOwnership, since an Event must never
   * be left without one. Revoking ORGANIZER is OWNER-only (mirrors the
   * grant-side restriction); revoking MODERATOR is available to both
   * OWNER and ORGANIZER (whichever already passed EventPermissionsGuard's
   * EVENT_MANAGE_MODERATORS check).
   */
  async revokeRole(
    eventId: string,
    roleAssignmentId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const assignment = await em.findOne(EventRoleAssignment, {
        id: roleAssignmentId,
        event: eventId,
      });
      if (!assignment) {
        throw new NotFoundException({
          code: 'EVENT_ROLE_ASSIGNMENT_NOT_FOUND',
          message: 'Event role assignment not found',
        });
      }

      if (assignment.role === EventRole.OWNER) {
        throw new ConflictException({
          code: 'CANNOT_REMOVE_EVENT_OWNER',
          message:
            'The owner role cannot be revoked directly - transfer ownership instead',
        });
      }

      if (assignment.role === EventRole.ORGANIZER) {
        const actorRoles = await this.getRolesForUser(em, eventId, actor.id);
        if (!actorRoles.includes(EventRole.OWNER)) {
          throw new ForbiddenException({
            code: 'INSUFFICIENT_EVENT_PERMISSIONS',
            message: 'Only the Owner may revoke the Organizer role',
          });
        }
      }

      await em.remove(assignment).flush();
    });
  }

  /**
   * Atomically moves OWNER from the caller to `toUserId` - the only way
   * OWNER ever changes hands (spec: "Owner może przekazać własność").
   * EventPermissionsGuard already guarantees the caller holds
   * EVENT_OWNERSHIP_TRANSFER, which only the current OWNER's role grants
   * (OWNER is unique per Event - see
   * EVENT_ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX), so the caller's own OWNER
   * row is looked up directly rather than re-deriving "is this the owner"
   * from scratch.
   */
  async transferOwnership(
    eventId: string,
    input: TransferEventOwnershipInput,
    actor: User,
  ): Promise<EventRoleAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId);

      const currentOwnerAssignment = await em.findOne(EventRoleAssignment, {
        event: eventId,
        role: EventRole.OWNER,
      });
      if (
        !currentOwnerAssignment ||
        currentOwnerAssignment.user.id !== actor.id
      ) {
        throw new ConflictException({
          code: 'NOT_CURRENT_EVENT_OWNER',
          message: 'Only the current owner may transfer ownership',
        });
      }

      if (input.toUserId === actor.id) {
        throw new ConflictException({
          code: 'CANNOT_TRANSFER_TO_SELF',
          message: 'Cannot transfer ownership to yourself',
        });
      }

      const rootGroupId = await this.eventAccessService.getRootGroupId(
        em,
        event,
      );
      const isMember = await this.eventAccessService.isActiveCommunityMember(
        em,
        rootGroupId,
        input.toUserId,
      );
      if (!isMember) {
        throw new ConflictException({
          code: 'EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER',
          message:
            "The target user must be an active member of this event's community",
        });
      }

      await em.remove(currentOwnerAssignment).flush();

      const newOwner = em.getReference(User, input.toUserId);
      const assignment = await this.insertRoleAssignment(
        em,
        event,
        newOwner,
        EventRole.OWNER,
        actor,
      );

      return toEventRoleAssignmentResponseDto(assignment);
    });
  }

  /**
   * Every Event this user currently owns whose status is DRAFT or
   * PUBLISHED (CANCELLED/FINISHED are terminal/historical - transferring
   * ownership of one has no operational purpose, mirroring how
   * RoleAssignmentsService.findOwnedActiveGroups excludes ARCHIVED Groups).
   * Used by UserService.deleteLocalAccountData to block account deletion
   * while this user solely owns a live Event - see user.service.ts.
   */
  async findOwnedActiveEvents(
    em: EntityManager,
    userId: string,
  ): Promise<Event[]> {
    const assignments = await em.find(
      EventRoleAssignment,
      { user: userId, role: EventRole.OWNER },
      { populate: ['event'] },
    );
    return assignments
      .map((assignment) => assignment.event)
      .filter(
        (event) =>
          event.status === EventStatus.DRAFT ||
          event.status === EventStatus.PUBLISHED,
      );
  }
}
