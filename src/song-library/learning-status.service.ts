import { Injectable, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { toSongSummaryResponseDto } from '../songs/mappers/song.mapper';
import { loadSongSummaryAggregates } from '../songs/songs-list-query';
import { Song } from '../songs/entities/song.entity';
import { User } from '../users/entities/user.entity';
import { LearningSongListItemDto } from './dto/learning-songs-list-response.dto';
import { LearningStatus } from './enums/learning-status.enum';
import { UserSongLearning } from './entities/user-song-learning.entity';

@Injectable()
export class LearningStatusService {
  constructor(private readonly em: EntityManager) {}

  // Upsert: PUT is idempotent-set, not create-only - see
  // PUT /songs/:songId/learning-status.
  async setStatus(
    user: User,
    songId: string,
    status: LearningStatus,
  ): Promise<LearningStatus> {
    await this.assertSongExists(songId);

    const existing = await this.em.findOne(UserSongLearning, {
      user: user.id,
      song: songId,
    });
    if (existing) {
      if (existing.status !== status) {
        existing.status = status;
        await this.em.flush();
      }
      return existing.status;
    }

    const record = new UserSongLearning();
    record.user = user;
    record.song = this.em.getReference(Song, songId);
    record.status = status;

    try {
      await this.em.persist(record).flush();
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) {
        throw error;
      }
      // Race: another request created the row first - fall back to
      // updating it, same as createVoteOrRecoverFromRace in SongsService.
      const raceRecord = await this.em.findOneOrFail(UserSongLearning, {
        user: user.id,
        song: songId,
      });
      if (raceRecord.status !== status) {
        raceRecord.status = status;
        await this.em.flush();
      }
      return raceRecord.status;
    }

    return record.status;
  }

  // Idempotent: removing tracking for a song that isn't tracked is a no-op
  // (204 either way) - see DELETE /songs/:songId/learning-status. Deletes
  // the row entirely rather than resetting to NOT_STARTED, so "untracked"
  // and "explicitly NOT_STARTED" stay distinguishable (learningStatus: null
  // vs 'NOT_STARTED' in SongDetails).
  async removeStatus(userId: string, songId: string): Promise<void> {
    await this.em.nativeDelete(UserSongLearning, {
      user: userId,
      song: songId,
    });
  }

  async getStatus(
    userId: string,
    songId: string,
  ): Promise<LearningStatus | null> {
    const record = await this.em.findOne(UserSongLearning, {
      user: userId,
      song: songId,
    });
    return record?.status ?? null;
  }

  async listLearningSongs(userId: string): Promise<LearningSongListItemDto[]> {
    const records = await this.em.find(
      UserSongLearning,
      { user: userId },
      { orderBy: { updatedAt: 'desc' } },
    );
    if (records.length === 0) {
      return [];
    }

    const songIds = records.map((record) => record.song.id);
    const [songs, aggregates] = await Promise.all([
      this.em.find(
        Song,
        { id: { $in: songIds } },
        { populate: ['category', 'tags.tag', 'createdBy'] },
      ),
      loadSongSummaryAggregates(this.em, songIds),
    ]);
    const songsById = new Map(songs.map((song) => [song.id, song]));

    return records.flatMap((record) => {
      const song = songsById.get(record.song.id);
      if (!song) {
        return [];
      }
      return [
        {
          ...toSongSummaryResponseDto(song, {
            hasPhonetics: aggregates.phoneticSongIds.has(song.id),
            hasMedia: aggregates.mediaSongIds.has(song.id),
            translationLanguages:
              aggregates.translationLanguagesBySongId.get(song.id) ?? [],
          }),
          learningStatus: record.status,
        },
      ];
    });
  }

  private async assertSongExists(songId: string): Promise<void> {
    const exists = await this.em.count(Song, { id: songId });
    if (exists === 0) {
      throw new NotFoundException({
        code: 'SONG_NOT_FOUND',
        message: 'Song not found',
      });
    }
  }
}
