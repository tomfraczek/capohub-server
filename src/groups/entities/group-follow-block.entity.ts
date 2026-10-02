import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

// A Group OWNER/ADMIN's "this user may not follow this Group" - the
// follow-side counterpart of a Section ban (which only ever blocks
// re-*joining* a Section, never following its Group). While a row exists,
// POST /groups/:id/follow is rejected with GROUP_FOLLOW_BLOCKED (see
// GroupFollowService.follow). Creating one always removes the user's
// current GroupFollow too - a blocked user never keeps following.
// Lifted only by deleting the row (DELETE /groups/:id/follow-blocks/:userId).
//
// Same FK rules as GroupFollow: `user` cascades (a deleted account leaves
// no orphan block), `group` is 'no action' (a Group is never physically
// deleted).
@Entity({ tableName: 'group_follow_blocks' })
@Unique({ properties: ['user', 'group'] })
export class GroupFollowBlock extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  group!: Group;
}
