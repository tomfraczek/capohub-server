import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { SongAlternativeTitle } from '../src/songs/entities/song-alternative-title.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { SongLineTranslation } from '../src/songs/entities/song-line-translation.entity';
import { SongLine } from '../src/songs/entities/song-line.entity';
import { SongMedia } from '../src/songs/entities/song-media.entity';
import { SongPart } from '../src/songs/entities/song-part.entity';
import { SongTag } from '../src/songs/entities/song-tag.entity';
import { Song } from '../src/songs/entities/song.entity';
import { Tag } from '../src/songs/entities/tag.entity';
import { SongMediaProvider } from '../src/songs/enums/song-media-provider.enum';
import { SongPerformer } from '../src/songs/enums/song-performer.enum';

// Direct MikroORM/Postgres integration tests for the Songbook data model.
// There is no SongsController/SongsService yet (Etap 8.1 is model-only), so
// these tests drive the EntityManager against a real local Postgres
// instead of going through HTTP, unlike test/app.e2e-spec.ts.
describe('Songbook model (integration)', () => {
  let moduleRef: TestingModule;
  let em: EntityManager;
  const categoryIds: string[] = [];
  const tagIds: string[] = [];
  const songIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();
    em = moduleRef.get(EntityManager);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    const cleanup = em.fork();
    if (songIds.length > 0) {
      await cleanup.nativeDelete(Song, { id: { $in: songIds } });
      songIds.length = 0;
    }
    if (tagIds.length > 0) {
      await cleanup.nativeDelete(Tag, { id: { $in: tagIds } });
      tagIds.length = 0;
    }
    if (categoryIds.length > 0) {
      await cleanup.nativeDelete(SongCategory, { id: { $in: categoryIds } });
      categoryIds.length = 0;
    }
  });

  function buildCategory(): SongCategory {
    const category = new SongCategory();
    category.code = `TEST_${randomUUID()}`;
    category.name = 'Test category';
    category.position = 999;
    categoryIds.push(category.id);
    return category;
  }

  function buildTag(): Tag {
    const suffix = randomUUID();
    const tag = new Tag();
    tag.name = `test-tag-${suffix}`;
    tag.slug = `test-tag-${suffix}`;
    tagIds.push(tag.id);
    return tag;
  }

  function buildSong(category: SongCategory): Song {
    const song = new Song();
    song.title = 'Paranauê';
    song.slug = `paranaue-${randomUUID()}`;
    song.category = category;
    songIds.push(song.id);
    return song;
  }

  it('persists a full Song -> Part -> Line -> Translation structure, alternative titles, tags and media', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const tag = buildTag();
    const song = buildSong(category);

    const leadPart = new SongPart();
    leadPart.song = song;
    leadPart.performer = SongPerformer.LEAD;
    leadPart.position = 1;

    const chorusPart = new SongPart();
    chorusPart.song = song;
    chorusPart.performer = SongPerformer.CHORUS;
    chorusPart.position = 2;

    const leadLine = new SongLine();
    leadLine.part = leadPart;
    leadLine.originalText = 'Meu mestre mandou chamar';
    leadLine.position = 1;

    const translation = new SongLineTranslation();
    translation.line = leadLine;
    translation.languageCode = 'pl';
    translation.text = 'Mój mestre kazał zawołać';

    const altTitle = new SongAlternativeTitle();
    altTitle.song = song;
    altTitle.title = 'Paraná';
    altTitle.position = 1;

    const songTag = new SongTag();
    songTag.song = song;
    songTag.tag = tag;

    const media = new SongMedia();
    media.song = song;
    media.provider = SongMediaProvider.YOUTUBE;
    media.url = `https://www.youtube.com/watch?v=${randomUUID()}`;
    media.position = 1;

    await fork
      .persist([
        category,
        tag,
        song,
        leadPart,
        chorusPart,
        leadLine,
        translation,
        altTitle,
        songTag,
        media,
      ])
      .flush();

    const verify = em.fork();
    const persistedSong = await verify.findOneOrFail(Song, song.id, {
      populate: ['parts', 'alternativeTitles', 'tags', 'media'],
    });
    expect(persistedSong.parts.length).toBe(2);
    expect(persistedSong.alternativeTitles.length).toBe(1);
    expect(persistedSong.tags.length).toBe(1);
    expect(persistedSong.media.length).toBe(1);

    const persistedLine = await verify.findOneOrFail(SongLine, leadLine.id, {
      populate: ['translations'],
    });
    expect(persistedLine.translations.length).toBe(1);
    expect(persistedLine.translations[0].text).toBe('Mój mestre kazał zawołać');
  });

  it('rejects a second SongPart at the same position within a Song', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const song = buildSong(category);

    const first = new SongPart();
    first.song = song;
    first.performer = SongPerformer.LEAD;
    first.position = 1;
    await fork.persist([category, song, first]).flush();

    const duplicate = new SongPart();
    duplicate.song = song;
    duplicate.performer = SongPerformer.CHORUS;
    duplicate.position = 1;

    await expect(fork.persist(duplicate).flush()).rejects.toThrow(
      UniqueConstraintViolationException,
    );
  });

  it('rejects a second SongLine at the same position within a SongPart', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const song = buildSong(category);
    const part = new SongPart();
    part.song = song;
    part.performer = SongPerformer.LEAD;
    part.position = 1;

    const first = new SongLine();
    first.part = part;
    first.originalText = 'Line one';
    first.position = 1;
    await fork.persist([category, song, part, first]).flush();

    const duplicate = new SongLine();
    duplicate.part = part;
    duplicate.originalText = 'Line two';
    duplicate.position = 1;

    await expect(fork.persist(duplicate).flush()).rejects.toThrow(
      UniqueConstraintViolationException,
    );
  });

  it('rejects a second translation for the same line and languageCode', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const song = buildSong(category);
    const part = new SongPart();
    part.song = song;
    part.performer = SongPerformer.LEAD;
    part.position = 1;
    const line = new SongLine();
    line.part = part;
    line.originalText = 'Line one';
    line.position = 1;

    const first = new SongLineTranslation();
    first.line = line;
    first.languageCode = 'pl';
    first.text = 'Pierwsze tłumaczenie';
    await fork.persist([category, song, part, line, first]).flush();

    const duplicate = new SongLineTranslation();
    duplicate.line = line;
    duplicate.languageCode = 'pl';
    duplicate.text = 'Drugie tłumaczenie';

    await expect(fork.persist(duplicate).flush()).rejects.toThrow(
      UniqueConstraintViolationException,
    );
  });

  it('rejects the same tag being attached to a song twice', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const tag = buildTag();
    const song = buildSong(category);

    const first = new SongTag();
    first.song = song;
    first.tag = tag;
    await fork.persist([category, tag, song, first]).flush();

    const duplicate = new SongTag();
    duplicate.song = song;
    duplicate.tag = tag;

    await expect(fork.persist(duplicate).flush()).rejects.toThrow(
      UniqueConstraintViolationException,
    );
  });

  it('rejects the same url being attached to a song twice', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const song = buildSong(category);
    const url = `https://www.youtube.com/watch?v=${randomUUID()}`;

    const first = new SongMedia();
    first.song = song;
    first.provider = SongMediaProvider.YOUTUBE;
    first.url = url;
    first.position = 1;
    await fork.persist([category, song, first]).flush();

    const duplicate = new SongMedia();
    duplicate.song = song;
    duplicate.provider = SongMediaProvider.SPOTIFY;
    duplicate.url = url;
    duplicate.position = 2;

    await expect(fork.persist(duplicate).flush()).rejects.toThrow(
      UniqueConstraintViolationException,
    );
  });

  it('cascades a physical Song delete to its parts, lines, translations, alternative titles, tags and media - but leaves the SongCategory and Tag untouched', async () => {
    const fork = em.fork();
    const category = buildCategory();
    const tag = buildTag();
    const song = buildSong(category);

    const part = new SongPart();
    part.song = song;
    part.performer = SongPerformer.LEAD;
    part.position = 1;

    const line = new SongLine();
    line.part = part;
    line.originalText = 'Line one';
    line.position = 1;

    const translation = new SongLineTranslation();
    translation.line = line;
    translation.languageCode = 'pl';
    translation.text = 'Tłumaczenie';

    const altTitle = new SongAlternativeTitle();
    altTitle.song = song;
    altTitle.title = 'Alt title';
    altTitle.position = 1;

    const songTag = new SongTag();
    songTag.song = song;
    songTag.tag = tag;

    const media = new SongMedia();
    media.song = song;
    media.provider = SongMediaProvider.YOUTUBE;
    media.url = `https://www.youtube.com/watch?v=${randomUUID()}`;
    media.position = 1;

    await fork
      .persist([
        category,
        tag,
        song,
        part,
        line,
        translation,
        altTitle,
        songTag,
        media,
      ])
      .flush();

    const deleter = em.fork();
    await deleter.nativeDelete(Song, { id: song.id });

    const verify = em.fork();
    expect(await verify.count(Song, { id: song.id })).toBe(0);
    expect(await verify.count(SongPart, { id: part.id })).toBe(0);
    expect(await verify.count(SongLine, { id: line.id })).toBe(0);
    expect(
      await verify.count(SongLineTranslation, { id: translation.id }),
    ).toBe(0);
    expect(await verify.count(SongAlternativeTitle, { id: altTitle.id })).toBe(
      0,
    );
    expect(await verify.count(SongTag, { id: songTag.id })).toBe(0);
    expect(await verify.count(SongMedia, { id: media.id })).toBe(0);

    // Category and Tag are shared dictionaries - deleting a Song must
    // never take them down with it.
    expect(await verify.count(SongCategory, { id: category.id })).toBe(1);
    expect(await verify.count(Tag, { id: tag.id })).toBe(1);
  });
});
