import { Module } from '@nestjs/common';
import { FavoriteSongsService } from './favorite-songs.service';
import { LearningStatusService } from './learning-status.service';
import { SongInteractionsController } from './song-interactions.controller';
import { SongNotesService } from './song-notes.service';

// Standalone leaf module - every entity here (FavoriteSong,
// UserSongLearning, SongNote) is driven through the plain EntityManager
// (auto-discovered globally, see mikro-orm-options.factory.ts), so no
// forFeature() registration is needed. Deliberately has no NestJS-level
// dependency on SongsModule/UsersModule in either direction - it exports
// its services so SongsModule (SongDetails aggregation) and UsersModule
// (/users/me/favorite-songs, /learning-songs) can both import this module
// without creating a cycle between themselves.
@Module({
  controllers: [SongInteractionsController],
  providers: [FavoriteSongsService, LearningStatusService, SongNotesService],
  exports: [FavoriteSongsService, LearningStatusService, SongNotesService],
})
export class SongLibraryModule {}
