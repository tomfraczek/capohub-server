import { EntityManager } from '@mikro-orm/postgresql';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';

// "One Group per user" is about owning one, not only about the formal
// affiliation GroupsService.create now writes alongside it - Groups created
// before that (or whose founder later changed/ended their formal Group) have
// an OWNER but no active FormalGroupAffiliation, so checking the affiliation
// alone let such owners create a second Group. DELETED is excluded as the
// irreversible sink state (see group-status.enum.ts); ARCHIVED still counts,
// since it can be unarchived.
export async function userOwnsGroup(
  em: EntityManager,
  userId: string,
): Promise<boolean> {
  const count = await em.count(RoleAssignment, {
    user: userId,
    role: GroupRole.OWNER,
    revokedAt: null,
    group: { status: { $ne: GroupStatus.DELETED } },
  });
  return count > 0;
}
