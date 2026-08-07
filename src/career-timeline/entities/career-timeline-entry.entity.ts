import { Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';

// The ONLY persisted career-timeline data - every other category
// (CAPOEIRA_START, FORMAL_GROUP_JOINED/LEFT, FORMAL_RANK, EVENT) is built
// at read time from existing sources (User, FormalGroupAffiliation,
// FormalRankAssignment, EventAttendee - see
// career-timeline-aggregation.service.ts). A row here is always category
// CUSTOM - there is no `category` column, since no other value is ever
// possible (see the module spec: "Kategoria zawsze CUSTOM").
//
// No subtypes, no attachments/photos, no Group/Section/Event link at this
// stage (all explicitly out of scope per the module spec) - just a free-
// text, owner-authored note pinned to a date.
@Entity({ tableName: 'career_timeline_entries' })
export class CareerTimelineEntry extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // Date-only, never in the future - enforced in
  // CareerTimelineEntriesService, not here (depends on "now" at write
  // time).
  @Property({ type: 'date' })
  occurredOn!: Date;

  @Property({ length: 200 })
  title!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;
}
