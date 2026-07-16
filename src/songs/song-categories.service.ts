import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/core';
import { SongCategory } from './entities/song-category.entity';

@Injectable()
export class SongCategoriesService {
  constructor(
    @InjectRepository(SongCategory)
    private readonly categoryRepository: EntityRepository<SongCategory>,
  ) {}

  async listActive(): Promise<SongCategory[]> {
    return this.categoryRepository.find(
      { isActive: true },
      { orderBy: { position: 'ASC' } },
    );
  }
}
