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
import { Group } from './group.entity';
import { Section } from './section.entity';
import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestType } from '../enums/membership-request-type.enum';

// Unique-index name constants - reused in migration and isUniqueViolationOn()
// calls to guard against duplicate PENDING requests.
export const MEMBERSHIP_REQUEST_PENDING_USER_IDX =
  'membership_requests_pending_user_invitation_unique';
export const MEMBERSHIP_REQUEST_PENDING_EMAIL_IDX =
  'membership_requests_pending_email_invitation_unique';
export const MEMBERSHIP_REQUEST_PENDING_JOIN_IDX =
  'membership_requests_pending_join_request_unique';

// One row covers both directions of the membership process:
//
//  INVITATION (type = INVITATION)
//    - initiatedBy: the member who sent the invite
//    - invitedUser (nullable): the User being invited if they already have an
//      account
//    - invitedEmail (nullable): the normalized email address if no account
//      exists yet (or if the inviter used email directly)
//    - Exactly one of invitedUser / invitedEmail must be set.
//
//  JOIN_REQUEST (type = JOIN_REQUEST)
//    - initiatedBy: the prospective member requesting access
//    - invitedUser = null, invitedEmail = null
//
// targetType encodes which *effect* accepting has:
//  GROUP   → creates/reactivates Membership only (no RoleAssignment)
//  SECTION → ensures Membership + grants MEMBER for the exact target
//
// Lifecycle: PENDING → ACCEPTED / REJECTED / CANCELLED.  Terminal rows are
// never reused.  No expiresAt or TTL.
//
// Three partial unique indexes enforce "only one PENDING request per
// (recipient, target)" at the DB level, covering both concurrent-request
// races and application-level checks. `coalesce(target_group_id,
// target_section_id)` folds the two nullable target FKs (see below) into
// one comparison key, since exactly one is ever set for a given row:
//   1. (target, invitedUser)  WHERE type='INVITATION' AND status='PENDING'
//   2. (target, invitedEmail) WHERE type='INVITATION' AND status='PENDING'
//   3. (target, initiatedBy)  WHERE type='JOIN_REQUEST' AND status='PENDING'
//
// No delete cascade on any FK: Groups, Sections and Users are soft-deleted
// / archived, never physically removed in normal operation (see ADR-007).
@Entity({ tableName: 'membership_requests' })
@Unique({
  name: MEMBERSHIP_REQUEST_PENDING_USER_IDX,
  properties: ['targetGroup', 'targetSection', 'invitedUser'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.targetGroup}", "${columns.targetSection}"), "${columns.invitedUser}") where ("${columns.status}" = 'PENDING' and "${columns.type}" = 'INVITATION' and "${columns.invitedUser}" is not null)`,
})
@Unique({
  name: MEMBERSHIP_REQUEST_PENDING_EMAIL_IDX,
  properties: ['targetGroup', 'targetSection', 'invitedEmail'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.targetGroup}", "${columns.targetSection}"), "${columns.invitedEmail}") where ("${columns.status}" = 'PENDING' and "${columns.type}" = 'INVITATION' and "${columns.invitedEmail}" is not null)`,
})
@Unique({
  name: MEMBERSHIP_REQUEST_PENDING_JOIN_IDX,
  properties: ['targetGroup', 'targetSection', 'initiatedBy'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.targetGroup}", "${columns.targetSection}"), "${columns.initiatedBy}") where ("${columns.status}" = 'PENDING' and "${columns.type}" = 'JOIN_REQUEST')`,
})
export class MembershipRequest extends BaseEntity {
  @Enum({ items: () => Object.values(MembershipRequestType) })
  type!: MembershipRequestType;

  @Enum({ items: () => Object.values(MembershipRequestTarget) })
  targetType!: MembershipRequestTarget;

  // The Group-or-Section targeted by this request, represented by two
  // nullable FKs (exactly one set) since the Group/Section physical split -
  // see GroupHierarchyService.findCommunityById for resolving whichever one
  // is populated.
  //
  // IMPORTANT: this pair serves a DUAL role depending on targetType:
  //
  //   targetType = GROUP
  //     The target MUST be a root Group (targetGroup set, targetSection
  //     null, and that Group's own parentGroup === null). A root Group IS
  //     the organization. Accepting this request creates a GroupMembership
  //     for the Group only — no RoleAssignment is created anywhere (see
  //     ADR-004).
  //
  //   targetType = SECTION
  //     The target may be a Group (at any depth) or a Section. Accepting
  //     this request ensures a GroupMembership in the target's root Group
  //     AND grants a MEMBER RoleAssignment in exactly the target.
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  targetGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  targetSection: Section | null = null;

  // The User who created this request:
  //   INVITATION → the member who sent the invite
  //   JOIN_REQUEST → the prospective member requesting to join
  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  initiatedBy!: User;

  // INVITATION only: the User being invited (if they have an account).
  // Null for JOIN_REQUEST rows or email-only invitations.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  invitedUser: User | null = null;

  // INVITATION only: the normalized (trimmed + lowercased) email of the
  // invitee when no account exists yet, or when the inviter used email
  // explicitly.  Null for JOIN_REQUEST rows and userId-based invitations.
  @Index()
  @Property({ nullable: true, length: 255 })
  invitedEmail: string | null = null;

  @Enum({ items: () => Object.values(MembershipRequestStatus) })
  status: MembershipRequestStatus = MembershipRequestStatus.PENDING;

  // Timestamped when the request transitions out of PENDING.
  @Property({ type: 'timestamptz', nullable: true })
  processedAt: Date | null = null;

  // The User who approved/rejected/cancelled the request.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  processedBy: User | null = null;
}
