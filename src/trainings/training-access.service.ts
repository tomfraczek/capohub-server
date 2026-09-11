import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { TrainingVisibility } from './enums/training-visibility.enum';
import { Training } from './entities/training.entity';

/**
 * Shared, dependency-free authorization helpers reused by every Training
 * sub-service (TrainingsService, TrainingSeriesService, TrainingRsvpService,
 * TrainingAttendanceService, TrainingStatsService) - mirrors
 * events/event-access.service.ts's role in that module.
 *
 * Two distinct authorization questions are answered here:
 *  - Section-wide capability (canManageTrainings/canManageStats/...) -
 *    resolved through the exact same GroupPermission/GroupRole machinery
 *    every other Section-scoped module uses (see
 *    groups/permissions/group-role-permissions.map.ts), reused rather than
 *    duplicated.
 *  - The resource-level trainer override (module spec §3): the User
 *    assigned as one specific Training's `trainer` gets an equivalent,
 *    narrower capability for that Training alone - attendance and
 *    plan/notes only - independent of whether they hold any Section role
 *    or SectionMembership at all. This is deliberately resolved here as a
 *    plain `training.trainer.id === actor.id` check, not through a second
 *    Training-scoped Role Assignment system (unlike Events' Owner/
 *    Organizer/Moderator tier) - the module spec calls for exactly one
 *    override, not a general-purpose per-resource role system.
 */
@Injectable()
export class TrainingAccessService {
  constructor(
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
  ) {}

  /**
   * Whether `viewerId` may see `training` at all - PUBLIC is visible to any
   * authenticated user; MEMBERS_ONLY requires an active (ACTIVE/READ_ONLY)
   * SectionMembership in the exact owning Section (no inheritance - same
   * rule as EventAccessService.isVisibleToViewer's COMMUNITY_MEMBERS
   * branch). Independent of any Section permission - a MEMBER with no
   * TRAINING_MANAGE still sees every Training their Section's visibility
   * rule allows.
   */
  async isVisibleToViewer(
    em: EntityManager,
    training: Pick<Training, 'visibility'> & { section: { id: string } },
    viewerId: string,
  ): Promise<boolean> {
    if (training.visibility === TrainingVisibility.PUBLIC) {
      return true;
    }
    return this.roleAssignmentsService.isCommunityMember(
      training.section.id,
      viewerId,
      em,
    );
  }

  /**
   * Whether `userId` may RSVP to `training`, given whether they are an
   * active member of the owning Section - a non-member may RSVP exactly
   * when the Training is PUBLIC (module: "skoro publiczna to mogą się
   * zapisywać osoby spoza sekcji" - there is no separate opt-in beyond
   * visibility itself). MEMBERS_ONLY always requires membership.
   */
  async canRsvp(
    em: EntityManager,
    training: Pick<Training, 'visibility'> & {
      section: { id: string };
    },
    userId: string,
  ): Promise<boolean> {
    const isMember = await this.roleAssignmentsService.isCommunityMember(
      training.section.id,
      userId,
      em,
    );
    if (isMember) {
      return true;
    }
    return training.visibility === TrainingVisibility.PUBLIC;
  }

  /**
   * The resource-level trainer override plus the Section-wide permission -
   * either grants access to a Training's trainingPlan/trainerNotes (module
   * spec §13).
   */
  async canManagePrivateFields(
    em: EntityManager,
    training: { trainer: { id: string } | null; section: { id: string } },
    actorId: string,
  ): Promise<boolean> {
    if (training.trainer?.id === actorId) {
      return true;
    }
    return this.hasSectionPermission(
      em,
      training.section.id,
      actorId,
      GroupPermission.TRAINING_PRIVATE_NOTES_MANAGE,
    );
  }

  /**
   * The resource-level trainer override plus the Section-wide permission -
   * either grants the right to record actual attendance for a Training
   * (module spec §7).
   */
  async canManageAttendance(
    em: EntityManager,
    training: { trainer: { id: string } | null; section: { id: string } },
    actorId: string,
  ): Promise<boolean> {
    if (training.trainer?.id === actorId) {
      return true;
    }
    return this.hasSectionPermission(
      em,
      training.section.id,
      actorId,
      GroupPermission.TRAINING_ATTENDANCE_MANAGE,
    );
  }

  /**
   * Plain Section-wide permission check, independent of any resource-level
   * override - used for TRAINING_MANAGE (create/edit/cancel) and
   * TRAINING_STATS_VIEW, neither of which has a trainer override (module
   * spec §4/§14).
   */
  async hasSectionPermission(
    em: EntityManager,
    sectionId: string,
    userId: string,
    permission: GroupPermission,
  ): Promise<boolean> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        sectionId,
        userId,
        em,
      );
    if (!authorization) {
      return false;
    }
    const roles = authorization.roleAssignments.map((a) => a.role);
    return this.groupPermissionService.hasAllPermissionsForRoles(
      'SECTION',
      roles,
      [permission],
      authorization.membership?.status ?? null,
    );
  }

  trainingNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'TRAINING_NOT_FOUND',
      message: 'Training not found',
    });
  }

  trainingSeriesNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'TRAINING_SERIES_NOT_FOUND',
      message: 'Training series not found',
    });
  }
}
