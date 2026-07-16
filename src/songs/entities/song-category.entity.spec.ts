import { SongCategory } from './song-category.entity';

describe('SongCategory', () => {
  it('defaults isActive to true', () => {
    const category = new SongCategory();
    expect(category.isActive).toBe(true);
  });
});
