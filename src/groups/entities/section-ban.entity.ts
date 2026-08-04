import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Section } from './section.entity';

export const SECTION_BANS_ACTIVE_UNIQUE_INDEX =
  'section_bans_section_id_user_id_active_unique';

// A durable record that a User is banned from a Section, independent of
// any SectionMembership row - a ban must still block rejoining even though
// the membership it ended is, like every membership, never physically
// deleted and stays ARCHIVED forever.
//
// `liftedAt === null` means the ban is currently active. Unbanning sets
// `liftedAt`/`liftedBy` rather than deleting the row, so a lifted ban still
// exists as history. A user banned again after being unbanned gets a brand
// new row, never a reused one - the same never-reused-history principle as
// SectionMembership.
//
// `user`/`bannedBy`/`liftedBy` are all `set null` on delete - a User
// account can be physically deleted independent of any ban record that
// references them, either as the banned party or as the admin who
// banned/unbanned someone else.
@Entity({ tableName: 'section_bans' })
@Unique({
  name: SECTION_BANS_ACTIVE_UNIQUE_INDEX,
  properties: ['section', 'user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.section}", "${columns.user}") where ("${columns.liftedAt}" is null)`,
})
export class SectionBan extends BaseEntity {
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'no action' })
  section!: Section;

  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  user: User | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  bannedBy: User | null = null;

  @Property({ type: 'timestamptz' })
  bannedAt: Date = new Date();

  @Property({ nullable: true, type: 'text' })
  reason: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  liftedAt: Date | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  liftedBy: User | null = null;
}
