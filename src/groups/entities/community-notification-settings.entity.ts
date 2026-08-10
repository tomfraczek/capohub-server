import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';
import { Section } from './section.entity';

export const COMMUNITY_NOTIFICATION_SETTINGS_UNIQUE_INDEX =
  'community_notification_settings_user_id_community_unique';

// One row per (user, Group-or-Section) pair - the user's own notification
// preferences for that exact community. Represented by two nullable FKs
// (communityGroup/communitySection), exactly one ever set - same
// dual-nullable-FK pattern as Announcement/Event/Notification (see
// group-hierarchy.service.ts's own Community type comment). Originally
// Section-only (Group has no membership, so there was no "own" set of
// join/invite-workflow preferences to store for it); widened to also cover
// Group so a Group's own admin circle (RoleAssignment holders - see
// CommunityNotificationSettingsService.assertGroupParticipantOrFail) can
// mute Group-scoped push the same way a Section member can (module spec §
// GROUP NOTIFICATION SETTINGS). The five join/invite-workflow toggles below
// remain meaningless for a Group row (Group has no join/invite flow at all
// - see MembershipRequestsService.groupHasNoMembership) and are simply
// never surfaced/written through the Group endpoint - see
// GroupNotificationSettingsResponseDto's own minimal {communityId, muted}
// shape, contrasted with CommunityNotificationSettingsResponseDto's full
// shape for Section.
//
// This entity stores *preferences only*. A missing row for a (user,
// community) pair means "use the defaults" (every toggle true, `muted`
// false) - CommunityNotificationSettingsService creates the row lazily,
// only on the first explicit update, so simply viewing a community never
// writes anything.
//
// `muted` (below) is the Notifications module's per-community push mute
// (module spec § COMMUNITY-SPECIFIC MUTE / § GROUP NOTIFICATION SETTINGS):
// when true, NotificationPushService suppresses push delivery for any
// Notification whose contextGroup/contextSection is this exact community,
// regardless of category or of the toggles below - but the Notification
// itself is still always created, so the in-app inbox is entirely
// unaffected (mute governs push only, never the inbox). Exact-resource
// only, deliberately never inherited: a muted Group does not mute its
// child Sections, and a muted Section does not mute its parent Group - see
// NotificationPushService's own resolution (it reads contextGroup XOR
// contextSection off the Notification itself, never walks the hierarchy).
// Five of the ten booleans below (newJoinRequests/joinRequestApproved/
// newInvitations/invitationAccepted/invitationRejected) additionally each
// gate one specific Section membership-workflow push (see
// NotificationPushService's own MEMBERSHIP_TYPE_SETTINGS_FIELD mapping) -
// checked independently of `muted`, and only ever consulted for a
// contextSection Notification. The remaining five (roleChanges/
// transferOwnership/archived/restored/communityDeleted) predate the
// Notifications module and are not yet consulted by any delivery decision -
// no domain integration raises a notification for those events.
@Entity({ tableName: 'community_notification_settings' })
@Unique({
  name: COMMUNITY_NOTIFICATION_SETTINGS_UNIQUE_INDEX,
  properties: ['user', 'communityGroup', 'communitySection'],
  // `coalesce` folds the two nullable community FKs into one comparison
  // key, since exactly one of them is ever set for a given row - same
  // pattern as ROLE_ASSIGNMENTS_UNIQUE_INDEX (see role-assignment.entity.ts).
  // A plain multi-column unique index would not do this: Postgres never
  // considers two NULLs equal, so two Group-type rows (both with
  // communitySection NULL) would not collide without this.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}", coalesce("${columns.communityGroup}", "${columns.communitySection}"))`,
})
// Exactly one of `communityGroup`/`communitySection` must be set, never
// both, never neither - same convention as RoleAssignment/Announcement/
// Event/Notification.
@Check<CommunityNotificationSettings>({
  name: 'community_notification_settings_group_or_section_check',
  expression: (columns) =>
    `("${columns.communityGroup}" is not null and "${columns.communitySection}" is null) or ("${columns.communityGroup}" is null and "${columns.communitySection}" is not null)`,
})
export class CommunityNotificationSettings extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'cascade' })
  communityGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'cascade' })
  communitySection: Section | null = null;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // Admin-facing: someone submitted a new Join Request. Section-only (see
  // the class comment) - never written/read for a Group row.
  @Property()
  newJoinRequests: boolean = true;

  // Requester-facing: my Join Request was approved.
  @Property()
  joinRequestApproved: boolean = true;

  // Recipient-facing: I received a new Invitation.
  @Property()
  newInvitations: boolean = true;

  // Inviter-facing: an Invitation I sent was accepted.
  @Property()
  invitationAccepted: boolean = true;

  // Inviter-facing: an Invitation I sent was rejected.
  @Property()
  invitationRejected: boolean = true;

  // A Role was granted to or revoked from a member.
  @Property()
  roleChanges: boolean = true;

  @Property()
  transferOwnership: boolean = true;

  @Property()
  archived: boolean = true;

  @Property()
  restored: boolean = true;

  @Property()
  communityDeleted: boolean = true;

  // Broad per-community push mute - see the class comment above. Default
  // false (not muted), independent of every field above. The one field a
  // Group row ever sets.
  @Property()
  muted: boolean = false;
}
