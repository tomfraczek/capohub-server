import { Tag } from './tag.entity';

describe('Tag', () => {
  it('defaults isActive to true', () => {
    const tag = new Tag();
    expect(tag.isActive).toBe(true);
  });
});
