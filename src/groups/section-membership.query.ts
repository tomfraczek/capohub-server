import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { SectionMembership } from './entities/section-membership.entity';

// Shared by SectionMembershipsService (member-management flows) and
// RoleAssignmentsService.transferOwnership. Plain function, not an
// injectable service, so it has no DI/module-boundary overhead for what is
// effectively a single query used from a handful of places within this
// module.
//
// `sectionId` is always a Section id - membership only ever exists for a
// Section (Group has none at all).
//
// `lockMode` is opt-in (PESSIMISTIC_WRITE) for callers that decide whether
// this exact membership row may be ended or handed OWNER of the Section -
// see SectionMembershipsService.leave/transferOwnership. Locking the row
// serializes against any concurrent decision about the same membership.
export function loadActiveSectionMembership(
  em: EntityManager,
  sectionId: string,
  userId: string,
  options: { lockMode?: LockMode } = {},
): Promise<SectionMembership | null> {
  return em.findOne(
    SectionMembership,
    {
      section: sectionId,
      user: userId,
      status: SectionMembershipStatus.ACTIVE,
    },
    { populate: ['section'], ...options },
  );
}
