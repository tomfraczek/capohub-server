// The initial, fixed set of SongCategory.code values, used only by the seed
// migration and by tests. SongCategory.code itself is a plain unique
// varchar column (not a DB check-constrained enum) because categories are a
// table-driven dictionary - adding a 9th category later must not require a
// schema migration.
export enum SongCategoryCode {
  LADAINHA = 'LADAINHA',
  CHULA = 'CHULA',
  CORRIDO = 'CORRIDO',
  QUADRA = 'QUADRA',
  MACULELE = 'MACULELE',
  SAMBA_DE_RODA = 'SAMBA_DE_RODA',
  HINO = 'HINO',
  OTHER = 'OTHER',
}
