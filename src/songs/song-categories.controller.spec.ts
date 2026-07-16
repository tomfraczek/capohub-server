import { SongCategory } from './entities/song-category.entity';
import { SongCategoriesController } from './song-categories.controller';
import { SongCategoriesService } from './song-categories.service';

function buildCategory(overrides: Partial<SongCategory> = {}): SongCategory {
  const category = new SongCategory();
  category.id = 'cat-1';
  category.code = 'CORRIDO';
  category.name = 'Corrido';
  category.position = 1;
  category.isActive = true;
  return Object.assign(category, overrides);
}

describe('SongCategoriesController', () => {
  it('maps active categories returned by the service to SongCategoryResponseDto', async () => {
    const listActive = jest.fn().mockResolvedValue([
      buildCategory({
        id: 'cat-1',
        code: 'CORRIDO',
        name: 'Corrido',
        position: 1,
      }),
      buildCategory({
        id: 'cat-2',
        code: 'CHULA',
        name: 'Chula',
        position: 2,
      }),
    ]);
    const controller = new SongCategoriesController({
      listActive,
    } as unknown as SongCategoriesService);

    const response = await controller.list();

    expect(listActive).toHaveBeenCalled();
    expect(response.data).toEqual([
      { id: 'cat-1', code: 'CORRIDO', name: 'Corrido', position: 1 },
      { id: 'cat-2', code: 'CHULA', name: 'Chula', position: 2 },
    ]);
  });
});
