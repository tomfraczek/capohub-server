import { Module } from '@nestjs/common';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthModule } from './auth/auth.module';
import { CareerTimelineModule } from './career-timeline/career-timeline.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { EventsModule } from './events/events.module';
import { GraduationModule } from './graduation/graduation.module';
import { GroupsModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { RhythmsModule } from './rhythms/rhythms.module';
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
    InstrumentsModule,
    RhythmsModule,
    GroupsModule,
    EventsModule,
    GraduationModule,
    CareerTimelineModule,
    DiscoveryModule,
    HealthModule,
    HomeModule,
    AnnouncementsModule,
  ],
})
export class AppModule {}
