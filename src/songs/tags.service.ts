import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, FilterQuery } from '@mikro-orm/core';
import { Tag } from './entities/tag.entity';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepository: EntityRepository<Tag>,
  ) {}

  async search(search: string | undefined, limit: number): Promise<Tag[]> {
    const where: FilterQuery<Tag> = { isActive: true };

    if (search) {
      where.name = { $ilike: `%${search}%` };
    }

    return this.tagRepository.find(where, { orderBy: { name: 'ASC' }, limit });
  }
}
