import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import {
  importSongs,
  loadSongImportFiles,
  SongImportReferenceError,
  SongImportStatus,
  verifyImportedSongs,
} from '../src/database/seeds/songs/song-import';
import {
  SongImportEntry,
  SongImportFileContent,
  validateSongImportDataset,
} from '../src/database/seeds/songs/song-import.schema';
import { Rhythm } from '../src/rhythms/entities/rhythm.entity';
import { SongRhythm } from '../src/rhythms/entities/song-rhythm.entity';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { SongSummaryResponseDto } from '../src/songs/dto/song-summary-response.dto';
import { SongLineTranslation } from '../src/songs/entities/song-line-translation.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { SongPart } from '../src/songs/entities/song-part.entity';
import { Song } from '../src/songs/entities/song.entity';
import { Tag } from '../src/songs/entities/tag.entity';
import { SongPerformer } from '../src/songs/enums/song-performer.enum';
import { SongStatus } from '../src/songs/enums/song-status.enum';
import { SongContentService } from '../src/songs/song-content.service';
import { User } from '../src/users/entities/user.entity';
import { closeE2eApp } from './close-e2e-app.helper';

// Runs against the same database as every other e2e spec. The real
// catalogue songs imported from songs/ may already be there, so every
// record imported here gets a unique MARKER appended to its title and
// alternative titles: it can never collide with (or be mistaken for) a
// real catalogue song, and cleanup deletes only rows carrying MARKER.
const MARKER = `[e2e-import ${randomUUID().slice(0, 8)}]`;
const SONGS_DIRECTORY = join(__dirname, '../songs');

const TOKEN = 'valid-song-import-token';
const CLERK_ID = 'user_test_song_import';
const AUTH: AuthContext = {
  userId: CLERK_ID,
  sessionId: 'sess_song_import',
  tokenType: 'session_token',
  claims: { sub: CLERK_ID, sid: 'sess_song_import' },
};

type RawSong = Record<string, unknown> & {
  title: string;
  alternativeTitles: { title: string; position: number }[];
};

function markedFiles(
  mutate: (songs: RawSong[]) => void = () => undefined,
): SongImportFileContent[] {
  const files = loadSongImportFiles(SONGS_DIRECTORY);
  for (const file of files) {
    const songs = (file.data as { songs: RawSong[] }).songs;
    for (const song of songs) {
      song.title = `${song.title} ${MARKER}`;
      song.alternativeTitles = song.alternativeTitles.map((alt) => ({
        ...alt,
        title: `${alt.title} ${MARKER}`,
      }));
    }
  }
  const allSongs = files.flatMap(
    (file) => (file.data as { songs: RawSong[] }).songs,
  );
  mutate(allSongs);
  return files;
}

function validEntries(files: SongImportFileContent[]): SongImportEntry[] {
  const { entries, errors } = validateSongImportDataset(files);
  expect(errors).toEqual([]);
  return entries;
}

describe('Song catalogue import (e2e)', () => {
  let app: INestApplication<App>;
  let contentService: SongContentService;
  let tag: Tag;
  let rhythm: Rhythm;

  const em = () => app.get(EntityManager).fork();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue({
        verifySessionToken: (token: string) =>
          token === TOKEN
            ? Promise.resolve(AUTH)
            : Promise.reject(
                new UnauthorizedException('Authentication required'),
              ),
      })
      .overrideProvider(CLERK_CLIENT)
      .useValue({
        users: {
          getUser: (id: string) =>
            Promise.resolve({
              id,
              imageUrl: 'https://img.clerk.com/song-import.png',
              primaryEmailAddress: { emailAddress: 'song.import@example.com' },
            }),
          deleteUser: () => Promise.resolve(),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    contentService = app.get(SongContentService);

    const suffix = randomUUID().slice(0, 8);
    tag = new Tag();
    tag.name = `E2E import ${suffix}`;
    tag.slug = `e2e-import-${suffix}`;
    rhythm = new Rhythm();
    rhythm.name = `E2E import rhythm ${suffix}`;
    rhythm.slug = `e2e-import-rhythm-${suffix}`;
    rhythm.displayOrder = 999;
    await em().persist([tag, rhythm]).flush();
  });

  afterEach(async () => {
    await em().nativeDelete(Song, { title: { $like: `%${MARKER}%` } });
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = em();
      await cleanup.nativeDelete(Song, { title: { $like: `%${MARKER}%` } });
      await cleanup.nativeDelete(Tag, { id: tag.id });
      await cleanup.nativeDelete(Rhythm, { id: rhythm.id });
      await cleanup.nativeDelete(User, { clerkUserId: CLERK_ID });
    });
  });

  async function countMarkedSongs(): Promise<number> {
    return em().count(Song, { title: { $like: `%${MARKER}%` } });
  }

  async function countMarkedRows(): Promise<Record<string, number>> {
    const [row] = await em()
      .getConnection()
      .execute<Record<string, string>[]>(
        `select
           (select count(*) from songs s where s.title like ?) as "songs",
           (select count(*) from song_parts sp join songs s on s.id = sp.song_id where s.title like ?) as "parts",
           (select count(*) from song_lines sl join song_parts sp on sp.id = sl.part_id join songs s on s.id = sp.song_id where s.title like ?) as "lines",
           (select count(*) from song_line_translations t join song_lines sl on sl.id = t.line_id join song_parts sp on sp.id = sl.part_id join songs s on s.id = sp.song_id where s.title like ?) as "translations",
           (select count(*) from song_media sm join songs s on s.id = sm.song_id where s.title like ?) as "media",
           (select count(*) from song_alternative_titles a join songs s on s.id = a.song_id where s.title like ?) as "alternativeTitles"`,
        Array(6).fill(`%${MARKER}%`),
      );
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value)]),
    );
  }

  async function getJson<T>(
    path: string,
    query: Record<string, string | number> = {},
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .query(query)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    return res.body as T;
  }

  it('imports a single song with every relation (category, tag, rhythm, media, translations)', async () => {
    const entries = validEntries(
      markedFiles((songs) => {
        songs[0].tagSlugs = [tag.slug];
        songs[0].rhythms = [
          { slug: rhythm.slug, isPrimary: true, description: 'Rytm testowy' },
        ];
      }),
    ).slice(0, 1);
    const [record] = entries.map((entry) => entry.record);

    const [result] = await importSongs(em(), contentService, entries);

    expect(result.status).toBe(SongImportStatus.CREATED);
    const song = await em().findOneOrFail(
      Song,
      { id: result.songId! },
      {
        populate: [
          'category',
          'alternativeTitles',
          'tags.tag',
          'parts.lines.translations',
          'media',
        ],
      },
    );
    expect(song.status).toBe(SongStatus.PUBLISHED);
    expect(song.createdBy).toBeNull();
    expect(song.title).toBe(record.title);
    expect(song.authorName).toBeNull();
    expect(song.category.code).toBe('CORRIDO');
    expect(song.meaningHistory).toBe(record.meaningHistory);
    expect(song.meaningContext).toBe(record.meaningContext);
    expect(song.meaningTrivia).toBe(record.meaningTrivia);
    expect(song.alternativeTitles.getItems().map((a) => a.title)).toEqual(
      record.alternativeTitles.map((a) => a.title),
    );
    expect(song.tags.getItems().map((t) => t.tag.slug)).toEqual([tag.slug]);
    expect(
      song.media
        .getItems()
        .map((m) => [m.provider, m.url, m.title, m.position]),
    ).toEqual(
      record.media.map((m) => [m.provider, m.url, m.title, m.position]),
    );
    expect(song.media.getItems().every((m) => m.createdBy === null)).toBe(true);

    // Order and the LEAD/CHORUS split, line by line, with the Polish text
    // attached to the exact line it translates.
    expect(
      song.parts
        .getItems()
        .map((part) => [
          part.position,
          part.performer,
          part.lines
            .getItems()
            .map((line) => [
              line.position,
              line.originalText,
              line.translations.getItems().map((t) => [t.languageCode, t.text]),
            ]),
        ]),
    ).toEqual(
      record.parts.map((part) => [
        part.position,
        part.performer,
        part.lines.map((line) => [
          line.position,
          line.originalText,
          line.translations.map((t) => [t.languageCode, t.text]),
        ]),
      ]),
    );

    const links = await em().find(
      SongRhythm,
      { song: song.id },
      { populate: ['rhythm'] },
    );
    expect(
      links.map((l) => [l.rhythm.slug, l.isPrimary, l.description]),
    ).toEqual([[rhythm.slug, true, 'Rytm testowy']]);

    const verification = await verifyImportedSongs(em(), entries);
    expect(verification.songs[0].problems).toEqual([]);
  });

  it('imports all 50 songs, matching the source files row for row', async () => {
    const entries = validEntries(markedFiles());
    expect(entries).toHaveLength(50);

    const results = await importSongs(em(), contentService, entries);

    expect(results.map((r) => r.status)).toEqual(
      Array(50).fill(SongImportStatus.CREATED),
    );
    expect(await countMarkedRows()).toEqual({
      songs: 50,
      parts: 719,
      lines: 1467,
      translations: 1467,
      media: 69,
      alternativeTitles: 110,
    });

    const verification = await verifyImportedSongs(em(), entries);
    expect(
      verification.songs.filter((song) => song.problems.length > 0),
    ).toEqual([]);
    expect(verification.integrityProblems).toEqual([]);
    expect(verification.ok).toBe(true);
  });

  it('is idempotent - a second run creates nothing and changes nothing', async () => {
    const entries = validEntries(markedFiles());
    await importSongs(em(), contentService, entries);
    const before = await countMarkedRows();

    const rerun = await importSongs(em(), contentService, entries);

    expect(rerun.map((r) => r.status)).toEqual(
      Array(50).fill(SongImportStatus.UNCHANGED),
    );
    expect(await countMarkedRows()).toEqual(before);
  });

  it('dry run reports what would be created without writing anything', async () => {
    const entries = validEntries(markedFiles()).slice(0, 3);
    const results = await importSongs(em(), contentService, entries, {
      dryRun: true,
    });
    expect(results.map((r) => r.status)).toEqual(
      Array(3).fill(SongImportStatus.WOULD_CREATE),
    );
    expect(await countMarkedSongs()).toBe(0);
  });

  it('never overwrites a song edited after the import', async () => {
    const entries = validEntries(markedFiles()).slice(0, 1);
    const [created] = await importSongs(em(), contentService, entries);

    const fork = em();
    const translation = await fork.findOneOrFail(SongLineTranslation, {
      line: { part: { song: created.songId!, position: 1 }, position: 1 },
    });
    translation.text = 'Poprawione przez moderatora';
    await fork.flush();

    const [rerun] = await importSongs(em(), contentService, entries);

    expect(rerun.status).toBe(SongImportStatus.SKIPPED_MODIFIED);
    expect(rerun.songId).toBe(created.songId);
    expect(rerun.differences.join('\n')).toContain(
      'parts[0].lines[0].translations[0].text',
    );
    const after = await em().findOneOrFail(SongLineTranslation, {
      id: translation.id,
    });
    expect(after.text).toBe('Poprawione przez moderatora');
    expect(await countMarkedSongs()).toBe(1);
  });

  it('does not import over a different song that shares the title', async () => {
    const entries = validEntries(markedFiles()).slice(0, 1);
    const { record } = entries[0];

    const fork = em();
    const category = await fork.findOneOrFail(SongCategory, {
      code: record.categoryCode,
    });
    const otherSong = new Song();
    otherSong.status = SongStatus.PUBLISHED;
    await fork.transactional((tem) =>
      contentService.replaceContent(
        tem,
        otherSong,
        {
          title: record.title,
          authorName: null,
          categoryId: category.id,
          tagIds: [],
          alternativeTitles: [],
          media: [],
          meaningHistory: null,
          meaningContext: null,
          meaningTrivia: null,
          parts: [
            {
              performer: SongPerformer.LEAD,
              position: 1,
              lines: [
                {
                  originalText: 'Uma letra completamente diferente',
                  position: 1,
                  phonetics: [],
                  translations: [],
                },
              ],
            },
          ],
        },
        null,
      ),
    );

    const [result] = await importSongs(em(), contentService, entries);

    expect(result.status).toBe(SongImportStatus.SKIPPED_TITLE_COLLISION);
    expect(result.detail).toContain(otherSong.id);
    expect(await countMarkedSongs()).toBe(1);
  });

  it('rolls back a record that fails mid-write, leaving no partial rows', async () => {
    const entries = validEntries(markedFiles()).slice(0, 2);
    const failingContentService = {
      replaceContent: async (
        ...args: Parameters<SongContentService['replaceContent']>
      ) => {
        await contentService.replaceContent(...args);
        if (args[2].title === entries[0].record.title) {
          throw new Error('simulated failure after the content was flushed');
        }
      },
    } as unknown as SongContentService;
    const partsBefore = await em().count(SongPart, {});

    const results = await importSongs(em(), failingContentService, entries);

    expect(results.map((r) => r.status)).toEqual([
      SongImportStatus.FAILED,
      SongImportStatus.CREATED,
    ]);
    expect(results[0].detail).toContain('simulated failure');
    expect(await em().count(Song, { title: entries[0].record.title })).toBe(0);
    expect(await em().count(SongPart, {})).toBe(
      partsBefore + entries[1].record.parts.length,
    );
    const verification = await verifyImportedSongs(em(), entries);
    expect(verification.integrityProblems).toEqual([]);
  });

  it('refuses to write anything when a referenced category does not exist', async () => {
    const entries = validEntries(
      markedFiles((songs) => {
        songs[5].categoryCode = 'NOT_A_CATEGORY';
      }),
    );

    await expect(importSongs(em(), contentService, entries)).rejects.toThrow(
      SongImportReferenceError,
    );
    expect(await countMarkedSongs()).toBe(0);
  });

  it('stores optional null values as null', async () => {
    const entries = validEntries(
      markedFiles((songs) => {
        Object.assign(songs[0], {
          authorName: '',
          meaningHistory: null,
          meaningContext: '   ',
          tagSlugs: [],
          rhythms: [],
        });
        delete songs[0].meaningTrivia;
      }),
    ).slice(0, 1);

    const [result] = await importSongs(em(), contentService, entries);

    const song = await em().findOneOrFail(Song, { id: result.songId! });
    expect(song.authorName).toBeNull();
    expect(song.meaningHistory).toBeNull();
    expect(song.meaningContext).toBeNull();
    expect(song.meaningTrivia).toBeNull();
    const verification = await verifyImportedSongs(em(), entries);
    expect(verification.songs[0].problems).toEqual([]);
  });

  describe('through the public API', () => {
    let entries: SongImportEntry[];

    beforeEach(async () => {
      entries = validEntries(markedFiles());
      await importSongs(em(), contentService, entries);
    });

    it('lists all imported songs across pages without duplicates', async () => {
      const ids: string[] = [];
      for (const page of [1, 2, 3]) {
        const body = await getJson<PaginatedResponse<SongSummaryResponseDto>>(
          '/songs',
          { search: MARKER, page, limit: 20, sort: 'title' },
        );
        expect(body.meta.totalItems).toBe(50);
        expect(body.meta.totalPages).toBe(3);
        expect(body.meta.hasNextPage).toBe(page < 3);
        ids.push(...body.data.map((song) => song.id));
      }
      expect(ids).toHaveLength(50);
      expect(new Set(ids).size).toBe(50);
    });

    it('finds songs by title, alternative title, author and lyric line', async () => {
      const search = async (term: string) =>
        (
          await getJson<PaginatedResponse<SongSummaryResponseDto>>('/songs', {
            search: term,
            limit: 100,
          })
        ).data.map((song) => song.title);

      const paranaue = entries[0].record;
      expect(await search(paranaue.title)).toContain(paranaue.title);
      expect(await search(paranaue.alternativeTitles[1].title)).toContain(
        paranaue.title,
      );
      expect(await search('capoeira me venceu')).toContain(paranaue.title);
      const barrao = await search('Mestre Barrão');
      expect(barrao.filter((title) => title.includes(MARKER))).toHaveLength(5);
    });

    it('returns complete details in source order for every imported song', async () => {
      const list = await getJson<PaginatedResponse<SongSummaryResponseDto>>(
        '/songs',
        { search: MARKER, limit: 100 },
      );
      const idByTitle = new Map(list.data.map((song) => [song.title, song.id]));

      for (const { record } of entries) {
        const details = await getJson<SongDetailsResponseDto>(
          `/songs/${idByTitle.get(record.title)}`,
        );
        expect(details).toMatchObject({
          title: record.title,
          authorName: record.authorName,
          status: SongStatus.PUBLISHED,
          category: { code: record.categoryCode },
          meaningHistory: record.meaningHistory,
          meaningContext: record.meaningContext,
          meaningTrivia: record.meaningTrivia,
          createdBy: null,
          tags: [],
          rhythms: [],
        });
        expect(
          details.alternativeTitles.map((a) => [a.title, a.position]),
        ).toEqual(record.alternativeTitles.map((a) => [a.title, a.position]));
        expect(
          details.media.map((m) => [m.provider, m.url, m.title, m.position]),
        ).toEqual(
          record.media.map((m) => [m.provider, m.url, m.title, m.position]),
        );
        expect(
          details.parts.map((part) => [
            part.position,
            part.performer,
            part.lines.map((line) => [
              line.position,
              line.originalText,
              line.translations.map((t) => [t.languageCode, t.text]),
            ]),
          ]),
        ).toEqual(
          record.parts.map((part) => [
            part.position,
            part.performer,
            part.lines.map((line) => [
              line.position,
              line.originalText,
              line.translations.map((t) => [t.languageCode, t.text]),
            ]),
          ]),
        );
      }
    });
  });
});
