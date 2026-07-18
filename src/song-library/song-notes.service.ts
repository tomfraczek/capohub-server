import { Injectable, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Song } from '../songs/entities/song.entity';
import { User } from '../users/entities/user.entity';
import { SongNote } from './entities/song-note.entity';

@Injectable()
export class SongNotesService {
  constructor(private readonly em: EntityManager) {}

  // PUT creates or updates - see PUT /songs/:songId/my-note.
  async upsertNote(
    user: User,
    songId: string,
    content: string,
  ): Promise<SongNote> {
    await this.assertSongExists(songId);

    const existing = await this.em.findOne(SongNote, {
      user: user.id,
      song: songId,
    });
    if (existing) {
      existing.content = content;
      await this.em.flush();
      return existing;
    }

    const note = new SongNote();
    note.user = user;
    note.song = this.em.getReference(Song, songId);
    note.content = content;

    try {
      await this.em.persist(note).flush();
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) {
        throw error;
      }
      // Race: another request created the note first - fall back to
      // updating it, same as createVoteOrRecoverFromRace in SongsService.
      const raceNote = await this.em.findOneOrFail(SongNote, {
        user: user.id,
        song: songId,
      });
      raceNote.content = content;
      await this.em.flush();
      return raceNote;
    }

    return note;
  }

  // Idempotent: removing a note that doesn't exist is a no-op (204 either
  // way) - see DELETE /songs/:songId/my-note.
  async removeNote(userId: string, songId: string): Promise<void> {
    await this.em.nativeDelete(SongNote, { user: userId, song: songId });
  }

  async getNote(userId: string, songId: string): Promise<SongNote | null> {
    return this.em.findOne(SongNote, { user: userId, song: songId });
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
