import { EntityManager } from '@mikro-orm/postgresql';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { GroupRole } from '../groups/enums/group-role.enum';

// Whether `userId`'s own choice of a rank in `groupId`'s graduation system
// takes effect at once instead of becoming a FormalRankRequest: the
// Group's OWNER/ADMIN hold FORMAL_RANK_REQUEST_REVIEW on it (see
// group-role-permissions.map.ts), so their own choice needs no one else's
// confirmation. The single rule behind both FormalRankService.setCurrent
// (which acts on it) and GET /users/me/formal-rank-options (which tells the
// app up front, so the screen offers "Zapisz stopień" rather than "Wyślij
// do potwierdzenia").
export async function confirmsOwnRankImmediately(
  em: EntityManager,
  userId: string,
  groupId: string,
): Promise<boolean> {
  return (
    (await em.count(RoleAssignment, {
      user: userId,
      group: groupId,
      role: { $in: [GroupRole.OWNER, GroupRole.ADMIN] },
      revokedAt: null,
    })) > 0
  );
}
