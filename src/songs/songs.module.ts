import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { SongCategory } from './entities/song-category.entity';
import { Tag } from './entities/tag.entity';
import { SongCategoriesController } from './song-categories.controller';
import { SongCategoriesService } from './song-categories.service';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  // Only SongCategory and Tag need forFeature() - they're the only entities
  // injected via @InjectRepository. SongsService drives every other Songbook
  // entity through the plain EntityManager (auto-discovered globally, see
  // mikro-orm-options.factory.ts), so registering them here would add
  // nothing.
  imports: [MikroOrmModule.forFeature([SongCategory, Tag])],
  controllers: [SongsController, SongCategoriesController, TagsController],
  providers: [SongsService, SongCategoriesService, TagsService],
})
export class SongsModule {}
