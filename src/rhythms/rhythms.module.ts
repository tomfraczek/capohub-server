import { Module } from '@nestjs/common';
import { PermissionsModule } from '../auth/permissions/permissions.module';
import { AdminRhythmsController } from './admin-rhythms.controller';
import { RhythmsController } from './rhythms.controller';
import { RhythmsService } from './rhythms.service';

// Every entity here (Rhythm, RhythmMedia, InstrumentRhythm, SongRhythm) is
// driven through the plain EntityManager, so no forFeature() is needed.
// No dependency on InstrumentsModule or SongsModule at the Nest level -
// every cross-domain lookup RhythmsService needs (visible songs for a
// rhythm, instruments for a rhythm) is a plain function
// (instrument-rhythm-links.query.ts / rhythm-song-links.query.ts), not an
// injected service - see the Etap report for why this avoids a DI cycle
// with SongsModule (which imports this module to extend SongDetails).
@Module({
  imports: [PermissionsModule],
  controllers: [RhythmsController, AdminRhythmsController],
  providers: [RhythmsService],
})
export class RhythmsModule {}
