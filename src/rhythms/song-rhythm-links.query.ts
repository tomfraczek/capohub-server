import type { EntityManager } from '@mikro-orm/postgresql';
import { SongRhythmRefDto } from './dto/song-rhythm-ref.dto';
import { SongRhythm } from './entities/song-rhythm.entity';

/**
 * Rhythms linked to one song, for SongDetailsResponseDto.rhythms (spec
 * section 9) - imported directly into songs/songs.service.ts as a plain
 * function, so SongsModule never needs to import RhythmsModule as a NestJS
 * dependency (see rhythms.module.ts).  Only active rhythms are included,
 * consistent with every other public surface (spec section 7/8).
 */
export async function loadRhythmsForSong(
  em: EntityManager,
  songId: string,
): Promise<SongRhythmRefDto[]> {
  const links = await em.find(
    SongRhythm,
    { song: songId, rhythm: { isActive: true } },
    { populate: ['rhythm'], orderBy: { isPrimary: 'desc' } },
  );

  return links.map((link) => ({
    id: link.rhythm.id,
    slug: link.rhythm.slug,
    name: link.rhythm.name,
    shortDescription: link.rhythm.shortDescription,
    isPrimary: link.isPrimary,
    description: link.description,
  }));
}
