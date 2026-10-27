import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { MetronomeSequencesController } from './metronome-sequences.controller';
import { MetronomeSequencesService } from './metronome-sequences.service';
import { SectionMetronomeSequencesController } from './section-metronome-sequences.controller';

// Entities are driven through the plain EntityManager. Imports GroupsModule
// to reuse its Section-level authorization machinery (RoleAssignmentsService,
// GroupPermissionService, GroupPermissionsGuard) for sharing in Sections -
// never the reverse (same rule as TrainingsModule).
@Module({
  imports: [GroupsModule],
  controllers: [
    MetronomeSequencesController,
    SectionMetronomeSequencesController,
  ],
  providers: [MetronomeSequencesService],
})
export class MetronomeSequencesModule {}
