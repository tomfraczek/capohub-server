import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
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
// No separate `readAt` column - BaseEntity's own `createdAt` already *is*
// the read timestamp (this row is created exactly once, at the moment of
// reading, and never updated afterward), so the mapper reads `readAt` from
// `createdAt` rather than storing a redundant duplicate timestamp.
@Entity({ tableName: 'announcement_reads' })
@Unique({ properties: ['announcement', 'user'] })
export class AnnouncementRead extends BaseEntity {
  @Index()
  @ManyToOne(() => Announcement, { deleteRule: 'cascade' })
  announcement!: Announcement;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;
}
