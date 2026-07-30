import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { EventsModule } from '../events/events.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

// Imports EventsModule (for EventsService.listForViewer),
// SongLibraryModule (for LearningStatusService.listLearningSongs), and
// AnnouncementsModule (for AnnouncementsService.listForViewer) purely to
// reuse their already-authorized read paths - HomeModule owns no entity
// and no business rule of its own (see HomeService's top comment).
@Module({
  imports: [EventsModule, SongLibraryModule, AnnouncementsModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
