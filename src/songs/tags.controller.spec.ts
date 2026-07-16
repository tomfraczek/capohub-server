import { Tag } from './entities/tag.entity';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

function buildTag(overrides: Partial<Tag> = {}): Tag {
  const tag = new Tag();
  tag.id = 'tag-1';
  tag.name = 'ladainha';
  tag.slug = 'ladainha';
  tag.isActive = true;
  return Object.assign(tag, overrides);
}

describe('TagsController', () => {
  it('passes search and limit through to TagsService.search and maps the result', async () => {
    const search = jest.fn().mockResolvedValue([buildTag()]);
    const controller = new TagsController({ search } as unknown as TagsService);

    const response = await controller.list({ search: 'lada', limit: 20 });

    expect(search).toHaveBeenCalledWith('lada', 20);
    expect(response.data).toEqual([
      { id: 'tag-1', name: 'ladainha', slug: 'ladainha' },
    ]);
  });
});
