import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { AcademyStatus } from '../enums/academy-status.enum';
import { Group } from './group.entity';

// Academy is a physical training location, not an organizational unit - it
// has no members, permissions, administrators, or child academies (see
// ADR-012). It always belongs to exactly one Group and is never part of
// the Group hierarchy itself.
@Entity({ tableName: 'academies' })
export class Academy extends BaseEntity {
  // No delete cascade - Academy is archived, never physically deleted, and
  // must remain a valid historical reference even if its Group is archived
  // (see ADR-007).
  @Index()
  @ManyToOne(() => Group)
  group!: Group;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  address: string | null = null;

  @Property({ nullable: true, type: 'float' })
  latitude: number | null = null;

  @Property({ nullable: true, type: 'float' })
  longitude: number | null = null;

  @Property({ nullable: true, length: 255 })
  contactEmail: string | null = null;

  @Property({ nullable: true, length: 50 })
  contactPhone: string | null = null;

  // Free-form text rather than a structured weekly schedule - the domain
  // docs list "opening hours" as a stored responsibility but do not define
  // a schedule model, and organizations' actual hours vary too much to
  // guess a structure that isn't asked for.
  @Property({ nullable: true, type: 'text' })
  openingHours: string | null = null;

  @Property({ nullable: true, type: 'json' })
  photoUrls: string[] | null = null;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Index()
  @Enum({ items: () => Object.values(AcademyStatus) })
  status: AcademyStatus = AcademyStatus.ACTIVE;
}
