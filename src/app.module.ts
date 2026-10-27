import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
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
import { NotificationsModule } from './notifications/notifications.module';
import { MetronomeSequencesModule } from './metronome-sequences/metronome-sequences.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { RhythmsModule } from './rhythms/rhythms.module';
import { SongLibraryModule } from './song-library/song-library.module';
import { SongsModule } from './songs/songs.module';
import { TrainingsModule } from './trainings/trainings.module';
import { UsersModule } from './users/users.module';

// Powers NotificationReminderScheduler's single periodic job (module spec
// section 26/27) - the only @Cron in this codebase. Deliberately NOT
// imported under NODE_ENV=test (which Jest sets by default whenever it
// isn't already set to something else - true for both `npm test` and
// `npm run test:e2e` in this repo): every e2e spec file boots a full,
// independent AppModule instance via `Test.createTestingModule({ imports:
// [AppModule] })`, so a live 5-minute CronJob ticking mid-suite is both
// pointless (no e2e spec exercises reminder delivery - see
// NotificationReminderScheduler's own spec for that instead) and a source
// of avoidable noise/risk: up to 45 sequential app boots in one process
// means many independent CronJob timers can be alive at once, each one a
// tick that touches the database mid-suite for no reason any test needs.
// This is the single central switch - no per-cron `if (NODE_ENV ===
// 'test')` scattered anywhere else. A test that genuinely wants to
// exercise the scheduler still can: it is a plain, directly-constructible
// `@Injectable()` (see NotificationReminderScheduler.spec.ts, which calls
// `.run()` directly - @Cron's own metadata is irrelevant to a direct call).
const schedulerImports =
  process.env.NODE_ENV === 'test' ? [] : [ScheduleModule.forRoot()];

@Module({
  imports: [
    ConfigModule,
    ...schedulerImports,
    DatabaseModule,
    AuthModule,
    UsersModule,
    SongsModule,
    SongLibraryModule,
    PlaylistsModule,
    MetronomeSequencesModule,
    InstrumentsModule,
    RhythmsModule,
    GroupsModule,
    EventsModule,
    TrainingsModule,
    CalendarModule,
    GraduationModule,
    CareerTimelineModule,
    DiscoveryModule,
    HealthModule,
    HomeModule,
    AnnouncementsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
