import type { EntityManager } from '@mikro-orm/postgresql';
import { InstrumentRhythmRefDto } from '../instruments/dto/instrument-rhythm-ref.dto';
import { InstrumentRhythm } from './entities/instrument-rhythm.entity';
import { RhythmInstrumentRefDto } from './dto/rhythm-instrument-ref.dto';

/**
 * Both directions of the Instrument<->Rhythm many-to-many live here, next
 * to the InstrumentRhythm entity, so InstrumentsService and RhythmsService
 * can each import the one function they need as a plain function call -
 * neither module needs to import the other's NestJS module (spec section
 * 5/6: no DI cycles between instruments and rhythms).
 */
export async function loadRhythmsForInstrument(
  em: EntityManager,
  instrumentId: string,
  options: { includeInactiveRhythms: boolean },
): Promise<InstrumentRhythmRefDto[]> {
  const rows = await em.find(
    InstrumentRhythm,
    {
      instrument: instrumentId,
      ...(options.includeInactiveRhythms ? {} : { rhythm: { isActive: true } }),
    },
    { populate: ['rhythm'], orderBy: { displayOrder: 'ASC' } },
  );

  return rows.map((row) => ({
    id: row.rhythm.id,
    slug: row.rhythm.slug,
    name: row.rhythm.name,
    shortDescription: row.rhythm.shortDescription,
    roleDescription: row.roleDescription,
    displayOrder: row.displayOrder,
  }));
}

export async function loadInstrumentsForRhythm(
  em: EntityManager,
  rhythmId: string,
  options: { includeInactiveInstruments: boolean },
): Promise<RhythmInstrumentRefDto[]> {
  const rows = await em.find(
    InstrumentRhythm,
    {
      rhythm: rhythmId,
      ...(options.includeInactiveInstruments
        ? {}
        : { instrument: { isActive: true } }),
    },
    { populate: ['instrument'], orderBy: { displayOrder: 'ASC' } },
  );

  return rows.map((row) => ({
    id: row.instrument.id,
    slug: row.instrument.slug,
    name: row.instrument.name,
    shortDescription: row.instrument.shortDescription,
    roleDescription: row.roleDescription,
    displayOrder: row.displayOrder,
  }));
}
