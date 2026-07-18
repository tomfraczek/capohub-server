import type { EntityManager } from '@mikro-orm/postgresql';
import { Instrument } from '../../instruments/entities/instrument.entity';
import { Rhythm } from '../../rhythms/entities/rhythm.entity';
import {
  INSTRUMENT_SEED_ROWS,
  RHYTHM_SEED_ROWS,
} from './music-content.seed-data';
import { seedMusicContent } from './seed-music-content';

interface MockRouting {
  existingInstrumentSlugs?: string[];
  existingRhythmSlugs?: string[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });
  const existingInstrumentSlugs = new Set(
    routing.existingInstrumentSlugs ?? [],
  );
  const existingRhythmSlugs = new Set(routing.existingRhythmSlugs ?? []);

  const count = jest
    .fn()
    .mockImplementation((entity: unknown, filter: { slug: string }) => {
      if (entity === Instrument) {
        return Promise.resolve(
          existingInstrumentSlugs.has(filter.slug) ? 1 : 0,
        );
      }
      return Promise.resolve(existingRhythmSlugs.has(filter.slug) ? 1 : 0);
    });

  const raw = { count, persist };
  return { em: raw as unknown as EntityManager, persist, flush };
}

describe('seedMusicContent', () => {
  it('creates every instrument and rhythm row when none exist yet', async () => {
    const { em, persist } = buildMockEm();

    const result = await seedMusicContent(em);

    expect(result).toEqual({
      instrumentsCreated: INSTRUMENT_SEED_ROWS.length,
      rhythmsCreated: RHYTHM_SEED_ROWS.length,
    });
    const persisted = persist.mock.calls[0][0];
    expect(persisted).toHaveLength(
      INSTRUMENT_SEED_ROWS.length + RHYTHM_SEED_ROWS.length,
    );
    expect(persisted.filter((e) => e instanceof Instrument)).toHaveLength(
      INSTRUMENT_SEED_ROWS.length,
    );
    expect(persisted.filter((e) => e instanceof Rhythm)).toHaveLength(
      RHYTHM_SEED_ROWS.length,
    );

    const berimbauGunga = persisted.find(
      (e): e is Instrument =>
        e instanceof Instrument && e.slug === 'berimbau-gunga',
    );
    expect(berimbauGunga).toMatchObject({
      name: 'Berimbau Gunga',
      slug: 'berimbau-gunga',
      displayOrder: 1,
    });
  });

  it('skips rows whose slug already exists and does not touch them', async () => {
    const { em, persist } = buildMockEm({
      existingInstrumentSlugs: ['berimbau-gunga'],
      existingRhythmSlugs: ['angola'],
    });

    const result = await seedMusicContent(em);

    expect(result).toEqual({
      instrumentsCreated: INSTRUMENT_SEED_ROWS.length - 1,
      rhythmsCreated: RHYTHM_SEED_ROWS.length - 1,
    });
    const persisted = persist.mock.calls[0][0];
    expect(
      persisted.some(
        (e) => e instanceof Instrument && e.slug === 'berimbau-gunga',
      ),
    ).toBe(false);
    expect(
      persisted.some((e) => e instanceof Rhythm && e.slug === 'angola'),
    ).toBe(false);
  });

  it('does not call persist when every row already exists', async () => {
    const { em, persist } = buildMockEm({
      existingInstrumentSlugs: INSTRUMENT_SEED_ROWS.map((row) => row.slug),
      existingRhythmSlugs: RHYTHM_SEED_ROWS.map((row) => row.slug),
    });

    const result = await seedMusicContent(em);

    expect(result).toEqual({ instrumentsCreated: 0, rhythmsCreated: 0 });
    expect(persist).not.toHaveBeenCalled();
  });
});
