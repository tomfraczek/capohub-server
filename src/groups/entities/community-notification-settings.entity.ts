import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Section } from './section.entity';

// One row per (user, Section) pair - the user's own notification
// preferences for that Section. Section-only: Group has no membership,
// so there is no "own" set of notification preferences to store for it -
// this was always a per-member preference, never a per-role one, so
// Group's ADMIN/OWNER simply have nothing here.
//
// This entity stores *preferences only*. A missing row for a (user,
// section) pair means "use the defaults" (every toggle true, `muted`
// false) - CommunityNotificationSettingsService creates the row lazily,
// only on the first explicit update, so simply viewing a section never
// writes anything.
//
// `muted` (below) is the Notifications module's per-community push mute
// (module spec § COMMUNITY-SPECIFIC MUTE): when true, NotificationPushService
// suppresses push delivery for any Notification whose contextSection is
// this Section, regardless of category or of the toggles below - but the
// Notification itself is still always created, so the in-app inbox is
// entirely unaffected (mute governs push only, never the inbox). Five of
// the ten booleans below (newJoinRequests/joinRequestApproved/
// newInvitations/invitationAccepted/invitationRejected) additionally each
// gate one specific membership-workflow push (see NotificationPushService's
// own MEMBERSHIP_TYPE_SETTINGS_FIELD mapping) - checked independently of
// `muted`. The remaining five (roleChanges/transferOwnership/archived/
// restored/communityDeleted) predate this module and are not yet consulted
// by any delivery decision - no domain integration here raises a
// notification for those events (see this module's final report).
@Entity({ tableName: 'community_notification_settings' })
@Unique({ properties: ['community', 'user'] })
export class CommunityNotificationSettings extends BaseEntity {
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'cascade' })
  community!: Section;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // Admin-facing: someone submitted a new Join Request.
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
  // false (not muted), independent of every field above.
  @Property()
  muted: boolean = false;
}
