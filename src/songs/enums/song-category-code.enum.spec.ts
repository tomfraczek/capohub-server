import { SongCategoryCode } from './song-category-code.enum';

describe('SongCategoryCode', () => {
  it('defines exactly the eight seeded category codes', () => {
    expect(Object.values(SongCategoryCode)).toEqual([
      'LADAINHA',
      'CHULA',
      'CORRIDO',
      'QUADRA',
      'MACULELE',
      'SAMBA_DE_RODA',
      'HINO',
      'OTHER',
    ]);
  });
});
