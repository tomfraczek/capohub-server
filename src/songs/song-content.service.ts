import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  CreateSongAlternativeTitleInput,
  CreateSongInput,
  CreateSongMediaInput,
  CreateSongPartInput,
} from './dto/create-song.schema';
import { SongAlternativeTitle } from './entities/song-alternative-title.entity';
import { SongCategory } from './entities/song-category.entity';
import { SongLine } from './entities/song-line.entity';
import { SongLinePhonetic } from './entities/song-line-phonetic.entity';
import { SongLineTranslation } from './entities/song-line-translation.entity';
import { SongMedia } from './entities/song-media.entity';
import { SongPart } from './entities/song-part.entity';
import { SongTag } from './entities/song-tag.entity';
import { Song } from './entities/song.entity';
import { Tag } from './entities/tag.entity';

/**
 * The single source of truth for "how does a full CreateSongInput snapshot
 * become an actual Song row plus its child collections" - see the
 * moderation model. Every place that ever writes a Song's full content goes
 * through replaceContent() here:
 *  - SongsService.create() (brand-new Song, nothing to wipe first)
 *  - SongsService.update() (direct edit of the caller's own DRAFT/REJECTED)
 *  - SongEditProposalsService.approve() (applying an approved proposal's
 *    snapshot to a PUBLISHED/HIDDEN Song)
 *
 * This guarantees the three call sites can never drift: the exact same
 * validation (active category/tags), the exact same replace-all rebuild of
 * alternativeTitles/tags/parts/lines/phonetics/translations/media, and the
 * exact same conflict handling apply everywhere, regardless of which caller
 * triggered it or why.
 */
@Injectable()
export class SongContentService {
  async loadActiveCategoryOrFail(
    em: EntityManager,
    categoryId: string,
  ): Promise<SongCategory> {
    const category = await em.findOne(SongCategory, { id: categoryId });
    if (!category || !category.isActive) {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY',
        message: 'categoryId does not reference an active category',
      });
    }
    return category;
  }

  async loadActiveTagsOrFail(
    em: EntityManager,
    tagIds: string[],
  ): Promise<Tag[]> {
    if (tagIds.length === 0) {
      return [];
    }

    const tags = await em.find(Tag, { id: { $in: tagIds }, isActive: true });
    if (tags.length !== tagIds.length) {
      throw new BadRequestException({
        code: 'INVALID_TAGS',
        message: 'tagIds must all reference active tags',
      });
    }
    return tags;
  }

  /**
   * Re-resolves and validates `input.categoryId`/`input.tagIds` without
   * applying anything - used by SongEditProposalsService.create() to reject
   * a proposal whose snapshot could never be applied later (see
   * SongEditProposal.payload's own comment), without duplicating the
   * category/tag validation rules themselves.
   */
  async assertApplicable(
    em: EntityManager,
    input: CreateSongInput,
  ): Promise<void> {
    await this.loadActiveCategoryOrFail(em, input.categoryId);
    await this.loadActiveTagsOrFail(em, input.tagIds);
  }

  /**
   * Applies `input` to `song` as its full, authoritative content: scalar
   * fields, category, and every child collection (replace-all - see
   * create-song.schema.ts's own comment on why this aggregate never does a
   * partial/diff update). `song` may be brand-new and unpersisted (create)
   * or already persisted (update/approve) - the child-collection wipe is a
   * no-op in the brand-new case, since nothing yet references its id.
   *
   * `mediaOwner` becomes `SongMedia.createdBy` for every media row rebuilt
   * here - the caller decides who that should be (the acting editor for a
   * direct update, the original proposer for an approved proposal - see
   * each call site's own comment). Null only for system-authored content
   * with no CapoHub user behind it (see the curated song import in
   * database/seeds/songs/song-import.ts) - SongMedia.createdBy is nullable
   * anyway.
   */
  async replaceContent(
    em: EntityManager,
    song: Song,
    input: CreateSongInput,
    mediaOwner: User | null,
  ): Promise<void> {
    const category = await this.loadActiveCategoryOrFail(em, input.categoryId);
    const tags = await this.loadActiveTagsOrFail(em, input.tagIds);

    this.applyFields(song, input, category);

    // Read before the wipe below - the only place an omitted isUncertain
    // can still be resolved from (see resolveIsUncertain).
    const previousFlags = await this.loadUncertainTranslationKeys(em, song);

    // Replace-all strategy: wipe every child collection, then rebuild it
    // from the request. SongPart's DB-level ON DELETE CASCADE takes
    // song_lines and song_line_translations down with it, so there is
    // nothing left to orphan.
    await em.nativeDelete(SongAlternativeTitle, { song: song.id });
    await em.nativeDelete(SongTag, { song: song.id });
    await em.nativeDelete(SongPart, { song: song.id });
    await em.nativeDelete(SongMedia, { song: song.id });

    const children = this.buildChildEntities(
      song,
      input,
      tags,
      mediaOwner,
      previousFlags,
    );

    await this.persistOrThrowConflict(em, [song, ...children]);
  }

  private applyFields(
    song: Song,
    input: CreateSongInput,
    category: SongCategory,
  ): void {
    song.title = input.title;
    song.authorName = input.authorName;
    song.category = category;
    song.meaningHistory = input.meaningHistory;
    song.meaningContext = input.meaningContext;
    song.meaningTrivia = input.meaningTrivia;
  }

  private buildChildEntities(
    song: Song,
    input: CreateSongInput,
    tags: Tag[],
    mediaOwner: User | null,
    previousFlags: Set<string>,
  ): object[] {
    const entities: object[] = [
      ...input.alternativeTitles.map((item) =>
        this.buildAlternativeTitle(song, item),
      ),
      ...tags.map((tag) => this.buildSongTag(song, tag)),
      ...input.media.map((item) => this.buildSongMedia(song, item, mediaOwner)),
    ];

    for (const partInput of input.parts) {
      const part = this.buildSongPart(song, partInput);
      entities.push(part);

      for (const lineInput of partInput.lines) {
        const line = new SongLine();
        line.part = part;
        line.originalText = lineInput.originalText;
        line.position = lineInput.position;
        entities.push(line);

        for (const phoneticInput of lineInput.phonetics) {
          const phonetic = new SongLinePhonetic();
          phonetic.line = line;
          phonetic.languageCode = phoneticInput.languageCode;
          phonetic.text = phoneticInput.text;
          entities.push(phonetic);
        }

        for (const translationInput of lineInput.translations) {
          const translation = new SongLineTranslation();
          translation.line = line;
          translation.languageCode = translationInput.languageCode;
          translation.text = translationInput.text;
          translation.isUncertain = resolveIsUncertain(
            translationInput.isUncertain,
            previousFlags,
            uncertainTranslationKey(
              lineInput.originalText,
              translationInput.languageCode,
              translationInput.text,
            ),
          );
          entities.push(translation);
        }
      }
    }

    return entities;
  }

  // Keys of the song's currently stored translations flagged uncertain.
  // Raw SQL rather than em.find, so the rows about to be wiped never enter
  // the identity map. A brand-new, unpersisted song simply has none.
  private async loadUncertainTranslationKeys(
    em: EntityManager,
    song: Song,
  ): Promise<Set<string>> {
    const rows = await em
      .getConnection()
      .execute<{ originalText: string; languageCode: string; text: string }[]>(
        `select sl.original_text as "originalText", slt.language_code as "languageCode", slt.text
       from song_line_translations slt
       inner join song_lines sl on sl.id = slt.line_id
       inner join song_parts sp on sp.id = sl.part_id
       where sp.song_id = ? and slt.is_uncertain = true`,
        [song.id],
        'all',
        em.getTransactionContext(),
      );

    return new Set(
      rows.map((row) =>
        uncertainTranslationKey(row.originalText, row.languageCode, row.text),
      ),
    );
  }

  private buildAlternativeTitle(
    song: Song,
    input: CreateSongAlternativeTitleInput,
  ): SongAlternativeTitle {
    const alternativeTitle = new SongAlternativeTitle();
    alternativeTitle.song = song;
    alternativeTitle.title = input.title;
    alternativeTitle.position = input.position;
    return alternativeTitle;
  }

  private buildSongTag(song: Song, tag: Tag): SongTag {
    const songTag = new SongTag();
    songTag.song = song;
    songTag.tag = tag;
    return songTag;
  }

  private buildSongPart(song: Song, input: CreateSongPartInput): SongPart {
    const part = new SongPart();
    part.song = song;
    part.performer = input.performer;
    part.position = input.position;
    return part;
  }

  private buildSongMedia(
    song: Song,
    input: CreateSongMediaInput,
    mediaOwner: User | null,
  ): SongMedia {
    const media = new SongMedia();
    media.song = song;
    media.provider = input.provider;
    media.url = input.url;
    media.title = input.title;
    media.position = input.position;
    media.createdBy = mediaOwner;
    media.isVerified = false;
    return media;
  }

  private async persistOrThrowConflict(
    em: EntityManager,
    entities: object[],
  ): Promise<void> {
    try {
      await em.persist(entities).flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'The request conflicts with existing data',
        });
      }
      throw error;
    }
  }
}

// Identifies "the same translation" across a replace-all rebuild: same
// original line, same language, same translated text. Positions are
// deliberately not part of it, so inserting/reordering lines elsewhere in
// the song doesn't lose a flag.
function uncertainTranslationKey(
  originalText: string,
  languageCode: string,
  text: string,
): string {
  return [originalText, languageCode, text].join('\u0000');
}

/**
 * An explicit isUncertain always wins. An omitted one (an older client, or
 * an edit proposal stored before the flag existed) keeps the flag of the
 * identical translation the song already had, so editing an unrelated
 * field never clears it - and defaults to false for anything new or
 * retyped, since the old flag described the old text.
 */
export function resolveIsUncertain(
  explicit: boolean | undefined,
  previousFlags: Set<string>,
  key: string,
): boolean {
  return explicit ?? previousFlags.has(key);
}
