import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../app.module';
import { Instrument } from '../../instruments/entities/instrument.entity';
import { Rhythm } from '../../rhythms/entities/rhythm.entity';
import {
  INSTRUMENT_SEED_ROWS,
  MusicContentSeedRow,
  RHYTHM_SEED_ROWS,
} from './music-content.seed-data';

export interface SeedMusicContentResult {
  instrumentsCreated: number;
  rhythmsCreated: number;
}

// Idempotent by slug: a row that already exists - whether created by a prior
// run of this script or since edited by an admin - is left completely
// untouched. Re-running this script must never overwrite admin-authored
// content, so this only ever inserts rows for slugs that are still missing.
export async function seedMusicContent(
  em: EntityManager,
): Promise<SeedMusicContentResult> {
  const toPersist: object[] = [];
  let instrumentsCreated = 0;
  let rhythmsCreated = 0;

  for (const row of INSTRUMENT_SEED_ROWS) {
    if ((await em.count(Instrument, { slug: row.slug })) > 0) {
      continue;
    }
    toPersist.push(buildInstrument(row));
    instrumentsCreated += 1;
  }

  for (const row of RHYTHM_SEED_ROWS) {
    if ((await em.count(Rhythm, { slug: row.slug })) > 0) {
      continue;
    }
    toPersist.push(buildRhythm(row));
    rhythmsCreated += 1;
  }

  if (toPersist.length > 0) {
    await em.persist(toPersist).flush();
  }

  return { instrumentsCreated, rhythmsCreated };
}

function buildInstrument(row: MusicContentSeedRow): Instrument {
  const instrument = new Instrument();
  instrument.name = row.name;
  instrument.slug = row.slug;
  instrument.displayOrder = row.displayOrder;
  return instrument;
}

function buildRhythm(row: MusicContentSeedRow): Rhythm {
  const rhythm = new Rhythm();
  rhythm.name = row.name;
  rhythm.slug = row.slug;
  rhythm.displayOrder = row.displayOrder;
  return rhythm;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const em = app.get(EntityManager).fork();
    const result = await seedMusicContent(em);
    Logger.log(
      `Seeded ${result.instrumentsCreated} instrument(s) and ${result.rhythmsCreated} rhythm(s); existing rows were left untouched`,
      'SeedMusicContent',
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void bootstrap();
}
