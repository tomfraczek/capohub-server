import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { GroupMembership } from './group-membership.entity';
import { Section } from './section.entity';

// A member's assignment to a Section within their own organization (see
// organization-entities.md#section: "zero or more Section Memberships").
// No cascade delete to either side - both GroupMembership and Section are
// archived, never physically deleted (ADR-007), so there is never a
// delete to cascade from in practice; unassigning a Section is a direct,
// hard removal of this row instead (the assignment itself carries no
// history requirement, unlike Membership).
@Entity({ tableName: 'membership_sections' })
@Unique({ properties: ['membership', 'section'] })
export class MembershipSection extends BaseEntity {
  @Index()
  @ManyToOne(() => GroupMembership)
  membership!: GroupMembership;

  @Index()
  @ManyToOne(() => Section)
  section!: Section;
}
