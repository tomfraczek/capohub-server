import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { AcademyStatus } from '../enums/academy-status.enum';
import { Group } from './group.entity';
import { Section } from './section.entity';

// Academy is a physical training location, not an organizational unit - it
// has no members, permissions, administrators, or child academies (see
// ADR-012). It always belongs to exactly one Group-or-Section and is never
// part of the hierarchy itself. Since the Group/Section physical split
// (stage 1 of the organizational-domain rebuild), that "belongs to either
// kind" relationship is represented by two nullable FKs, exactly one of
// which is ever set - see GroupHierarchyService.findCommunityById for
// resolving whichever one is populated.
@Entity({ tableName: 'academies' })
// Exactly one of `group`/`section` must be set, never both, never neither -
// mirrored here so migration:create/schema:update know this constraint is
// intentional and never propose dropping it. Name matches the constraint
// the migration creates verbatim - see
// Migration20260802100200_AddPolymorphicCommunityReferences.
@Check<Academy>({
  name: 'academies_group_or_section_check',
  expression: (columns) =>
    `("${columns.group}" is not null and "${columns.section}" is null) or ("${columns.group}" is null and "${columns.section}" is not null)`,
})
export class Academy extends BaseEntity {
  // No delete cascade - Academy is archived, never physically deleted, and
  // must remain a valid historical reference even if its Group is archived
  // (see ADR-007).
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  group: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  section: Section | null = null;

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
