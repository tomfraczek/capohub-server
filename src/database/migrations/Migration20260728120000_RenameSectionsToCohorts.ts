import { Migration } from '@mikro-orm/migrations';

// Part of the Group/Section domain rename (see the rename ADR). Today's
// "Section" (a flat, optional subdivision for grouping members within a
// Group - ADR-003) is renamed to "Cohort" to free up the name "Section" for
// the hierarchy-level rename (today's child Group -> Section) landing in a
// later migration. Pure rename throughout - table/column/constraint/index
// renames only, no data transformation, so every existing id and row is
// preserved exactly as-is.
export class Migration20260728120000_RenameSectionsToCohorts extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "sections" rename to "cohorts";`);
    this.addSql(
      `alter table "cohorts" rename constraint "sections_pkey" to "cohorts_pkey";`,
    );
    this.addSql(
      `alter table "cohorts" rename constraint "sections_group_id_foreign" to "cohorts_group_id_foreign";`,
    );
    this.addSql(
      `alter table "cohorts" rename constraint "sections_status_check" to "cohorts_status_check";`,
    );
    this.addSql(
      `alter index "sections_group_id_index" rename to "cohorts_group_id_index";`,
    );
    this.addSql(
      `alter index "sections_status_index" rename to "cohorts_status_index";`,
    );

    this.addSql(
      `alter table "membership_sections" rename to "membership_cohorts";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename column "section_id" to "cohort_id";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_sections_pkey" to "membership_cohorts_pkey";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_sections_membership_id_section_id_unique" to "membership_cohorts_membership_id_cohort_id_unique";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_sections_membership_id_foreign" to "membership_cohorts_membership_id_foreign";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_sections_section_id_foreign" to "membership_cohorts_cohort_id_foreign";`,
    );
    this.addSql(
      `alter index "membership_sections_membership_id_index" rename to "membership_cohorts_membership_id_index";`,
    );
    this.addSql(
      `alter index "membership_sections_section_id_index" rename to "membership_cohorts_cohort_id_index";`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter index "membership_cohorts_cohort_id_index" rename to "membership_sections_section_id_index";`,
    );
    this.addSql(
      `alter index "membership_cohorts_membership_id_index" rename to "membership_sections_membership_id_index";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_cohorts_cohort_id_foreign" to "membership_sections_section_id_foreign";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_cohorts_membership_id_foreign" to "membership_sections_membership_id_foreign";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_cohorts_membership_id_cohort_id_unique" to "membership_sections_membership_id_section_id_unique";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename constraint "membership_cohorts_pkey" to "membership_sections_pkey";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename column "cohort_id" to "section_id";`,
    );
    this.addSql(
      `alter table "membership_cohorts" rename to "membership_sections";`,
    );

    this.addSql(
      `alter index "cohorts_status_index" rename to "sections_status_index";`,
    );
    this.addSql(
      `alter index "cohorts_group_id_index" rename to "sections_group_id_index";`,
    );
    this.addSql(
      `alter table "cohorts" rename constraint "cohorts_status_check" to "sections_status_check";`,
    );
    this.addSql(
      `alter table "cohorts" rename constraint "cohorts_group_id_foreign" to "sections_group_id_foreign";`,
    );
    this.addSql(
      `alter table "cohorts" rename constraint "cohorts_pkey" to "sections_pkey";`,
    );
    this.addSql(`alter table "cohorts" rename to "sections";`);
  }
}
