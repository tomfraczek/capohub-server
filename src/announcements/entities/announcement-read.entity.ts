import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Announcement } from './announcement.entity';

// Persistent per-user read tracking - a row's mere existence means this
// user has opened this Announcement's detail at least once. Fetching the
// list never creates a row (task requirement - "Samo pobranie listy nie
// oznacza przeczytania"); only the dedicated mark-as-read operation does
// (see AnnouncementsService.markRead), and it is idempotent by
// construction: the (announcement, user) unique constraint means a second
// call finds the existing row and returns it as-is rather than erroring or
// duplicating (same race-recovery pattern as
// LearningStatusService.setStatus).
//
// `readAt` is its own explicit column, not `createdAt` read under another
// name - the two happen to coincide today (this row is created exactly
// once, at the moment of reading, and never updated afterward), but
// `createdAt` is BaseEntity's generic technical bookkeeping field, while
// `readAt` is the actual business fact this entity exists to record;
// conflating them would make a future, unrelated change to `createdAt`'s
// semantics silently corrupt read-tracking.
@Entity({ tableName: 'announcement_reads' })
@Unique({ properties: ['announcement', 'user'] })
export class AnnouncementRead extends BaseEntity {
  @Index()
  @ManyToOne(() => Announcement, { deleteRule: 'cascade' })
  announcement!: Announcement;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ type: 'timestamptz' })
  readAt: Date = new Date();
}
