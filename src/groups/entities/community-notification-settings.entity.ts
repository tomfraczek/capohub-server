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
// This entity stores *preferences only* - whether and how notifications are
// actually delivered (push, email, in-app) is a future Notifications
// module's concern, entirely out of scope here (see PAD-001 exclusions).
// A missing row for a (user, section) pair means "use the defaults"
// (every toggle true) - CommunityNotificationSettingsService creates the
// row lazily, only on the first explicit update, so simply viewing a
// section never writes anything.
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
}
