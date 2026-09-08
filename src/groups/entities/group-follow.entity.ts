import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

// A User "watching" a Group without joining anything - deliberately NOT a
// membership: it grants no role, no permission, and is entirely independent
// of SectionMembership/RoleAssignment (module: "Obserwowanie grupy... To NIE
// jest członkostwo"). A Group has no ordinary members at all (see
// group.entity.ts's own comment) - this is the one relationship a User may
// hold with a Group directly, with no Section in between.
//
// Deliberately NOT cleared when the follower later joins a Section of this
// Group (no code path here ever deletes a row just because a membership
// appeared) - so leaving every Section of the Group again still leaves the
// User following it (module: "NIE musisz usuwać istniejącego GroupFollow").
// Whether a viewer is "really" related to a Group through Section membership
// is answered separately, from SectionMembership - see
// RoleAssignmentsService/CommunityOverviewService - never derived from this
// table, and this table is never derived from that either; the two are
// intentionally independent signals combined only at the read/DTO layer
// (see GroupResponseDto's isMemberThroughSection/isFollowing pair).
//
// `user` cascades on delete (a physically-deleted User account - DELETE
// /users/me - must not leave an orphaned follow row behind), `group` does
// not (same 'no action' convention as every other Group-referencing FK in
// this module, e.g. RoleAssignment.group - GROUP_DELETE is a soft status
// flag, GroupStatus.DELETED, never a physical row removal, so there is no
// delete event for this FK to react to in practice).
@Entity({ tableName: 'group_follows' })
@Unique({ properties: ['user', 'group'] })
export class GroupFollow extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  group!: Group;
}
