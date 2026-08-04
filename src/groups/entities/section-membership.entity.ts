import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { Section } from './section.entity';

export const SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX =
  'section_memberships_section_id_user_id_active_unique';

// One row per stint a user has in a Section - never reused/overwritten
// across a join/leave/rejoin cycle, so membership history is preserved
// (see SectionMembershipStatus). Exactly one ACTIVE row may exist per
// (section, user) at a time - enforced application-side, transactionally,
// by SectionMembershipsService, *and* backed by this partial unique index
// as a database-level safety net against races.
//
// Only Section has membership - Group has none at all (see
// group-role-permissions.map.ts / RoleAssignmentsService.resolveAuthorization
// for the Group-target path, which never touches this entity).
//
// Deliberately has no `role` field - membership never stores a Role. Which
// Role(s) a user holds for a Section is answered entirely by RoleAssignment
// records, correlated by (user, section), never by an FK to this entity
// (see role-assignment.entity.ts for why there is no such FK).
@Entity({ tableName: 'section_memberships' })
@Index({ properties: ['section', 'user', 'status'] })
@Unique({
  name: SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  properties: ['section', 'user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.section}", "${columns.user}") where ("${columns.status}" = 'ACTIVE')`,
})
export class SectionMembership extends BaseEntity {
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'cascade' })
  section!: Section;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Enum({ items: () => Object.values(SectionMembershipStatus) })
  status: SectionMembershipStatus = SectionMembershipStatus.ACTIVE;

  @Property({ type: 'timestamptz' })
  joinedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  leftAt: Date | null = null;

  // Distinguishes a self-service leave from an administrator removing the
  // member - both end in status ARCHIVED, so this is the only place that
  // distinction survives. `null` until the membership is archived.
  @Enum({ items: () => Object.values(MembershipEndReason), nullable: true })
  endReason: MembershipEndReason | null = null;

  // Who ended this membership: the user themself (leave), an admin/OWNER
  // (removeMember/banMember), or `null` when it's a side effect of the
  // user's own account deletion (there is no "other" actor) - or once the
  // recorded actor later deletes their own account (`set null`, never
  // cascade: deleting an admin's account must never delete other users'
  // membership history).
  // Index maintained on (section, user) above supports the independent
  // authorization lookup RoleAssignmentsService.resolveAuthorization makes
  // for a Section target (no FK from RoleAssignment to this entity).
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  endedBy: User | null = null;
}
