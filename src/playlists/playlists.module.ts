import { Module } from '@nestjs/common';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

// Standalone leaf module, same rationale as SongLibraryModule: Playlist and
// PlaylistSong are driven entirely through the plain EntityManager, and
// PlaylistsService is exported so SongsModule can use
// getPlaylistsContainingSong for the SongDetails.playlists field without a
// reverse dependency from this module back onto SongsModule.
@Module({
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
