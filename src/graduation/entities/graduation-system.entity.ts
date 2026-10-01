import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';

export const GRADUATION_SYSTEMS_GROUP_ACTIVE_UNIQUE_INDEX =
  'graduation_systems_group_id_active_unique';

// The graduation (rank) catalog root for exactly one Group - never a
// Section (see the module's own spec: "Section nie definiuje własnego
// katalogu"). Only OWNER/ADMIN of this exact Group may manage it - no
// inheritance through the hierarchy or through Section membership (see
// GraduationSystemService / the GRADUATION_SYSTEM_* GroupPermissions).
//
// At most one ACTIVE system per Group, enforced by the partial unique index
// below - same pattern as FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX. A
// Group without any GraduationSystem is a valid, permanent state (a Group
// simply has no catalog yet). Multiple systems *could* exist historically
// (isActive = false) if this module ever grows a "replace the system"
// flow, but no such flow exists yet - today there is effectively exactly
// one, created once. It carries no name of its own (dropped in
// Migration20261001120000_DropGraduationSystemName) - a Group has a single
// catalog, so a separate system name only duplicated the Group's identity.
@Entity({ tableName: 'graduation_systems' })
@Unique({
  name: GRADUATION_SYSTEMS_GROUP_ACTIVE_UNIQUE_INDEX,
  properties: ['group'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.group}") where ("${columns.isActive}" is true)`,
})
export class GraduationSystem extends BaseEntity {
  // No delete cascade - a Group is archived, never physically deleted (ADR-
  // 007), so its GraduationSystem must never be removed out from under it.
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  group!: Group;

  @Property()
  isActive: boolean = true;
}
