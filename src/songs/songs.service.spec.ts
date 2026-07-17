import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Collection,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateSongInput } from './dto/create-song.schema';
import { SongAlternativeTitle } from './entities/song-alternative-title.entity';
import { SongCategory } from './entities/song-category.entity';
import { SongLine } from './entities/song-line.entity';
import { SongMediaVote } from './entities/song-media-vote.entity';
import { SongMedia } from './entities/song-media.entity';
import { SongPart } from './entities/song-part.entity';
import { SongTag } from './entities/song-tag.entity';
import { Song } from './entities/song.entity';
import { SongMediaProvider } from './enums/song-media-provider.enum';
import { SongPerformer } from './enums/song-performer.enum';
import { SongStatus } from './enums/song-status.enum';
import { DuplicateSongSuggestionDto } from './dto/duplicate-suggestion-response.dto';
import { SongDuplicateService } from './song-duplicate.service';
import { SongsService } from './songs.service';

// Every existing test builds a SongsService that should behave exactly as
// before this file's duplicate-detection change: no blocking duplicate
// found, submit proceeds normally. Tests that specifically exercise the
// duplicate flow pass their own findBlockingDuplicates/findSuggestions mock.
function buildMockDuplicateService(
  overrides: {
    findBlockingDuplicates?: jest.Mock;
    findSuggestions?: jest.Mock;
  } = {},
): SongDuplicateService {
  return {
    findBlockingDuplicates:
      overrides.findBlockingDuplicates ?? jest.fn().mockResolvedValue([]),
    findSuggestions:
      overrides.findSuggestions ?? jest.fn().mockResolvedValue([]),
  } as unknown as SongDuplicateService;
}

function buildCategory(overrides: Partial<SongCategory> = {}): SongCategory {
  const category = new SongCategory();
  category.code = 'CORRIDO';
  category.name = 'Corrido';
  category.position = 1;
  category.isActive = true;
  return Object.assign(category, overrides);
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildPopulatedSong(overrides: Partial<Song> = {}): Song {
  const song = new Song();
  song.title = 'Title';
  song.category = buildCategory();
  song.status = SongStatus.DRAFT;
  song.alternativeTitles = new Collection<SongAlternativeTitle>(song, []);
  song.tags = new Collection<SongTag>(song, []);
  song.parts = new Collection<SongPart>(song, []);
  song.media = new Collection<SongMedia>(song, []);
  return Object.assign(song, overrides);
}

// A DRAFT song that passes assertReadyForReview as-is, for submit() tests
// that care about what happens *after* the readiness check (duplicate
// detection, status transition).
function buildCompleteDraftSong(overrides: Partial<Song> = {}): Song {
  const song = buildPopulatedSong({ status: SongStatus.DRAFT, ...overrides });
  const part = new SongPart();
  part.song = song;
  part.performer = SongPerformer.LEAD;
  part.position = 1;
  const line = new SongLine();
  line.part = part;
  line.originalText = 'Paranauê, paranauê Paraná';
  line.position = 1;
  part.lines = new Collection<SongLine>(part, [line]);
  song.parts = new Collection<SongPart>(song, [part]);
  return song;
}

function buildSongMedia(overrides: Partial<SongMedia> = {}): SongMedia {
  const media = new SongMedia();
  media.song = buildPopulatedSong();
  media.provider = SongMediaProvider.YOUTUBE;
  media.url = 'https://www.youtube.com/watch?v=abc';
  media.title = 'Wersja koncertowa';
  media.position = 1;
  media.isVerified = false;
  return Object.assign(media, overrides);
}

function buildVote(overrides: Partial<SongMediaVote> = {}): SongMediaVote {
  const vote = new SongMediaVote();
  vote.song = buildPopulatedSong();
  vote.media = buildSongMedia();
  vote.user = buildUser();
  return Object.assign(vote, overrides);
}

function buildCreateInput(
  overrides: Partial<CreateSongInput> = {},
): CreateSongInput {
  return {
    title: 'Paranauê',
    authorName: null,
    categoryId: 'category-id',
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: SongPerformer.LEAD,
        position: 1,
        lines: [
          {
            originalText: 'a',
            phoneticText: null,
            position: 1,
            translations: [],
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

interface FindOneRouting {
  category?: SongCategory | null;
  detailsSong?: Song | null;
  media?: SongMedia | null;
  existingVote?: SongMediaVote | null;
  voteCounts?: { mediaId: string; voteCount: number }[];
  votedMediaId?: string | null;
}

function buildMockEm(routing: FindOneRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });
  const nativeDelete = jest.fn().mockResolvedValue(0);
  const find = jest.fn().mockResolvedValue([]);

  const findOne = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === SongCategory) {
      return Promise.resolve(
        routing.category === undefined ? buildCategory() : routing.category,
      );
    }
    if (entity === Song) {
      return Promise.resolve(
        routing.detailsSong === undefined
          ? buildPopulatedSong()
          : routing.detailsSong,
      );
    }
    if (entity === SongMedia) {
      return Promise.resolve(
        routing.media === undefined ? buildSongMedia() : routing.media,
      );
    }
    if (entity === SongMediaVote) {
      return Promise.resolve(routing.existingVote ?? null);
    }
    return Promise.resolve(null);
  });

  const findOneOrFail = jest
    .fn()
    .mockImplementation(async (entity: unknown) => {
      const result: unknown = await findOne(entity);
      if (!result) {
        throw new Error('not found');
      }
      return result;
    });

  const execute = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('group by media_id')) {
      return Promise.resolve(routing.voteCounts ?? []);
    }
    return Promise.resolve(
      routing.votedMediaId ? [{ mediaId: routing.votedMediaId }] : [],
    );
  });
  const getConnection = jest.fn().mockReturnValue({ execute });

  const em = {
    findOne,
    findOneOrFail,
    find,
    persist,
    remove,
    nativeDelete,
    flush,
    getConnection,
    transactional: undefined as unknown as jest.Mock,
  };
  em.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(em));

  return em as unknown as EntityManager & {
    transactional: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    find: jest.Mock;
    persist: jest.Mock<{ flush: jest.Mock }, [object[]]>;
    remove: jest.Mock;
    nativeDelete: jest.Mock;
    flush: jest.Mock;
    getConnection: jest.Mock;
  };
}

describe('SongsService', () => {
  describe('create', () => {
    it('creates a song as DRAFT, owned by the current user, with unverified media', async () => {
      const em = buildMockEm({
        detailsSong: buildPopulatedSong({ createdBy: buildUser() }),
      });
      const service = new SongsService(em, buildMockDuplicateService());
      const user = buildUser();

      let createdSong: Song | undefined;
      em.persist.mockImplementation((entities: object[]) => {
        createdSong = entities.find(
          (entity): entity is Song => entity instanceof Song,
        );
        return { flush: em.flush };
      });

      await service.create(
        user,
        buildCreateInput({
          media: [
            {
              provider: 'YOUTUBE' as never,
              url: 'https://www.youtube.com/watch?v=abc',
              title: null,
              position: 1,
            },
          ],
        }),
      );

      expect(createdSong).toBeDefined();
      expect(createdSong?.status).toBe(SongStatus.DRAFT);
      expect(createdSong?.createdBy).toBe(user);

      const persistedEntities = em.persist.mock.calls[0][0];
      const media = persistedEntities.find(
        (entity): entity is SongMedia => entity instanceof SongMedia,
      );
      expect(media?.isVerified).toBe(false);
      expect(media?.createdBy).toBe(user);
    });

    it('runs inside a transaction', async () => {
      const em = buildMockEm();
      const service = new SongsService(em, buildMockDuplicateService());

      await service.create(buildUser(), buildCreateInput());

      expect(em.transactional).toHaveBeenCalledTimes(1);
    });

    it('rejects when categoryId does not reference an existing category', async () => {
      const em = buildMockEm({ category: null });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.create(buildUser(), buildCreateInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the category is not active', async () => {
      const em = buildMockEm({ category: buildCategory({ isActive: false }) });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.create(buildUser(), buildCreateInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when a tagId does not resolve to an active tag', async () => {
      const em = buildMockEm();
      em.find.mockResolvedValue([]); // fewer tags returned than requested

      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.create(
          buildUser(),
          buildCreateInput({ tagIds: ['missing-tag-id'] }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a unique constraint violation on flush to a 409 Conflict', async () => {
      const em = buildMockEm();
      em.persist.mockReturnValue({
        flush: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintViolationException(new Error('duplicate key')),
          ),
      });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.create(buildUser(), buildCreateInput()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getDetails', () => {
    it('throws NotFoundException when the song does not exist', async () => {
      const em = buildMockEm({ detailsSong: null });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(service.getDetails('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDuplicateSuggestions', () => {
    it('delegates to SongDuplicateService.findSuggestions and wraps the result in { items }', async () => {
      const em = buildMockEm();
      const suggestion: DuplicateSongSuggestionDto = {
        id: 'song-1',
        title: 'Paranauê',
        firstLine: 'Paranauê, paranauê Paraná',
        status: SongStatus.PUBLISHED,
        similarity: 0.9,
      };
      const findSuggestions = jest.fn().mockResolvedValue([suggestion]);
      const service = new SongsService(
        em,
        buildMockDuplicateService({ findSuggestions }),
      );
      const user = buildUser();

      const result = await service.getDuplicateSuggestions(user, 'Paranauê', 5);

      expect(findSuggestions).toHaveBeenCalledWith(em, user.id, 'Paranauê', 5);
      expect(result).toEqual({ items: [suggestion] });
    });

    it('returns { items: [] } when SongDuplicateService finds nothing', async () => {
      const em = buildMockEm();
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.getDuplicateSuggestions(
        buildUser(),
        'ab',
        5,
      );

      expect(result).toEqual({ items: [] });
    });
  });

  describe('update', () => {
    it('replaces child collections and never changes createdBy or status', async () => {
      const owner = buildUser({ email: 'owner@example.com' });
      const editor = buildUser({ email: 'editor@example.com' });
      const existingSong = buildPopulatedSong({
        createdBy: owner,
        status: SongStatus.PUBLISHED,
      });

      const em = buildMockEm({ detailsSong: existingSong });
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === SongCategory) return Promise.resolve(buildCategory());
        if (entity === Song) return Promise.resolve(existingSong);
        return Promise.resolve(null);
      });

      const service = new SongsService(em, buildMockDuplicateService());
      await service.update(
        existingSong.id,
        editor,
        buildCreateInput({ title: 'New title' }),
      );

      expect(em.nativeDelete).toHaveBeenCalledWith(SongAlternativeTitle, {
        song: existingSong.id,
      });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongTag, {
        song: existingSong.id,
      });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongPart, {
        song: existingSong.id,
      });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongMedia, {
        song: existingSong.id,
      });

      expect(existingSong.createdBy).toBe(owner);
      expect(existingSong.status).toBe(SongStatus.PUBLISHED);
      expect(existingSong.title).toBe('New title');
    });

    it('throws NotFoundException for a missing song', async () => {
      const em = buildMockEm({ detailsSong: null });
      em.findOne.mockImplementation(
        (entity: unknown, where: Record<string, unknown>) => {
          if (entity === Song && 'id' in where) return Promise.resolve(null);
          return Promise.resolve(buildCategory());
        },
      );
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.update('missing-id', buildUser(), buildCreateInput()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('moderation transitions', () => {
    it('submit: moves DRAFT to PENDING_REVIEW when the song is complete', async () => {
      const song = buildPopulatedSong({ status: SongStatus.DRAFT });
      const part = new SongPart();
      part.song = song;
      part.performer = SongPerformer.LEAD;
      part.position = 1;
      const line = new SongLine();
      line.part = part;
      line.originalText = 'Meu mestre mandou chamar';
      line.position = 1;
      part.lines = new Collection<SongLine>(part, [line]);
      song.parts = new Collection<SongPart>(song, [part]);

      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.submit(song.id, buildUser());

      expect(song.status).toBe(SongStatus.PENDING_REVIEW);
    });

    it('submit: rejects an incomplete song (no parts) with 409', async () => {
      const song = buildPopulatedSong({ status: SongStatus.DRAFT });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(service.submit(song.id, buildUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('submit: rejects from an invalid source status (PUBLISHED)', async () => {
      const song = buildPopulatedSong({ status: SongStatus.PUBLISHED });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(service.submit(song.id, buildUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('submit: throws 409 DUPLICATE_SONG and never changes status or flushes when a blocking duplicate is found', async () => {
      const song = buildCompleteDraftSong();
      const em = buildMockEm({ detailsSong: song });
      const duplicate: DuplicateSongSuggestionDto = {
        id: 'existing-song-id',
        title: 'Paranauê',
        firstLine: 'Paranauê, paranauê Paraná',
        status: SongStatus.PUBLISHED,
        similarity: 0.99,
      };
      const findBlockingDuplicates = jest.fn().mockResolvedValue([duplicate]);
      const service = new SongsService(
        em,
        buildMockDuplicateService({ findBlockingDuplicates }),
      );
      const user = buildUser();

      const error: unknown = await service
        .submit(song.id, user)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'DUPLICATE_SONG',
        duplicates: [duplicate],
      });
      expect(song.status).toBe(SongStatus.DRAFT);
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('submit: calls findBlockingDuplicates with the current user and the loaded song, excluding nothing else', async () => {
      const song = buildCompleteDraftSong();
      const em = buildMockEm({ detailsSong: song });
      const findBlockingDuplicates = jest.fn().mockResolvedValue([]);
      const service = new SongsService(
        em,
        buildMockDuplicateService({ findBlockingDuplicates }),
      );
      const user = buildUser({ email: 'submitter@example.com' });

      await service.submit(song.id, user);

      expect(findBlockingDuplicates).toHaveBeenCalledWith(em, user.id, song);
    });

    it('submit: proceeds normally when findBlockingDuplicates finds nothing', async () => {
      const song = buildCompleteDraftSong();
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.submit(song.id, buildUser());

      expect(song.status).toBe(SongStatus.PENDING_REVIEW);
      expect(em.flush).toHaveBeenCalled();
    });

    it('publish: PENDING_REVIEW -> PUBLISHED', async () => {
      const song = buildPopulatedSong({ status: SongStatus.PENDING_REVIEW });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.publish(song.id);

      expect(song.status).toBe(SongStatus.PUBLISHED);
    });

    it('publish: rejects from DRAFT with 409', async () => {
      const song = buildPopulatedSong({ status: SongStatus.DRAFT });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(service.publish(song.id)).rejects.toThrow(ConflictException);
    });

    it('reject: PENDING_REVIEW -> REJECTED', async () => {
      const song = buildPopulatedSong({ status: SongStatus.PENDING_REVIEW });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.reject(song.id);

      expect(song.status).toBe(SongStatus.REJECTED);
    });

    it('hide: PUBLISHED -> HIDDEN', async () => {
      const song = buildPopulatedSong({ status: SongStatus.PUBLISHED });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.hide(song.id);

      expect(song.status).toBe(SongStatus.HIDDEN);
    });

    it('restore: HIDDEN -> PUBLISHED', async () => {
      const song = buildPopulatedSong({ status: SongStatus.HIDDEN });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.restore(song.id);

      expect(song.status).toBe(SongStatus.PUBLISHED);
    });
  });

  describe('delete', () => {
    it('physically deletes a DRAFT song', async () => {
      const song = buildPopulatedSong({ status: SongStatus.DRAFT });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await service.delete(song.id);

      expect(em.remove).toHaveBeenCalledWith(song);
    });

    it('rejects deleting a PUBLISHED song with 409', async () => {
      const song = buildPopulatedSong({ status: SongStatus.PUBLISHED });
      const em = buildMockEm({ detailsSong: song });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(service.delete(song.id)).rejects.toThrow(ConflictException);
      expect(em.remove).not.toHaveBeenCalled();
    });
  });

  describe('media verification', () => {
    it('verifyMedia sets isVerified from false to true', async () => {
      const media = buildSongMedia({ isVerified: false });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.verifyMedia(media.song.id, media.id);

      expect(result.isVerified).toBe(true);
      expect(media.isVerified).toBe(true);
      expect(em.flush).toHaveBeenCalled();
    });

    it('unverifyMedia sets isVerified from true to false', async () => {
      const media = buildSongMedia({ isVerified: true });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.unverifyMedia(media.song.id, media.id);

      expect(result.isVerified).toBe(false);
      expect(media.isVerified).toBe(false);
      expect(em.flush).toHaveBeenCalled();
    });

    it('verifyMedia is idempotent when already verified (no unnecessary flush)', async () => {
      const media = buildSongMedia({ isVerified: true });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.verifyMedia(media.song.id, media.id);

      expect(result.isVerified).toBe(true);
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('unverifyMedia is idempotent when already unverified (no unnecessary flush)', async () => {
      const media = buildSongMedia({ isVerified: false });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.unverifyMedia(media.song.id, media.id);

      expect(result.isVerified).toBe(false);
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('throws SONG_MEDIA_NOT_FOUND (404) when the media does not exist', async () => {
      const em = buildMockEm({ media: null });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.verifyMedia('song-id', 'missing-media-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 (not a leaked detail) when the media belongs to a different song, scoping the lookup by both ids', async () => {
      const em = buildMockEm({ media: null });
      const service = new SongsService(em, buildMockDuplicateService());

      await expect(
        service.verifyMedia('song-a', 'media-from-song-b'),
      ).rejects.toThrow(NotFoundException);
      expect(em.findOne).toHaveBeenCalledWith(SongMedia, {
        id: 'media-from-song-b',
        song: 'song-a',
      });
    });

    it('verifyMedia does not change any other SongMedia field', async () => {
      const media = buildSongMedia({
        isVerified: false,
        url: 'https://www.youtube.com/watch?v=untouched',
        title: 'Untouched title',
        position: 3,
      });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.verifyMedia(media.song.id, media.id);

      expect(result.url).toBe('https://www.youtube.com/watch?v=untouched');
      expect(result.title).toBe('Untouched title');
      expect(result.position).toBe(3);
      expect(result.provider).toBe(SongMediaProvider.YOUTUBE);
    });

    it('unverifyMedia does not change any other SongMedia field', async () => {
      const media = buildSongMedia({
        isVerified: true,
        url: 'https://www.youtube.com/watch?v=untouched',
        title: 'Untouched title',
        position: 3,
      });
      const em = buildMockEm({ media });
      const service = new SongsService(em, buildMockDuplicateService());

      const result = await service.unverifyMedia(media.song.id, media.id);

      expect(result.url).toBe('https://www.youtube.com/watch?v=untouched');
      expect(result.title).toBe('Untouched title');
      expect(result.position).toBe(3);
      expect(result.provider).toBe(SongMediaProvider.YOUTUBE);
    });
  });

  describe('media voting', () => {
    describe('setMediaVote', () => {
      it('creates a SongMediaVote on the first vote', async () => {
        const media = buildSongMedia();
        const user = buildUser();
        const em = buildMockEm({
          media,
          existingVote: null,
          voteCounts: [{ mediaId: media.id, voteCount: 1 }],
          votedMediaId: media.id,
        });
        const service = new SongsService(em, buildMockDuplicateService());

        let persistedVote: SongMediaVote | undefined;
        em.persist.mockImplementation((entity: unknown) => {
          persistedVote = entity as SongMediaVote;
          return { flush: em.flush };
        });

        const result = await service.setMediaVote(
          media.song.id,
          media.id,
          user,
        );

        expect(persistedVote).toBeInstanceOf(SongMediaVote);
        expect(persistedVote?.song.id).toBe(media.song.id);
        expect(persistedVote?.media.id).toBe(media.id);
        expect(persistedVote?.user).toBe(user);
        expect(em.flush).toHaveBeenCalled();
        expect(result).toEqual({
          songId: media.song.id,
          mediaId: media.id,
          voteCount: 1,
          isVotedByCurrentUser: true,
        });
      });

      it('is idempotent when voting again for the same media (no unnecessary flush)', async () => {
        const media = buildSongMedia();
        const user = buildUser();
        const vote = buildVote({ song: media.song, media, user });
        const em = buildMockEm({ media, existingVote: vote });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.setMediaVote(media.song.id, media.id, user);

        expect(em.persist).not.toHaveBeenCalled();
        expect(em.flush).not.toHaveBeenCalled();
      });

      it('updates the existing vote to point at a different media in the same song, keeping a single record', async () => {
        const song = buildPopulatedSong();
        const oldMedia = buildSongMedia({ song });
        oldMedia.id = 'media-old';
        const newMedia = buildSongMedia({ song });
        newMedia.id = 'media-new';
        const user = buildUser();
        const vote = buildVote({ song, media: oldMedia, user });

        const em = buildMockEm({ media: newMedia, existingVote: vote });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.setMediaVote(song.id, newMedia.id, user);

        expect(vote.media).toBe(newMedia);
        expect(em.persist).not.toHaveBeenCalled();
        expect(em.flush).toHaveBeenCalled();
      });

      it('scopes the existing-vote lookup by songId, so votes in different songs never collide', async () => {
        const media = buildSongMedia();
        const user = buildUser();
        const em = buildMockEm({ media, existingVote: null });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.setMediaVote('song-a', media.id, user);

        expect(em.findOne).toHaveBeenCalledWith(SongMediaVote, {
          song: 'song-a',
          user: user.id,
        });
      });

      it('throws 404 SONG_MEDIA_NOT_FOUND when the media does not exist', async () => {
        const em = buildMockEm({ media: null });
        const service = new SongsService(em, buildMockDuplicateService());

        await expect(
          service.setMediaVote('song-a', 'missing-media-id', buildUser()),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws 404 when the media belongs to a different song, scoping the lookup by both ids', async () => {
        const em = buildMockEm({ media: null });
        const service = new SongsService(em, buildMockDuplicateService());

        await expect(
          service.setMediaVote('song-a', 'media-from-song-b', buildUser()),
        ).rejects.toThrow(NotFoundException);
        expect(em.findOne).toHaveBeenCalledWith(SongMedia, {
          id: 'media-from-song-b',
          song: 'song-a',
        });
      });

      it('computes voteCount and isVotedByCurrentUser from the aggregate query', async () => {
        const media = buildSongMedia();
        const user = buildUser();
        const em = buildMockEm({
          media,
          existingVote: null,
          voteCounts: [{ mediaId: media.id, voteCount: 3 }],
          votedMediaId: media.id,
        });
        const service = new SongsService(em, buildMockDuplicateService());

        const result = await service.setMediaVote(
          media.song.id,
          media.id,
          user,
        );

        expect(result).toEqual({
          songId: media.song.id,
          mediaId: media.id,
          voteCount: 3,
          isVotedByCurrentUser: true,
        });
      });

      it('does not change isVerified or any other SongMedia field when voting', async () => {
        const creator = buildUser({ email: 'creator@example.com' });
        const media = buildSongMedia({
          isVerified: true,
          position: 5,
          url: 'https://www.youtube.com/watch?v=untouched',
          title: 'Untouched title',
          createdBy: creator,
        });
        const em = buildMockEm({ media, existingVote: null });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.setMediaVote(media.song.id, media.id, buildUser());

        expect(media.isVerified).toBe(true);
        expect(media.position).toBe(5);
        expect(media.url).toBe('https://www.youtube.com/watch?v=untouched');
        expect(media.title).toBe('Untouched title');
        expect(media.provider).toBe(SongMediaProvider.YOUTUBE);
        expect(media.createdBy).toBe(creator);
      });
    });

    describe('removeMediaVote', () => {
      it('deletes an existing vote', async () => {
        const vote = buildVote();
        const em = buildMockEm({ existingVote: vote });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.removeMediaVote(vote.song.id, vote.user);

        expect(em.remove).toHaveBeenCalledWith(vote);
      });

      it('is idempotent when no vote exists', async () => {
        const em = buildMockEm({ existingVote: null });
        const service = new SongsService(em, buildMockDuplicateService());

        await service.removeMediaVote('song-a', buildUser());

        expect(em.remove).not.toHaveBeenCalled();
      });
    });

    describe('getDetails vote aggregation', () => {
      it('marks isVotedByCurrentUser=true for exactly the voted media, with correct voteCounts', async () => {
        const song = buildPopulatedSong();
        const mediaA = buildSongMedia({ song });
        mediaA.id = 'media-a';
        const mediaB = buildSongMedia({ song });
        mediaB.id = 'media-b';
        song.media = new Collection<SongMedia>(song, [mediaA, mediaB]);

        const em = buildMockEm({
          detailsSong: song,
          voteCounts: [{ mediaId: 'media-a', voteCount: 2 }],
          votedMediaId: 'media-a',
        });
        const service = new SongsService(em, buildMockDuplicateService());

        const result = await service.getDetails(song.id, 'current-user-id');

        const mediaAResult = result.media.find((m) => m.id === 'media-a');
        const mediaBResult = result.media.find((m) => m.id === 'media-b');
        expect(mediaAResult?.isVotedByCurrentUser).toBe(true);
        expect(mediaAResult?.voteCount).toBe(2);
        expect(mediaBResult?.isVotedByCurrentUser).toBe(false);
        expect(mediaBResult?.voteCount).toBe(0);
      });

      it('defaults isVotedByCurrentUser to false when no currentUserId is given', async () => {
        const song = buildPopulatedSong();
        const media = buildSongMedia({ song });
        song.media = new Collection<SongMedia>(song, [media]);

        const em = buildMockEm({
          detailsSong: song,
          voteCounts: [{ mediaId: media.id, voteCount: 5 }],
          votedMediaId: media.id,
        });
        const service = new SongsService(em, buildMockDuplicateService());

        const result = await service.getDetails(song.id);

        expect(result.media[0].voteCount).toBe(5);
        expect(result.media[0].isVotedByCurrentUser).toBe(false);
      });
    });
  });
});
