// Initial production catalogue rows for the Instruments/Rhythms CMS content
// (see seed-music-content.ts) - not demo/sample data. Every other field is
// left empty on creation and gets filled in later through the admin CRUD
// endpoints.
export interface MusicContentSeedRow {
  name: string;
  slug: string;
  displayOrder: number;
}

export const INSTRUMENT_SEED_ROWS: MusicContentSeedRow[] = [
  { name: 'Berimbau Gunga', slug: 'berimbau-gunga', displayOrder: 1 },
  { name: 'Berimbau Médio', slug: 'berimbau-medio', displayOrder: 2 },
  { name: 'Berimbau Viola', slug: 'berimbau-viola', displayOrder: 3 },
  { name: 'Pandeiro', slug: 'pandeiro', displayOrder: 4 },
  { name: 'Atabaque', slug: 'atabaque', displayOrder: 5 },
  { name: 'Agogô', slug: 'agogo', displayOrder: 6 },
  { name: 'Reco-reco', slug: 'reco-reco', displayOrder: 7 },
  { name: 'Caxixi', slug: 'caxixi', displayOrder: 8 },
];

export const RHYTHM_SEED_ROWS: MusicContentSeedRow[] = [
  { name: 'Angola', slug: 'angola', displayOrder: 1 },
  { name: 'São Bento Grande', slug: 'sao-bento-grande', displayOrder: 2 },
  { name: 'São Bento Pequeno', slug: 'sao-bento-pequeno', displayOrder: 3 },
  { name: 'Benguela', slug: 'benguela', displayOrder: 4 },
  { name: 'Iúna', slug: 'iuna', displayOrder: 5 },
  { name: 'Santa Maria', slug: 'santa-maria', displayOrder: 6 },
  { name: 'Cavalaria', slug: 'cavalaria', displayOrder: 7 },
  { name: 'Amazonas', slug: 'amazonas', displayOrder: 8 },
];
