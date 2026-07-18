import { Module } from '@nestjs/common';
import { PermissionsModule } from '../auth/permissions/permissions.module';
import { AdminInstrumentsController } from './admin-instruments.controller';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

// Every entity (Instrument, InstrumentMedia) is driven through the plain
// EntityManager (auto-discovered globally), so no forFeature() is needed.
// PermissionsModule is imported for PermissionsGuard, used by the admin
// controller. No dependency on RhythmsModule at the Nest level - the
// Instrument<->Rhythm query helpers it uses are plain functions (see
// rhythms/instrument-rhythm-links.query.ts), not injected services.
@Module({
  imports: [PermissionsModule],
  controllers: [InstrumentsController, AdminInstrumentsController],
  providers: [InstrumentsService],
})
export class InstrumentsModule {}
