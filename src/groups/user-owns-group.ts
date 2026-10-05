import { EntityManager } from '@mikro-orm/postgresql';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';

// A Group still "exists" for its owner while ACTIVE or READ_ONLY. ARCHIVED
// is what the app presents as "Usuń grupę" (no restore is offered) and
// DELETED is the irreversible sink state, so owning only those no longer
// counts - the user may found a new Group and is no longer bound to it by
// the OWNER -> formal membership invariant (see owner-formal-group.ts).
export const LIVE_GROUP_STATUSES = [GroupStatus.ACTIVE, GroupStatus.READ_ONLY];

// "One Group per user" is about owning one, not only about the formal
// affiliation GroupsService.create writes alongside it - a legacy owner may
// still lack it (see Migration20261002160000_BackfillOwnerFormalGroup), so
// checking the affiliation alone would let such an owner create a second
// Group.
export async function userOwnsGroup(
  em: EntityManager,
  userId: string,
): Promise<boolean> {
  return (await findOwnedLiveGroupIds(em, userId)).length > 0;
}

/** Ids of every live (ACTIVE/READ_ONLY) Group `userId` currently owns. */
export async function findOwnedLiveGroupIds(
  em: EntityManager,
  userId: string,
): Promise<string[]> {
  const assignments = await em.find(
    RoleAssignment,
    {
      user: userId,
      role: GroupRole.OWNER,
      revokedAt: null,
      group: { status: { $in: LIVE_GROUP_STATUSES } },
    },
    { fields: ['group'] },
  );
  return assignments
    .map((assignment) => assignment.group?.id)
    .filter((id): id is string => Boolean(id));
}
