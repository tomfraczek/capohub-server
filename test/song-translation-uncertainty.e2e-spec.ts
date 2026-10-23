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
import { GlobalRole } from '../src/auth/permissions/global-role.enum';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import {
  importSongs,
  loadSongImportFiles,
  verifyImportedSongs,
} from '../src/database/seeds/songs/song-import';
import {
  SongImportEntry,
  validateSongImportDataset,
} from '../src/database/seeds/songs/song-import.schema';
import {
  SongTranslationSyncStatus,
  syncSongTranslations,
} from '../src/database/seeds/songs/song-translation-sync';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { SongEditProposalResponseDto } from '../src/songs/dto/song-edit-proposal-response.dto';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { SongEditProposal } from '../src/songs/entities/song-edit-proposal.entity';
import { SongLine } from '../src/songs/entities/song-line.entity';
import { SongLineTranslation } from '../src/songs/entities/song-line-translation.entity';
import { Song } from '../src/songs/entities/song.entity';
import { SongEditProposalStatus } from '../src/songs/enums/song-edit-proposal-status.enum';
import { SongContentService } from '../src/songs/song-content.service';
import { User } from '../src/users/entities/user.entity';
import { closeE2eApp } from './close-e2e-app.helper';

// Same database as every other e2e spec - every song created here carries
// MARKER in its title, and cleanup deletes only those.
const MARKER = `[e2e-uncertain ${randomUUID().slice(0, 8)}]`;

const AUTHOR_TOKEN = 'valid-uncertain-author-token';
const MODERATOR_TOKEN = 'valid-uncertain-moderator-token';
const CLERK_IDS: Record<string, string> = {
  [AUTHOR_TOKEN]: 'user_test_uncertain_author',
  [MODERATOR_TOKEN]: 'user_test_uncertain_moderator',
};

function authFor(token: string): AuthContext {
  const userId = CLERK_IDS[token];
  return {
    userId,
    sessionId: `sess_${userId}`,
    tokenType: 'session_token',
    claims: { sub: userId, sid: `sess_${userId}` },
  };
}

interface TranslationInput {
  languageCode: string;
  text: string;
  isUncertain?: boolean;
}

function songPayload(
  categoryId: string,
  translations: TranslationInput[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: `Assim dera ${randomUUID().slice(0, 8)} ${MARKER}`,
    authorName: null,
    categoryId,
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: `Assim dera que o morro ${randomUUID().slice(0, 8)}`,
            position: 1,
            phonetics: [],
            translations,
          },
          {
            originalText: 'Se mudou para a cidade',
            position: 2,
            phonetics: [],
            translations: [
              { languageCode: 'pl', text: 'Przeniosło się do miasta' },
            ],
          },
        ],
      },
    ],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    ...overrides,
  };
}

const flagsOf = (song: { parts: SongDetailsResponseDto['parts'] }) =>
  song.parts.flatMap((part) =>
    part.lines.flatMap((line) =>
      line.translations.map((t) => [t.languageCode, t.text, t.isUncertain]),
    ),
  );

describe('Uncertain translations (e2e)', () => {
  let app: INestApplication<App>;
  let category: SongCategory;
  const em = () => app.get(EntityManager).fork();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue({
        verifySessionToken: (token: string) =>
          CLERK_IDS[token]
            ? Promise.resolve(authFor(token))
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
              imageUrl: 'https://img.clerk.com/uncertain.png',
              primaryEmailAddress: { emailAddress: `${id}@example.com` },
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

    category = new SongCategory();
    category.code = `TEST_UNCERTAIN_${randomUUID().slice(0, 8)}`;
    category.name = 'Uncertain translations test';
    category.position = 997;
    await em().persist(category).flush();

    await grantGlobalRole(AUTHOR_TOKEN, GlobalRole.EDITOR);
    await grantGlobalRole(MODERATOR_TOKEN, GlobalRole.MODERATOR);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = em();
      await cleanup.nativeDelete(Song, { title: { $like: `%${MARKER}%` } });
      await cleanup.nativeDelete(SongCategory, { id: category.id });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.values(CLERK_IDS) },
      });
    });
  });

  async function grantGlobalRole(token: string, role: GlobalRole) {
    await request(app.getHttpServer())
      .get('/api/v1/songs')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fork = em();
    const user = await fork.findOneOrFail(User, {
      clerkUserId: CLERK_IDS[token],
    });
    user.globalRole = role;
    await fork.flush();
  }

  function api(method: 'get' | 'post' | 'patch', path: string, token: string) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function createSong(
    translations: TranslationInput[],
  ): Promise<SongDetailsResponseDto> {
    const res = await api('post', '/songs', AUTHOR_TOKEN)
      .send(songPayload(category.id, translations))
      .expect(201);
    return res.body as SongDetailsResponseDto;
  }

  // The full replace-all body for PATCH/proposals, rebuilt from a details
  // response. `withFlags: false` imitates an older client that drops the
  // field it doesn't know about.
  function bodyFrom(
    song: SongDetailsResponseDto,
    withFlags: boolean,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      title: song.title,
      authorName: song.authorName,
      categoryId: song.category.id,
      alternativeTitles: [],
      tagIds: [],
      parts: song.parts.map((part) => ({
        performer: part.performer,
        position: part.position,
        lines: part.lines.map((line) => ({
          originalText: line.originalText,
          position: line.position,
          phonetics: [],
          translations: line.translations.map((t) =>
            withFlags
              ? {
                  languageCode: t.languageCode,
                  text: t.text,
                  isUncertain: t.isUncertain,
                }
              : { languageCode: t.languageCode, text: t.text },
          ),
        })),
      })),
      media: [],
      meaningHistory: song.meaningHistory,
      meaningContext: song.meaningContext,
      meaningTrivia: song.meaningTrivia,
      ...overrides,
    };
  }

  async function publish(songId: string) {
    await api('post', `/songs/${songId}/submit`, AUTHOR_TOKEN).expect(201);
    await api('post', `/songs/${songId}/publish`, MODERATOR_TOKEN).expect(201);
  }

  async function publicDetails(
    songId: string,
  ): Promise<SongDetailsResponseDto> {
    const res = await api('get', `/songs/${songId}`, AUTHOR_TOKEN).expect(200);
    return res.body as SongDetailsResponseDto;
  }

  describe('API', () => {
    it('stores an explicit true, defaults a missing flag to false, per language', async () => {
      const song = await createSong([
        {
          languageCode: 'pl',
          text: 'I tak się stało, że wzgórze',
          isUncertain: true,
        },
        { languageCode: 'en', text: 'And so the hill' },
      ]);

      expect(flagsOf(song)).toEqual([
        ['pl', 'I tak się stało, że wzgórze', true],
        ['en', 'And so the hill', false],
        ['pl', 'Przeniosło się do miasta', false],
      ]);
      const row = await em().findOneOrFail(SongLineTranslation, {
        line: { part: { song: song.id }, position: 2 },
      });
      expect(row.isUncertain).toBe(false);
    });

    it('rejects a non-boolean isUncertain', async () => {
      await api('post', '/songs', AUTHOR_TOKEN)
        .send(
          songPayload(category.id, [
            { languageCode: 'pl', text: 'x', isUncertain: 'yes' as never },
          ]),
        )
        .expect(400);
    });

    it('keeps the flag when an older client edits an unrelated field', async () => {
      const song = await createSong([
        {
          languageCode: 'pl',
          text: 'I tak się stało, że wzgórze',
          isUncertain: true,
        },
      ]);

      const res = await api('patch', `/songs/${song.id}`, AUTHOR_TOKEN)
        .send(bodyFrom(song, false, { title: `${song.title} (edited)` }))
        .expect(200);

      expect(flagsOf(res.body as SongDetailsResponseDto)[0]).toEqual([
        'pl',
        'I tak się stało, że wzgórze',
        true,
      ]);
    });

    it('lets a new client clear and set the flag, and drops it when an older client retypes the text', async () => {
      const song = await createSong([
        {
          languageCode: 'pl',
          text: 'I tak się stało, że wzgórze',
          isUncertain: true,
        },
      ]);

      const explicitFalse = bodyFrom(song, true);
      (
        explicitFalse.parts as {
          lines: { translations: TranslationInput[] }[];
        }[]
      )[0].lines[0].translations[0].isUncertain = false;
      const afterFalse = (
        await api('patch', `/songs/${song.id}`, AUTHOR_TOKEN)
          .send(explicitFalse)
          .expect(200)
      ).body as SongDetailsResponseDto;
      expect(flagsOf(afterFalse)[0][2]).toBe(false);

      const flaggedAgain = bodyFrom(afterFalse, true);
      (
        flaggedAgain.parts as {
          lines: { translations: TranslationInput[] }[];
        }[]
      )[0].lines[0].translations[0].isUncertain = true;
      const reflagged = (
        await api('patch', `/songs/${song.id}`, AUTHOR_TOKEN)
          .send(flaggedAgain)
          .expect(200)
      ).body as SongDetailsResponseDto;
      expect(flagsOf(reflagged)[0][2]).toBe(true);

      const retyped = bodyFrom(reflagged, false);
      (
        retyped.parts as { lines: { translations: TranslationInput[] }[] }[]
      )[0].lines[0].translations[0].text = 'Zupełnie inny przekład';
      const afterRetype = (
        await api('patch', `/songs/${song.id}`, AUTHOR_TOKEN)
          .send(retyped)
          .expect(200)
      ).body as SongDetailsResponseDto;
      expect(flagsOf(afterRetype)[0]).toEqual([
        'pl',
        'Zupełnie inny przekład',
        false,
      ]);
    });

    it('applies a flag set in an edit proposal only once a moderator approves it', async () => {
      const song = await createSong([
        { languageCode: 'pl', text: 'I tak się stało, że wzgórze' },
      ]);
      await publish(song.id);
      const published = await publicDetails(song.id);

      const proposalBody = bodyFrom(published, true);
      (
        proposalBody.parts as {
          lines: { translations: TranslationInput[] }[];
        }[]
      )[0].lines[0].translations[0].isUncertain = true;
      const proposal = (
        await api('post', `/songs/${song.id}/edit-proposals`, AUTHOR_TOKEN)
          .send(proposalBody)
          .expect(201)
      ).body as SongEditProposalResponseDto;

      expect(
        proposal.payload.parts[0].lines[0].translations[0].isUncertain,
      ).toBe(true);
      expect(flagsOf(await publicDetails(song.id))[0][2]).toBe(false);

      await api(
        'post',
        `/songs/${song.id}/edit-proposals/${proposal.id}/approve`,
        MODERATOR_TOKEN,
      ).expect(201);

      expect(flagsOf(await publicDetails(song.id))[0][2]).toBe(true);
    });

    it('keeps the flag when approving a proposal from an older client', async () => {
      const song = await createSong([
        {
          languageCode: 'pl',
          text: 'I tak się stało, że wzgórze',
          isUncertain: true,
        },
      ]);
      await publish(song.id);
      const published = await publicDetails(song.id);

      const proposal = (
        await api('post', `/songs/${song.id}/edit-proposals`, AUTHOR_TOKEN)
          .send(
            bodyFrom(published, false, {
              meaningTrivia: 'Nowa ciekawostka',
            }),
          )
          .expect(201)
      ).body as SongEditProposalResponseDto;
      await api(
        'post',
        `/songs/${song.id}/edit-proposals/${proposal.id}/approve`,
        MODERATOR_TOKEN,
      ).expect(201);

      const approved = await publicDetails(song.id);
      expect(approved.meaningTrivia).toBe('Nowa ciekawostka');
      expect(flagsOf(approved)[0][2]).toBe(true);
    });
  });

  describe('translation sync', () => {
    // A marked copy of "Paranauê" - corrected version from songs/, plus an
    // "as previously imported" version with the old placeholder and no
    // flag (built in memory: the schema itself now rejects placeholders).
    function paranaueEntries(): {
      corrected: SongImportEntry[];
      previous: SongImportEntry[];
    } {
      const files = loadSongImportFiles(join(__dirname, '../songs'));
      const first = (files[0].data as { songs: Record<string, unknown>[] })
        .songs[0] as { title: string; alternativeTitles: { title: string }[] };
      first.title = `${first.title} ${MARKER} ${randomUUID().slice(0, 4)}`;
      first.alternativeTitles = [];
      files[0].data = { formatVersion: 1, songs: [first] };
      const { entries, errors } = validateSongImportDataset([files[0]]);
      expect(errors).toEqual([]);

      const previous = JSON.parse(JSON.stringify(entries)) as SongImportEntry[];
      const line = previous[0].record.parts[16].lines[0];
      line.translations = [
        {
          languageCode: 'pl',
          text: '[Wers niejasny — wymaga potwierdzenia oryginału]',
        },
      ];
      return { corrected: entries, previous };
    }

    async function placeholderRow(songId: string) {
      return em().findOneOrFail(SongLineTranslation, {
        line: { part: { song: songId, position: 17 }, position: 1 },
        languageCode: 'pl',
      });
    }

    it('updates text and flag in place, keeps ids, and is idempotent', async () => {
      const { corrected, previous } = paranaueEntries();
      const [imported] = await importSongs(
        em(),
        app.get(SongContentService),
        previous,
      );
      const before = await placeholderRow(imported.songId!);

      const [synced] = await syncSongTranslations(em(), corrected);

      expect(synced.status).toBe(SongTranslationSyncStatus.UPDATED);
      expect(synced.songId).toBe(imported.songId);
      expect(synced.changes).toEqual([
        expect.stringContaining('part 17 line 1 [pl]'),
      ]);
      const after = await placeholderRow(imported.songId!);
      expect(after.id).toBe(before.id);
      expect(after.text).toBe('I tak się stało, że wzgórze, Paraná');
      expect(after.isUncertain).toBe(true);
      expect((await verifyImportedSongs(em(), corrected)).ok).toBe(true);

      const [rerun] = await syncSongTranslations(em(), corrected);
      expect(rerun.status).toBe(SongTranslationSyncStatus.UNCHANGED);
    });

    it('dry run reports the change without writing it', async () => {
      const { corrected, previous } = paranaueEntries();
      const [imported] = await importSongs(
        em(),
        app.get(SongContentService),
        previous,
      );

      const [result] = await syncSongTranslations(em(), corrected, {
        dryRun: true,
      });

      expect(result.status).toBe(SongTranslationSyncStatus.WOULD_UPDATE);
      expect((await placeholderRow(imported.songId!)).text).toBe(
        '[Wers niejasny — wymaga potwierdzenia oryginału]',
      );
    });

    it('never touches other languages', async () => {
      const { corrected, previous } = paranaueEntries();
      const [imported] = await importSongs(
        em(),
        app.get(SongContentService),
        previous,
      );
      const fork = em();
      const line = await fork.findOneOrFail(SongLine, {
        part: { song: imported.songId!, position: 17 },
        position: 1,
      });
      const english = new SongLineTranslation();
      english.line = line;
      english.languageCode = 'en';
      english.text = 'And so the hill';
      english.isUncertain = true;
      await fork.persist(english).flush();

      const [synced] = await syncSongTranslations(em(), corrected);

      expect(synced.status).toBe(SongTranslationSyncStatus.UPDATED);
      const kept = await em().findOneOrFail(SongLineTranslation, {
        id: english.id,
      });
      expect([kept.text, kept.isUncertain]).toEqual(['And so the hill', true]);
    });

    it('skips a song whose lyrics were changed in the app', async () => {
      const { corrected, previous } = paranaueEntries();
      const [imported] = await importSongs(
        em(),
        app.get(SongContentService),
        previous,
      );
      const edited = await em().findOneOrFail(SongLine, {
        part: { song: imported.songId!, position: 3 },
        position: 1,
      });
      await em().nativeUpdate(
        SongLine,
        { id: edited.id },
        { originalText: 'Verso alterado no app' },
      );

      const [synced] = await syncSongTranslations(em(), corrected);

      expect(synced.status).toBe(SongTranslationSyncStatus.CONFLICT_STRUCTURE);
      expect((await placeholderRow(imported.songId!)).text).toBe(
        '[Wers niejasny — wymaga potwierdzenia oryginału]',
      );
    });

    it.each([SongEditProposalStatus.PENDING, SongEditProposalStatus.APPROVED])(
      'skips a song with a %s edit proposal',
      async (status) => {
        const { corrected, previous } = paranaueEntries();
        const [imported] = await importSongs(
          em(),
          app.get(SongContentService),
          previous,
        );
        const fork = em();
        const proposal = new SongEditProposal();
        proposal.song = fork.getReference(Song, imported.songId!);
        proposal.status = status;
        proposal.payload = {} as never;
        await fork.persist(proposal).flush();

        const [synced] = await syncSongTranslations(em(), corrected);

        expect(synced.status).toBe(
          SongTranslationSyncStatus.CONFLICT_EDIT_PROPOSALS,
        );
        expect((await placeholderRow(imported.songId!)).isUncertain).toBe(
          false,
        );
      },
    );

    it('reports a song that was never imported as NOT_FOUND', async () => {
      const { corrected } = paranaueEntries();
      const [result] = await syncSongTranslations(em(), corrected);
      expect(result.status).toBe(SongTranslationSyncStatus.NOT_FOUND);
    });
  });
});
