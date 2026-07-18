import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SongLibraryModule } from './song-library/song-library.module';
import { SongsModule } from './songs/songs.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    SongsModule,
    SongLibraryModule,
    PlaylistsModule,
    HealthModule,
  ],
})
export class AppModule {}
