import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PermissionsModule } from '../auth/permissions/permissions.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { SongCategory } from './entities/song-category.entity';
import { Tag } from './entities/tag.entity';
import { SongCategoriesController } from './song-categories.controller';
import { SongCategoriesService } from './song-categories.service';
import { SongDuplicateService } from './song-duplicate.service';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  // Only SongCategory and Tag need forFeature() - they're the only entities
  // injected via @InjectRepository. SongsService drives every other Songbook
  // entity through the plain EntityManager (auto-discovered globally, see
  // mikro-orm-options.factory.ts), so registering them here would add
  // nothing. PermissionsModule is imported for PermissionsGuard, used by the
  // media verify/unverify endpoints. SongLibraryModule/PlaylistsModule are
  // imported one-directionally (neither imports SongsModule back) so
  // SongsService can aggregate isFavorite/learningStatus/myNote/playlists
  // into SongDetails - see SongsService.loadUserContext.
  imports: [
    MikroOrmModule.forFeature([SongCategory, Tag]),
    PermissionsModule,
    SongLibraryModule,
    PlaylistsModule,
  ],
  controllers: [SongsController, SongCategoriesController, TagsController],
  providers: [
    SongsService,
    SongDuplicateService,
    SongCategoriesService,
    TagsService,
  ],
})
export class SongsModule {}
