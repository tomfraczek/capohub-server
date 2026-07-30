import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Announcement } from './announcement.entity';

// The immutable recipient snapshot for one RECIPIENT_GROUP-type
// Announcement (see Announcement.recipientType) - one row per user who was
// a member of the target Recipient Group at the moment of publish. Written
// once, at create time, and never updated afterward: a later change to the
// Recipient Group's own membership (RecipientGroupMember) must never alter
// who this already-published Announcement reaches (task requirement).
//
// Not used at all for GROUP/SECTION-type Announcements - their audience is
// always the community's current membership, resolved dynamically (see
// AnnouncementsService), never snapshotted.
//
// Being *in* this snapshot is necessary but not sufficient for access: the
// viewer must also still be a current, active member of the Announcement's
// own community (task requirement - "odbiorca nadal musi pozostawać
// uprawnionym członkiem zasobu nadrzędnego") - re-checked live on every
// read, never cached here.
@Entity({ tableName: 'announcement_recipients' })
@Unique({ properties: ['announcement', 'user'] })
export class AnnouncementRecipient extends BaseEntity {
  @Index()
  @ManyToOne(() => Announcement, { deleteRule: 'cascade' })
  announcement!: Announcement;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;
}
