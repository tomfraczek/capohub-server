import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { GroupMembership } from './group-membership.entity';
import { Cohort } from './cohort.entity';

// A member's assignment to a Cohort within their own organization (see
// organization-entities.md#cohort: "zero or more Cohort Memberships").
// No cascade delete to either side - both GroupMembership and Cohort are
// archived, never physically deleted (ADR-007), so there is never a
// delete to cascade from in practice; unassigning a Cohort is a direct,
// hard removal of this row instead (the assignment itself carries no
// history requirement, unlike Membership).
@Entity({ tableName: 'membership_cohorts' })
@Unique({ properties: ['membership', 'cohort'] })
export class MembershipCohort extends BaseEntity {
  @Index()
  @ManyToOne(() => GroupMembership)
  membership!: GroupMembership;

  @Index()
  @ManyToOne(() => Cohort)
  cohort!: Cohort;
}
