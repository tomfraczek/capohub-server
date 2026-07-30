import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { RecipientGroup } from './recipient-group.entity';

// One row per (RecipientGroup, User) - manually added/removed only, never
// derived from a role, a dynamic filter, or a position (see
// RecipientGroupsService - no "sync members from role X" exists). Adding a
// member requires the target user to already be a member of the Recipient
// Group's own Group/Section (see RoleAssignmentsService.isCommunityMember)
// - enforced at write time, not by a DB constraint (membership is a
// separate, mutable fact this table cannot reference declaratively).
@Entity({ tableName: 'recipient_group_members' })
@Unique({ properties: ['recipientGroup', 'user'] })
export class RecipientGroupMember extends BaseEntity {
  // Cascade: a Recipient Group's member rows are pure children of it, never
  // independently meaningful - safe to cascade even though a
  // RecipientGroup itself is never physically deleted in practice (see
  // recipient-group.entity.ts).
  @Index()
  @ManyToOne(() => RecipientGroup, { deleteRule: 'cascade' })
  recipientGroup!: RecipientGroup;

  // Cascade: if the User's account is hard-deleted (see
  // UserService.deleteAccount), their Recipient Group memberships must not
  // dangle - this never affects any other member's access.
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;
}
