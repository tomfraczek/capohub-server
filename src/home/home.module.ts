import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { EventsModule } from '../events/events.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { TrainingsModule } from '../trainings/trainings.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

// Imports EventsModule (for EventsService.findNearestEvent),
// TrainingsModule (for TrainingsService.findNearestForViewer),
// SongLibraryModule (for LearningStatusService.listLearningSongs), and
// AnnouncementsModule (for AnnouncementsService.listForViewer) purely to
// reuse their already-authorized read paths - HomeModule owns no entity
// and no business rule of its own (see HomeService's top comment).
@Module({
  imports: [
    EventsModule,
    TrainingsModule,
    SongLibraryModule,
    AnnouncementsModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
