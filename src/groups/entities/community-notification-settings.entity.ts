import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

// One row per (user, community) pair - the user's own notification
// preferences for that specific Organization (Root Group). Scoped to the
// Root Group, not any Child Group, mirroring Membership's own scope
// (ADR-004) - every event listed below (join requests, invitations, role
// changes, ownership transfer, lifecycle changes) is either inherently
// Organization-wide or, for a Child-Group-scoped event like ADD_ROLE, still
// filed under the Organization's Audit Log the same way (see
// AuditLogEntry.community) - there is no finer-grained per-Child-Group
// notification preference.
//
// This entity stores *preferences only* - whether and how notifications are
// actually delivered (push, email, in-app) is a future Notifications
// module's concern, entirely out of scope here (see PAD-001 exclusions).
// A missing row for a (user, community) pair means "use the defaults"
// (every toggle true) - CommunityNotificationSettingsService creates the
// row lazily, only on the first explicit update, so simply viewing a
// community never writes anything.
@Entity({ tableName: 'community_notification_settings' })
@Unique({ properties: ['community', 'user'] })
export class CommunityNotificationSettings extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'cascade' })
  community!: Group;

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
