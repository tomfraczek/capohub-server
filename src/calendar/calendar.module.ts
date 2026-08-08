import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { TrainingsModule } from '../trainings/trainings.module';
import { CalendarCommunityController } from './calendar-community.controller';
import { CalendarUserController } from './calendar-user.controller';
import { CalendarService } from './calendar.service';

// Read-only aggregator over Event/Training - no own entity, no own access
// rules (module spec §16/§18). Imports EventsModule/TrainingsModule for
// their already-exported EventsService/TrainingsService, and GroupsModule
// directly for GroupHierarchyService (resolving a calendar id to a
// Group/Section - see calendar.service.ts). Never imported back by either
// Events, Trainings, or Home - Home keeps its own separate
// nearestEvent/nearestTraining queries untouched (module spec §21).
@Module({
  imports: [EventsModule, TrainingsModule, GroupsModule],
  controllers: [CalendarUserController, CalendarCommunityController],
  providers: [CalendarService],
})
export class CalendarModule {}
