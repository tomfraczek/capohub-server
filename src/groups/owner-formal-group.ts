import { ConflictException } from '@nestjs/common';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
import { EntityManager } from '@mikro-orm/postgresql';
import { findOwnedLiveGroupIds } from './user-owns-group';

// The domain invariant: the OWNER of a live Group is always a formal member
// of that Group (an active FormalGroupAffiliation pointing at it). It is
// established by GroupsService.create (and RoleAssignmentsService.
// transferOwnership for a new owner) and guarded here, in every path that
// could otherwise end or move an owner's affiliation. Not expressible as a
// DB constraint - it spans role_assignments and formal_group_affiliations
// (see the migration's own comment) - so the services enforce it.
export async function assertNotLeavingOwnedGroup(
  em: EntityManager,
  userId: string,
  currentFormalGroupId: string | null,
  nextFormalGroupId: string | null,
): Promise<void> {
  if (currentFormalGroupId === nextFormalGroupId) {
    return;
  }
  const ownedIds = await findOwnedLiveGroupIds(em, userId);
  // Moving *onto* an owned Group is always fine - that's exactly what the
  // invariant wants (e.g. a legacy owner fixing their own affiliation).
  if (nextFormalGroupId !== null && ownedIds.includes(nextFormalGroupId)) {
    return;
  }
  if (ownedIds.length > 0) {
    throw new ConflictException({
      code: 'OWNER_MUST_STAY_IN_FORMAL_GROUP',
      message:
        'The owner of a group must stay its formal member - transfer ownership first',
      groupIds: ownedIds,
    });
  }
}

// Why `userId` can't become the OWNER of `groupId` - the same invariant
// seen from the transfer side: a new owner becomes the Group's formal
// member, and a user has at most one formal Group (so at most one owned
// live Group). null = eligible. Shared by RoleAssignmentsService.
// transferOwnership (which enforces it) and its candidates endpoint (which
// only explains it), so the two can never disagree.
export type OwnershipTransferBlocker = 'OWNS_ANOTHER_GROUP' | 'OTHER_FORMAL_GROUP';

export async function getOwnershipTransferBlocker(
  em: EntityManager,
  userId: string,
  groupId: string,
): Promise<OwnershipTransferBlocker | null> {
  const owned = await findOwnedLiveGroupIds(em, userId);
  if (owned.some((id) => id !== groupId)) {
    return 'OWNS_ANOTHER_GROUP';
  }
  const affiliation = await em.findOne(FormalGroupAffiliation, {
    user: userId,
    endedOn: null,
  });
  if (affiliation && affiliation.group.id !== groupId) {
    return 'OTHER_FORMAL_GROUP';
  }
  return null;
}
