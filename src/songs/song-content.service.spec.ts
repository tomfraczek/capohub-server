import { BadRequestException, ConflictException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateSongInput } from './dto/create-song.schema';
import { SongAlternativeTitle } from './entities/song-alternative-title.entity';
import { SongCategory } from './entities/song-category.entity';
import { SongMedia } from './entities/song-media.entity';
import { SongPart } from './entities/song-part.entity';
import { SongTag } from './entities/song-tag.entity';
import { Song } from './entities/song.entity';
import { Tag } from './entities/tag.entity';
import { SongPerformer } from './enums/song-performer.enum';
import { SongContentService } from './song-content.service';

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
}

function buildMockEm(routing: FindOneRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });
  const nativeDelete = jest.fn().mockResolvedValue(0);
  const find = jest.fn().mockResolvedValue([]);
  const findOne = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === SongCategory) {
      return Promise.resolve(
        routing.category === undefined ? buildCategory() : routing.category,
      );
    }
    return Promise.resolve(null);
  });

  return {
    findOne,
    find,
    persist,
    nativeDelete,
    flush,
  } as unknown as EntityManager & {
    findOne: jest.Mock;
    find: jest.Mock;
    persist: jest.Mock<{ flush: jest.Mock }, [object[]]>;
    nativeDelete: jest.Mock;
    flush: jest.Mock;
  };
}

describe('SongContentService', () => {
  describe('loadActiveCategoryOrFail', () => {
    it('throws BadRequestException when the category does not exist', async () => {
      const service = new SongContentService();
      const em = buildMockEm({ category: null });

      await expect(
        service.loadActiveCategoryOrFail(em, 'missing-id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the category is not active', async () => {
      const service = new SongContentService();
      const em = buildMockEm({ category: buildCategory({ isActive: false }) });

      await expect(
        service.loadActiveCategoryOrFail(em, 'category-id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the category when it exists and is active', async () => {
      const service = new SongContentService();
      const category = buildCategory();
      const em = buildMockEm({ category });

      await expect(
        service.loadActiveCategoryOrFail(em, category.id),
      ).resolves.toBe(category);
    });
  });

  describe('loadActiveTagsOrFail', () => {
    it('returns an empty array without querying when tagIds is empty', async () => {
      const service = new SongContentService();
      const em = buildMockEm();

      const tags = await service.loadActiveTagsOrFail(em, []);

      expect(tags).toEqual([]);
      expect(em.find).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when fewer tags are found than requested', async () => {
      const service = new SongContentService();
      const em = buildMockEm();
      em.find.mockResolvedValue([]);

      await expect(
        service.loadActiveTagsOrFail(em, ['missing-tag-id']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assertApplicable', () => {
    it('resolves without applying anything when category/tags are valid', async () => {
      const service = new SongContentService();
      const em = buildMockEm();

      await expect(
        service.assertApplicable(em, buildCreateInput()),
      ).resolves.toBeUndefined();
      expect(em.nativeDelete).not.toHaveBeenCalled();
      expect(em.persist).not.toHaveBeenCalled();
    });

    it('rejects when categoryId is invalid, without ever calling persist', async () => {
      const service = new SongContentService();
      const em = buildMockEm({ category: null });

      await expect(
        service.assertApplicable(em, buildCreateInput()),
      ).rejects.toThrow(BadRequestException);
      expect(em.persist).not.toHaveBeenCalled();
    });
  });

  describe('replaceContent', () => {
    it('applies scalar fields, wipes every child collection and rebuilds it from the input', async () => {
      const service = new SongContentService();
      const song = new Song();
      song.title = 'Old title';
      song.category = buildCategory();
      const em = buildMockEm();
      const owner = buildUser();

      await service.replaceContent(
        em,
        song,
        buildCreateInput({ title: 'New title' }),
        owner,
      );

      expect(song.title).toBe('New title');
      expect(em.nativeDelete).toHaveBeenCalledWith(SongAlternativeTitle, {
        song: song.id,
      });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongTag, { song: song.id });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongPart, {
        song: song.id,
      });
      expect(em.nativeDelete).toHaveBeenCalledWith(SongMedia, {
        song: song.id,
      });

      const persistedEntities = em.persist.mock.calls[0][0];
      expect(persistedEntities).toContain(song);
      const part = persistedEntities.find(
        (entity): entity is SongPart => entity instanceof SongPart,
      );
      expect(part).toBeDefined();
    });

    it('attributes new media rows to the given mediaOwner, not the song itself', async () => {
      const service = new SongContentService();
      const song = new Song();
      song.category = buildCategory();
      const em = buildMockEm();
      const mediaOwner = buildUser({ email: 'media-owner@example.com' });

      await service.replaceContent(
        em,
        song,
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
        mediaOwner,
      );

      const persistedEntities = em.persist.mock.calls[0][0];
      const media = persistedEntities.find(
        (entity): entity is SongMedia => entity instanceof SongMedia,
      );
      expect(media?.createdBy).toBe(mediaOwner);
      expect(media?.isVerified).toBe(false);
    });

    it('resolves and attaches the requested tags', async () => {
      const service = new SongContentService();
      const song = new Song();
      song.category = buildCategory();
      const tag = Object.assign(new Tag(), {
        name: 'roda',
        slug: 'roda',
        isActive: true,
      });
      const em = buildMockEm();
      em.find.mockResolvedValue([tag]);

      await service.replaceContent(
        em,
        song,
        buildCreateInput({ tagIds: [tag.id] }),
        buildUser(),
      );

      const persistedEntities = em.persist.mock.calls[0][0];
      const songTag = persistedEntities.find(
        (entity): entity is SongTag => entity instanceof SongTag,
      );
      expect(songTag?.tag).toBe(tag);
    });

    it('maps a unique constraint violation on flush to a 409 Conflict', async () => {
      const service = new SongContentService();
      const song = new Song();
      song.category = buildCategory();
      const em = buildMockEm();
      em.persist.mockReturnValue({
        flush: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintViolationException(new Error('duplicate key')),
          ),
      });

      await expect(
        service.replaceContent(em, song, buildCreateInput(), buildUser()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when categoryId does not reference an active category, before touching any child collection', async () => {
      const service = new SongContentService();
      const song = new Song();
      song.category = buildCategory();
      const em = buildMockEm({ category: null });

      await expect(
        service.replaceContent(em, song, buildCreateInput(), buildUser()),
      ).rejects.toThrow(BadRequestException);
      expect(em.nativeDelete).not.toHaveBeenCalled();
    });
  });
});
