import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

// Imports EventsModule (for EventsService.listForViewer) and
// SongLibraryModule (for LearningStatusService.listLearningSongs) purely
// to reuse their already-authorized read paths - HomeModule owns no entity
// and no business rule of its own (see HomeService's top comment).
@Module({
  imports: [EventsModule, SongLibraryModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
